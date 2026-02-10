/**
 * work_heartbeat — Heartbeat handler: health fix + dispatch.
 *
 * Two-pass sweep:
 *   1. Health pass: zombie detection + stale worker cleanup per project
 *   2. Tick pass: fill free worker slots per project by priority
 *
 * Execution guards:
 *   - projectExecution (parallel|sequential): cross-project parallelism (this file)
 *   - roleExecution (parallel|sequential): DEV/QA parallelism (handled by projectTick)
 */
import type { OpenClawPluginApi } from "openclaw/plugin-sdk";
import { jsonResult } from "openclaw/plugin-sdk";
import type { ToolContext } from "../types.js";
import type { Project } from "../projects.js";
import { readProjects } from "../projects.js";
import { log as auditLog } from "../audit.js";
import { notify, notifyTickPickups, getNotificationConfig } from "../notify.js";
import { checkWorkerHealth, type HealthFix } from "../services/health.js";
import { projectTick, type TickAction } from "../services/tick.js";
import {
  requireWorkspaceDir,
  resolveContext,
  resolveProvider,
  getPluginConfig,
} from "../tool-helpers.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type ProjectEntry = readonly [groupId: string, project: Project];

type GlobalState = {
  activeProjects: number;
  activeDev: number;
  activeQa: number;
};

// ---------------------------------------------------------------------------
// Tool
// ---------------------------------------------------------------------------

export function createWorkHeartbeatTool(api: OpenClawPluginApi) {
  return (ctx: ToolContext) => ({
    name: "work_heartbeat",
    label: "Work Heartbeat",
    description: `Heartbeat handler: health fix + dispatch. With projectGroupId: targets one project. Without: sweeps all. Runs health checks, then fills free worker slots by priority.`,
    parameters: {
      type: "object",
      properties: {
        projectGroupId: {
          type: "string",
          description: "Target a single project. Omit to sweep all.",
        },
        dryRun: {
          type: "boolean",
          description: "Report only, don't dispatch. Default: false.",
        },
        maxPickups: { type: "number", description: "Max pickups per tick." },
        activeSessions: {
          type: "array",
          items: { type: "string" },
          description: "Active session IDs for zombie detection.",
        },
      },
    },

    async execute(_id: string, params: Record<string, unknown>) {
      const targetGroupId = params.projectGroupId as string | undefined;
      const dryRun = (params.dryRun as boolean) ?? false;
      const maxPickups = params.maxPickups as number | undefined;
      const activeSessions = (params.activeSessions as string[]) ?? [];
      const workspaceDir = requireWorkspaceDir(ctx);
      const pluginConfig = getPluginConfig(api);
      const projectExecution =
        (pluginConfig?.projectExecution as string) ?? "parallel";

      // Resolve target projects
      const entries = await resolveTargetProjects(workspaceDir, targetGroupId);
      if (!entries.length) {
        return jsonResult({
          success: true,
          dryRun,
          healthFixes: [],
          pickups: [],
          skipped: [{ project: "(none)", reason: "No projects" }],
        });
      }

      // Pass 1: health checks (zombie detection, stale worker cleanup)
      const healthFixes = await runHealthPass(entries, {
        workspaceDir,
        activeSessions,
        dryRun,
      });

      // Snapshot global state after health fixes
      const globalState = await snapshotGlobalState(workspaceDir, entries);

      // Pass 2: fill free worker slots per project
      const notifyConfig = getNotificationConfig(pluginConfig);
      const { pickups, skipped } = await runTickPass(entries, {
        workspaceDir,
        pluginConfig,
        dryRun,
        maxPickups,
        notifyConfig,
        agentId: ctx.agentId,
        sessionKey: ctx.sessionKey,
        projectExecution,
        initialActiveProjects: globalState.activeProjects,
      });

      // Update global state with new pickups
      for (const p of pickups) {
        if (p.role === "dev") globalState.activeDev++;
        else globalState.activeQa++;
      }
      globalState.activeProjects += pickups.filter(
        (p, i, arr) => arr.findIndex((x) => x.groupId === p.groupId) === i,
      ).length;

      // Audit
      await auditLog(workspaceDir, "work_heartbeat", {
        dryRun,
        projectExecution,
        projectsScanned: entries.length,
        healthFixes: healthFixes.length,
        pickups: pickups.length,
        skipped: skipped.length,
      });

      // Heartbeat summary notification
      const context = await resolveContext(ctx, api);
      await notify(
        {
          type: "heartbeat",
          projectsScanned: entries.length,
          dryRun,
          healthFixes: healthFixes.length,
          pickups: pickups.length,
          skipped: skipped.length,
          pickupDetails: pickups.map((p) => ({
            project: p.project,
            issueId: p.issueId,
            role: p.role,
          })),
        },
        {
          workspaceDir,
          config: notifyConfig,
          orchestratorDm:
            context.type === "direct" ? context.chatId : undefined,
          channel: "channel" in context ? context.channel : undefined,
        },
      );

      return jsonResult({
        success: true,
        dryRun,
        projectExecution,
        healthFixes,
        pickups,
        skipped,
        globalState,
      });
    },
  });
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function resolveTargetProjects(
  workspaceDir: string,
  targetGroupId?: string,
): Promise<ProjectEntry[]> {
  const data = await readProjects(workspaceDir);
  if (targetGroupId) {
    const project = data.projects[targetGroupId];
    return project ? [[targetGroupId, project]] : [];
  }
  return Object.entries(data.projects) as ProjectEntry[];
}

async function runHealthPass(
  entries: ProjectEntry[],
  opts: { workspaceDir: string; activeSessions: string[]; dryRun: boolean },
): Promise<Array<HealthFix & { project: string; role: string }>> {
  const fixes: Array<HealthFix & { project: string; role: string }> = [];
  for (const [groupId, project] of entries) {
    const { provider } = resolveProvider(project);
    for (const role of ["dev", "qa"] as const) {
      const roleFixes = await checkWorkerHealth({
        workspaceDir: opts.workspaceDir,
        groupId,
        project,
        role,
        activeSessions: opts.activeSessions,
        autoFix: !opts.dryRun,
        provider,
      });
      fixes.push(
        ...roleFixes.map((f) => ({ ...f, project: project.name, role })),
      );
    }
  }
  return fixes;
}

async function snapshotGlobalState(
  workspaceDir: string,
  entries: ProjectEntry[],
): Promise<GlobalState> {
  const data = await readProjects(workspaceDir);
  let activeDev = 0,
    activeQa = 0,
    activeProjects = 0;
  for (const [groupId] of entries) {
    const p = data.projects[groupId];
    if (!p) continue;
    if (p.dev.active) activeDev++;
    if (p.qa.active) activeQa++;
    if (p.dev.active || p.qa.active) activeProjects++;
  }
  return { activeDev, activeQa, activeProjects };
}

async function runTickPass(
  entries: ProjectEntry[],
  opts: {
    workspaceDir: string;
    pluginConfig?: Record<string, unknown>;
    dryRun: boolean;
    maxPickups?: number;
    notifyConfig: ReturnType<typeof getNotificationConfig>;
    agentId?: string;
    sessionKey?: string;
    projectExecution: string;
    initialActiveProjects: number;
  },
): Promise<{
  pickups: Array<TickAction & { project: string }>;
  skipped: Array<{ project: string; role?: string; reason: string }>;
}> {
  const pickups: Array<TickAction & { project: string }> = [];
  const skipped: Array<{ project: string; role?: string; reason: string }> = [];
  let pickupCount = 0;
  let activeProjects = opts.initialActiveProjects;

  for (const [groupId] of entries) {
    const current = (await readProjects(opts.workspaceDir)).projects[groupId];
    if (!current) continue;

    // Budget check
    if (opts.maxPickups !== undefined && pickupCount >= opts.maxPickups) {
      skipped.push({ project: current.name, reason: "Max pickups reached" });
      continue;
    }

    // Sequential project guard: only one project active at a time
    const projectActive = current.dev.active || current.qa.active;
    if (
      opts.projectExecution === "sequential" &&
      !projectActive &&
      activeProjects >= 1
    ) {
      skipped.push({
        project: current.name,
        reason: "Sequential: another project active",
      });
      continue;
    }

    // projectTick handles roleExecution (parallel|sequential) internally
    const remaining =
      opts.maxPickups !== undefined ? opts.maxPickups - pickupCount : undefined;
    const result = await projectTick({
      workspaceDir: opts.workspaceDir,
      groupId,
      agentId: opts.agentId,
      pluginConfig: opts.pluginConfig,
      sessionKey: opts.sessionKey,
      dryRun: opts.dryRun,
      maxPickups: remaining,
    });

    pickups.push(
      ...result.pickups.map((p) => ({ ...p, project: current.name })),
    );
    skipped.push(
      ...result.skipped.map((s) => ({ project: current.name, ...s })),
    );
    pickupCount += result.pickups.length;

    // Notify workerStart for each pickup in this project
    if (!opts.dryRun && result.pickups.length > 0) {
      await notifyTickPickups(result.pickups, {
        workspaceDir: opts.workspaceDir,
        config: opts.notifyConfig,
        channel: current.channel ?? "telegram",
      });
      if (!projectActive) activeProjects++;
    }
  }

  return { pickups, skipped };
}
