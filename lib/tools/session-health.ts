/**
 * session_health — Check and fix session state consistency.
 *
 * Detects zombie sessions (active=true but session dead) and stale workers.
 * Replaces manual HEARTBEAT.md step 1.
 *
 * NOTE: This tool checks projects.json state only. The agent should verify
 * session liveness via sessions_list and pass the results. The tool cannot
 * call sessions_list directly (it's an agent-level tool).
 */
import type { OpenClawPluginApi, OpenClawPluginToolContext } from "openclaw/plugin-sdk";
import { readProjects, updateWorker } from "../projects.js";
import { transitionLabel, resolveRepoPath, type StateLabel } from "../gitlab.js";
import { log as auditLog } from "../audit.js";

export function createSessionHealthTool(api: OpenClawPluginApi) {
  return (ctx: OpenClawPluginToolContext) => ({
    name: "session_health",
    description: `Check session state consistency across all projects. Detects: active workers with dead sessions, stale workers (>2 hours), and state mismatches. With autoFix=true, clears zombie states and reverts GitLab labels. Pass activeSessions (from sessions_list) so the tool can verify liveness.`,
    parameters: {
      type: "object",
      properties: {
        autoFix: {
          type: "boolean",
          description: "Automatically fix zombie sessions and stale active flags. Default: false.",
        },
        activeSessions: {
          type: "array",
          items: { type: "string" },
          description: "List of currently alive session IDs from sessions_list. Used to detect zombies.",
        },
      },
    },

    async execute(_id: string, params: Record<string, unknown>) {
      const autoFix = (params.autoFix as boolean) ?? false;
      const activeSessions = (params.activeSessions as string[]) ?? [];
      const workspaceDir = ctx.workspaceDir;

      if (!workspaceDir) {
        throw new Error("No workspace directory available in tool context");
      }

      const data = await readProjects(workspaceDir);
      const glabPath = (api.pluginConfig as Record<string, unknown>)?.glabPath as string | undefined;

      const issues: Array<Record<string, unknown>> = [];
      let fixesApplied = 0;

      for (const [groupId, project] of Object.entries(data.projects)) {
        const repoPath = resolveRepoPath(project.repo);
        const glabOpts = { glabPath, repoPath };

        for (const role of ["dev", "qa"] as const) {
          const worker = project[role];

          // Check 1: Active but no sessionId
          if (worker.active && !worker.sessionId) {
            const issue: Record<string, unknown> = {
              type: "active_no_session",
              severity: "critical",
              project: project.name,
              groupId,
              role,
              message: `${role.toUpperCase()} marked active but has no sessionId`,
            };

            if (autoFix) {
              await updateWorker(workspaceDir, groupId, role, {
                active: false,
                issueId: null,
              });
              issue.fixed = true;
              fixesApplied++;
            }
            issues.push(issue);
          }

          // Check 2: Active with sessionId but session is dead (zombie)
          if (
            worker.active &&
            worker.sessionId &&
            activeSessions.length > 0 &&
            !activeSessions.includes(worker.sessionId)
          ) {
            const issue: Record<string, unknown> = {
              type: "zombie_session",
              severity: "critical",
              project: project.name,
              groupId,
              role,
              sessionId: worker.sessionId,
              message: `${role.toUpperCase()} session ${worker.sessionId} not found in active sessions`,
            };

            if (autoFix) {
              // Revert GitLab label
              const revertLabel: StateLabel = role === "dev" ? "To Do" : "To Test";
              const currentLabel: StateLabel = role === "dev" ? "Doing" : "Testing";
              try {
                if (worker.issueId) {
                  const primaryIssueId = Number(worker.issueId.split(",")[0]);
                  await transitionLabel(primaryIssueId, currentLabel, revertLabel, glabOpts);
                  issue.labelReverted = `${currentLabel} → ${revertLabel}`;
                }
              } catch {
                issue.labelRevertFailed = true;
              }

              await updateWorker(workspaceDir, groupId, role, {
                active: false,
                issueId: null,
              });
              issue.fixed = true;
              fixesApplied++;
            }
            issues.push(issue);
          }

          // Check 3: Active for >2 hours (stale)
          if (worker.active && worker.startTime) {
            const startMs = new Date(worker.startTime).getTime();
            const nowMs = Date.now();
            const hoursActive = (nowMs - startMs) / (1000 * 60 * 60);

            if (hoursActive > 2) {
              issues.push({
                type: "stale_worker",
                severity: "warning",
                project: project.name,
                groupId,
                role,
                hoursActive: Math.round(hoursActive * 10) / 10,
                sessionId: worker.sessionId,
                issueId: worker.issueId,
                message: `${role.toUpperCase()} has been active for ${Math.round(hoursActive * 10) / 10}h — may need attention`,
              });
            }
          }

          // Check 4: Inactive but still has issueId (should have been cleared)
          if (!worker.active && worker.issueId) {
            const issue: Record<string, unknown> = {
              type: "inactive_with_issue",
              severity: "warning",
              project: project.name,
              groupId,
              role,
              issueId: worker.issueId,
              message: `${role.toUpperCase()} inactive but still has issueId "${worker.issueId}"`,
            };

            if (autoFix) {
              await updateWorker(workspaceDir, groupId, role, {
                issueId: null,
              });
              issue.fixed = true;
              fixesApplied++;
            }
            issues.push(issue);
          }
        }
      }

      // Audit log
      await auditLog(workspaceDir, "health_check", {
        projectsScanned: Object.keys(data.projects).length,
        issuesFound: issues.length,
        fixesApplied,
        autoFix,
        activeSessionsProvided: activeSessions.length > 0,
      });

      const result = {
        healthy: issues.length === 0,
        issuesFound: issues.length,
        fixesApplied,
        issues,
        note: activeSessions.length === 0
          ? "No activeSessions provided — zombie detection skipped. Call sessions_list and pass the result for full health check."
          : undefined,
      };

      return {
        content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }],
      };
    },
  });
}
