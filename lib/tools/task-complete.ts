/**
 * task_complete — Atomically complete a task (DEV done, QA pass/fail/refine).
 *
 * Handles: validation, GitLab label transition, projects.json state update,
 * issue close/reopen, and audit logging.
 */
import type { OpenClawPluginApi, OpenClawPluginToolContext } from "openclaw/plugin-sdk";
import {
  readProjects,
  getProject,
  getWorker,
  deactivateWorker,
  activateWorker,
} from "../projects.js";
import {
  getIssue,
  transitionLabel,
  closeIssue,
  reopenIssue,
  resolveRepoPath,
  type StateLabel,
} from "../gitlab.js";
import { selectModel } from "../model-selector.js";
import { log as auditLog } from "../audit.js";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

export function createTaskCompleteTool(api: OpenClawPluginApi) {
  return (ctx: OpenClawPluginToolContext) => ({
    name: "task_complete",
    description: `Complete a task: DEV done, QA pass, QA fail, or QA refine. Atomically handles: label transition, projects.json update, issue close/reopen, and audit logging. For QA fail, also prepares DEV session instructions for the fix cycle.`,
    parameters: {
      type: "object",
      required: ["role", "result", "projectGroupId"],
      properties: {
        role: { type: "string", enum: ["dev", "qa"], description: "Worker role completing the task" },
        result: {
          type: "string",
          enum: ["done", "pass", "fail", "refine"],
          description: 'Completion result: "done" (DEV finished), "pass" (QA approved), "fail" (QA found issues), "refine" (needs human input)',
        },
        projectGroupId: { type: "string", description: "Telegram group ID (key in projects.json)" },
        summary: { type: "string", description: "Brief summary for Telegram announcement" },
      },
    },

    async execute(_id: string, params: Record<string, unknown>) {
      const role = params.role as "dev" | "qa";
      const result = params.result as "done" | "pass" | "fail" | "refine";
      const groupId = params.projectGroupId as string;
      const summary = params.summary as string | undefined;
      const workspaceDir = ctx.workspaceDir;

      if (!workspaceDir) {
        throw new Error("No workspace directory available in tool context");
      }

      // Validate result matches role
      if (role === "dev" && result !== "done") {
        throw new Error(`DEV can only complete with result "done", got "${result}"`);
      }
      if (role === "qa" && result === "done") {
        throw new Error(`QA cannot use result "done". Use "pass", "fail", or "refine".`);
      }

      // Resolve project
      const data = await readProjects(workspaceDir);
      const project = getProject(data, groupId);
      if (!project) {
        throw new Error(`Project not found for groupId: ${groupId}`);
      }

      const worker = getWorker(project, role);
      if (!worker.active) {
        throw new Error(
          `${role.toUpperCase()} worker is not active on ${project.name}. Nothing to complete.`,
        );
      }

      const issueId = worker.issueId ? Number(worker.issueId.split(",")[0]) : null;
      if (!issueId) {
        throw new Error(`No issueId found for active ${role.toUpperCase()} worker on ${project.name}`);
      }

      const repoPath = resolveRepoPath(project.repo);
      const glabOpts = {
        glabPath: (api.pluginConfig as Record<string, unknown>)?.glabPath as string | undefined,
        repoPath,
      };

      const output: Record<string, unknown> = {
        success: true,
        project: project.name,
        groupId,
        issueId,
        role,
        result,
      };

      // === DEV DONE ===
      if (role === "dev" && result === "done") {
        // Pull latest on the project repo
        try {
          await execFileAsync("git", ["pull"], { cwd: repoPath, timeout: 30_000 });
          output.gitPull = "success";
        } catch (err) {
          output.gitPull = `warning: ${(err as Error).message}`;
        }

        // Deactivate DEV (preserves tier session for reuse)
        await deactivateWorker(workspaceDir, groupId, "dev", {
          tier: worker.tier ?? undefined,
          sessionId: worker.sessionId ?? undefined,
          startTime: worker.startTime ?? undefined,
        });

        // Transition label: Doing → To Test
        await transitionLabel(issueId, "Doing", "To Test", glabOpts);

        output.labelTransition = "Doing → To Test";
        output.announcement = `✅ DEV done #${issueId}${summary ? ` — ${summary}` : ""}. Moved to QA queue.`;
      }

      // === QA PASS ===
      if (role === "qa" && result === "pass") {
        // Deactivate QA (preserves tier session for reuse)
        await deactivateWorker(workspaceDir, groupId, "qa", {
          tier: worker.tier ?? undefined,
          sessionId: worker.sessionId ?? undefined,
          startTime: worker.startTime ?? undefined,
        });

        // Transition label: Testing → Done, close issue
        await transitionLabel(issueId, "Testing", "Done", glabOpts);
        await closeIssue(issueId, glabOpts);

        output.labelTransition = "Testing → Done";
        output.issueClosed = true;
        output.announcement = `🎉 QA PASS #${issueId}${summary ? ` — ${summary}` : ""}. Issue closed.`;
      }

      // === QA FAIL ===
      if (role === "qa" && result === "fail") {
        // Deactivate QA (preserves tier session for reuse)
        await deactivateWorker(workspaceDir, groupId, "qa", {
          tier: worker.tier ?? undefined,
          sessionId: worker.sessionId ?? undefined,
          startTime: worker.startTime ?? undefined,
        });

        // Transition label: Testing → To Improve, reopen issue
        await transitionLabel(issueId, "Testing", "To Improve", glabOpts);
        await reopenIssue(issueId, glabOpts);

        // Prepare DEV fix cycle
        const issue = await getIssue(issueId, glabOpts);
        const devModel = selectModel(issue.title, issue.description ?? "", "dev");
        const devWorker = getWorker(project, "dev");
        const devTierSession = devWorker.sessions?.[devModel.alias];

        output.labelTransition = "Testing → To Improve";
        output.issueReopened = true;
        output.announcement = `❌ QA FAIL #${issueId}${summary ? ` — ${summary}` : ""}. Sent back to DEV.`;

        // If DEV session exists for this tier, prepare reuse instructions
        const devSessionId = devTierSession?.sessionId ?? devWorker.sessionId;
        if (devSessionId) {
          output.devFixInstructions =
            `Send QA feedback to existing DEV session ${devSessionId}. ` +
            `If model "${devModel.alias}" differs from "${devWorker.model}", call sessions.patch first. ` +
            `Then sessions_send with QA failure details. ` +
            `DEV will pick up from To Improve → Doing automatically.`;
          output.devSessionId = devSessionId;
          output.devModel = devModel.alias;
        } else {
          output.devFixInstructions =
            `No existing DEV session. Spawn new DEV worker with model "${devModel.alias}" to fix #${issueId}.`;
          output.devModel = devModel.alias;
        }
      }

      // === QA REFINE ===
      if (role === "qa" && result === "refine") {
        // Deactivate QA (preserves tier session for reuse)
        await deactivateWorker(workspaceDir, groupId, "qa", {
          tier: worker.tier ?? undefined,
          sessionId: worker.sessionId ?? undefined,
          startTime: worker.startTime ?? undefined,
        });

        // Transition label: Testing → Refining
        await transitionLabel(issueId, "Testing", "Refining", glabOpts);

        output.labelTransition = "Testing → Refining";
        output.announcement = `🤔 QA REFINE #${issueId}${summary ? ` — ${summary}` : ""}. Awaiting human decision.`;
      }

      // Audit log
      await auditLog(workspaceDir, "task_complete", {
        project: project.name,
        groupId,
        issue: issueId,
        role,
        result,
        summary: summary ?? null,
        labelTransition: output.labelTransition,
      });

      return {
        content: [{ type: "text" as const, text: JSON.stringify(output, null, 2) }],
      };
    },
  });
}
