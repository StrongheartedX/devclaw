/**
 * Heartbeat service — token-free interval-based queue processing.
 *
 * Runs as a plugin service (tied to gateway lifecycle). Every N seconds:
 *   1. Health pass: auto-fix zombies, stale workers, orphaned state
 *   2. Tick pass: fill free worker slots by priority
 *
 * Zero LLM tokens — all logic is deterministic code + CLI calls.
 * Workers only consume tokens when they start processing dispatched tasks.
 */
import type { OpenClawPluginApi } from "openclaw/plugin-sdk";
import { readProjects, getProject } from "../projects.js";
import { log as auditLog } from "../audit.js";
import { checkWorkerHealth } from "./health.js";
import { projectTick } from "./tick.js";
import { createProvider } from "../providers/index.js";

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

export type HeartbeatConfig = {
  enabled: boolean;
  intervalSeconds: number;
  maxPickupsPerTick: number;
};

export const HEARTBEAT_DEFAULTS: HeartbeatConfig = {
  enabled: true,
  intervalSeconds: 60,
  maxPickupsPerTick: 4,
};

export function resolveHeartbeatConfig(
  pluginConfig?: Record<string, unknown>,
): HeartbeatConfig {
  const raw = pluginConfig?.work_heartbeat as Partial<HeartbeatConfig> | undefined;
  return { ...HEARTBEAT_DEFAULTS, ...raw };
}

// ---------------------------------------------------------------------------
// Service
// ---------------------------------------------------------------------------

export function registerHeartbeatService(api: OpenClawPluginApi) {
  let intervalId: ReturnType<typeof setInterval> | null = null;

  api.registerService({
    id: "devclaw-heartbeat",

    start: async (ctx) => {
      const pluginConfig = api.pluginConfig as Record<string, unknown> | undefined;
      const config = resolveHeartbeatConfig(pluginConfig);

      if (!config.enabled) {
        ctx.logger.info("work_heartbeat service disabled");
        return;
      }

      const workspaceDir = ctx.workspaceDir;
      if (!workspaceDir) {
        ctx.logger.warn("work_heartbeat: no workspaceDir — service not started");
        return;
      }

      const agentId = resolveAgentId(pluginConfig);

      ctx.logger.info(
        `work_heartbeat service started: every ${config.intervalSeconds}s, max ${config.maxPickupsPerTick} pickups/tick`,
      );

      intervalId = setInterval(async () => {
        try {
          await tick({ workspaceDir, agentId, config, pluginConfig, logger: ctx.logger });
        } catch (err) {
          ctx.logger.error(`work_heartbeat tick failed: ${err}`);
        }
      }, config.intervalSeconds * 1000);
    },

    stop: async (ctx) => {
      if (intervalId) {
        clearInterval(intervalId);
        intervalId = null;
        ctx.logger.info("work_heartbeat service stopped");
      }
    },
  });
}

// ---------------------------------------------------------------------------
// Tick
// ---------------------------------------------------------------------------

async function tick(opts: {
  workspaceDir: string;
  agentId?: string;
  config: HeartbeatConfig;
  pluginConfig?: Record<string, unknown>;
  logger: { info(msg: string): void; warn(msg: string): void };
}) {
  const { workspaceDir, agentId, config, pluginConfig, logger } = opts;

  const data = await readProjects(workspaceDir);
  const projectIds = Object.keys(data.projects);
  if (projectIds.length === 0) return;

  const projectExecution =
    (pluginConfig?.projectExecution as string) ?? "parallel";

  let totalPickups = 0;
  let totalHealthFixes = 0;
  let totalSkipped = 0;
  let activeProjects = 0;

  for (const groupId of projectIds) {
    const project = data.projects[groupId];
    if (!project) continue;

    const { provider } = createProvider({ repo: project.repo });

    // Health pass: auto-fix
    for (const role of ["dev", "qa"] as const) {
      const fixes = await checkWorkerHealth({
        workspaceDir, groupId, project, role,
        activeSessions: [], // No session list in service context
        autoFix: true,
        provider,
      });
      totalHealthFixes += fixes.filter((f) => f.fixed).length;
    }

    // Budget check
    const remaining = config.maxPickupsPerTick - totalPickups;
    if (remaining <= 0) break;

    // Sequential project guard
    const fresh = (await readProjects(workspaceDir)).projects[groupId];
    if (!fresh) continue;
    const projectActive = fresh.dev.active || fresh.qa.active;
    if (projectExecution === "sequential" && !projectActive && activeProjects >= 1) {
      totalSkipped++;
      continue;
    }

    // Tick pass: fill free slots
    const result = await projectTick({
      workspaceDir, groupId, agentId,
      pluginConfig,
      maxPickups: remaining,
    });

    totalPickups += result.pickups.length;
    totalSkipped += result.skipped.length;
    if (projectActive || result.pickups.length > 0) activeProjects++;
  }

  // Audit (only when something happened)
  if (totalPickups > 0 || totalHealthFixes > 0) {
    logger.info(
      `work_heartbeat tick: ${totalPickups} pickups, ${totalHealthFixes} health fixes, ${totalSkipped} skipped`,
    );
  }

  await auditLog(workspaceDir, "heartbeat_tick", {
    projectsScanned: projectIds.length,
    healthFixes: totalHealthFixes,
    pickups: totalPickups,
    skipped: totalSkipped,
  });
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function resolveAgentId(pluginConfig?: Record<string, unknown>): string | undefined {
  const ids = pluginConfig?.devClawAgentIds as string[] | undefined;
  return ids?.[0];
}
