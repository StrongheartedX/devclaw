/**
 * health — Worker health scan with optional auto-fix.
 *
 * Read-only by default (surfaces issues). Pass fix=true to apply fixes.
 * Context-aware: auto-filters to project in group chats.
 */
import type { OpenClawPluginApi } from "openclaw/plugin-sdk";
import { jsonResult } from "openclaw/plugin-sdk";
import type { ToolContext } from "../types.js";
import { readProjects, getProject, type Project } from "../projects.js";
import { log as auditLog } from "../audit.js";
import { checkWorkerHealth, type HealthFix } from "../services/health.js";
import { requireWorkspaceDir, resolveContext, resolveProvider } from "../tool-helpers.js";

export function createHealthTool(api: OpenClawPluginApi) {
  return (ctx: ToolContext) => ({
    name: "health",
    label: "Health",
    description: `Scan worker health across projects. Detects zombies, stale workers, orphaned state. Pass fix=true to auto-fix. Context-aware: auto-filters in group chats.`,
    parameters: {
      type: "object",
      properties: {
        projectGroupId: { type: "string", description: "Filter to specific project. Omit for all." },
        fix: { type: "boolean", description: "Apply fixes for detected issues. Default: false (read-only)." },
        activeSessions: { type: "array", items: { type: "string" }, description: "Active session IDs for zombie detection." },
      },
    },

    async execute(_id: string, params: Record<string, unknown>) {
      const workspaceDir = requireWorkspaceDir(ctx);
      const fix = (params.fix as boolean) ?? false;
      const activeSessions = (params.activeSessions as string[]) ?? [];

      // Auto-filter in group context
      const context = await resolveContext(ctx, api);
      let groupId = params.projectGroupId as string | undefined;
      if (context.type === "group" && !groupId) groupId = context.groupId;

      const data = await readProjects(workspaceDir);
      const projectIds = groupId ? [groupId] : Object.keys(data.projects);

      const issues: Array<HealthFix & { project: string; role: string }> = [];

      for (const pid of projectIds) {
        const project = getProject(data, pid);
        if (!project) continue;
        const { provider } = resolveProvider(project);

        for (const role of ["dev", "qa"] as const) {
          const fixes = await checkWorkerHealth({
            workspaceDir, groupId: pid, project, role, activeSessions,
            autoFix: fix, provider,
          });
          issues.push(...fixes.map((f) => ({ ...f, project: project.name, role })));
        }
      }

      await auditLog(workspaceDir, "health", {
        projectCount: projectIds.length,
        fix,
        issuesFound: issues.length,
        issuesFixed: issues.filter((i) => i.fixed).length,
      });

      return jsonResult({
        success: true,
        fix,
        projectsScanned: projectIds.length,
        issues,
        note: activeSessions.length === 0 ? "No activeSessions provided — zombie detection skipped." : undefined,
      });
    },
  });
}
