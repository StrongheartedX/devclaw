/**
 * task_pickup — Atomically pick up a task from the GitLab queue.
 *
 * Handles: validation, model selection, GitLab label transition,
 * projects.json state update, and audit logging.
 *
 * Returns structured instructions for the agent to spawn/send a session.
 */
import type { OpenClawPluginApi, OpenClawPluginToolContext } from "openclaw/plugin-sdk";
import {
  readProjects,
  getProject,
  getWorker,
  activateWorker,
} from "../projects.js";
import {
  getIssue,
  getCurrentStateLabel,
  transitionLabel,
  resolveRepoPath,
  type StateLabel,
} from "../gitlab.js";
import { selectModel } from "../model-selector.js";
import { log as auditLog } from "../audit.js";

export function createTaskPickupTool(api: OpenClawPluginApi) {
  return (ctx: OpenClawPluginToolContext) => ({
    name: "task_pickup",
    description: `Pick up a task from the GitLab queue for a DEV or QA worker. Atomically handles: label transition, model selection, projects.json update, and audit logging. Returns session action instructions (spawn or send) for the agent to execute.`,
    parameters: {
      type: "object",
      required: ["issueId", "role", "projectGroupId"],
      properties: {
        issueId: { type: "number", description: "GitLab issue ID to pick up" },
        role: { type: "string", enum: ["dev", "qa"], description: "Worker role: dev or qa" },
        projectGroupId: {
          type: "string",
          description: "Telegram group ID (key in projects.json). Required — pass the group ID from the current conversation.",
        },
        modelOverride: {
          type: "string",
          description: "Force a specific model alias (e.g. haiku, sonnet, opus, grok). Overrides automatic selection.",
        },
      },
    },

    async execute(_id: string, params: Record<string, unknown>) {
      const issueId = params.issueId as number;
      const role = params.role as "dev" | "qa";
      const groupId = params.projectGroupId as string;
      const modelOverride = params.modelOverride as string | undefined;
      const workspaceDir = ctx.workspaceDir;

      if (!workspaceDir) {
        throw new Error("No workspace directory available in tool context");
      }

      // 1. Resolve project
      const data = await readProjects(workspaceDir);
      const project = getProject(data, groupId);
      if (!project) {
        throw new Error(
          `Project not found for groupId: ${groupId}. Available: ${Object.keys(data.projects).join(", ")}`,
        );
      }

      // 2. Check no active worker for this role
      const worker = getWorker(project, role);
      if (worker.active) {
        throw new Error(
          `${role.toUpperCase()} worker already active on ${project.name} (issue: ${worker.issueId}, session: ${worker.sessionId}). Complete current task first.`,
        );
      }

      // 3. Fetch issue from GitLab and verify state
      const repoPath = resolveRepoPath(project.repo);
      const glabOpts = {
        glabPath: (api.pluginConfig as Record<string, unknown>)?.glabPath as string | undefined,
        repoPath,
      };

      const issue = await getIssue(issueId, glabOpts);
      const currentLabel = getCurrentStateLabel(issue);

      // Validate label matches expected state for the role
      const validLabelsForDev: StateLabel[] = ["To Do", "To Improve"];
      const validLabelsForQa: StateLabel[] = ["To Test"];
      const validLabels = role === "dev" ? validLabelsForDev : validLabelsForQa;

      if (!currentLabel || !validLabels.includes(currentLabel)) {
        throw new Error(
          `Issue #${issueId} has label "${currentLabel ?? "none"}" but expected one of: ${validLabels.join(", ")}. Cannot pick up for ${role.toUpperCase()}.`,
        );
      }

      // 4. Select model
      const targetLabel: StateLabel = role === "dev" ? "Doing" : "Testing";
      let selectedModel = selectModel(issue.title, issue.description ?? "", role);
      if (modelOverride) {
        selectedModel = {
          model: modelOverride,
          alias: modelOverride,
          reason: `User override: ${modelOverride}`,
        };
      }

      // 5. Determine session action (spawn vs reuse)
      const existingSessionId = worker.sessionId;
      const sessionAction = existingSessionId ? "send" : "spawn";

      // 6. Transition GitLab label
      await transitionLabel(issueId, currentLabel, targetLabel, glabOpts);

      // 7. Update projects.json
      const now = new Date().toISOString();
      if (sessionAction === "spawn") {
        // New spawn — agent will provide sessionId after spawning
        await activateWorker(workspaceDir, groupId, role, {
          issueId: String(issueId),
          model: selectedModel.alias,
          startTime: now,
        });
      } else {
        // Reuse existing session — preserve sessionId and startTime
        await activateWorker(workspaceDir, groupId, role, {
          issueId: String(issueId),
          model: selectedModel.alias,
        });
      }

      // 8. Audit log
      await auditLog(workspaceDir, "task_pickup", {
        project: project.name,
        groupId,
        issue: issueId,
        issueTitle: issue.title,
        role,
        model: selectedModel.alias,
        modelReason: selectedModel.reason,
        sessionAction,
        sessionId: existingSessionId,
        labelTransition: `${currentLabel} → ${targetLabel}`,
      });

      await auditLog(workspaceDir, "model_selection", {
        issue: issueId,
        role,
        selected: selectedModel.alias,
        fullModel: selectedModel.model,
        reason: selectedModel.reason,
        override: modelOverride ?? null,
      });

      // 9. Build announcement and session instructions
      const emoji = role === "dev"
        ? (selectedModel.alias === "haiku" ? "⚡" : selectedModel.alias === "opus" ? "🧠" : "🔧")
        : "🔍";

      const actionVerb = sessionAction === "spawn" ? "Spawning" : "Sending";
      const announcement = `${emoji} ${actionVerb} ${role.toUpperCase()} (${selectedModel.alias}) for #${issueId}: ${issue.title}`;

      const result: Record<string, unknown> = {
        success: true,
        project: project.name,
        groupId,
        issueId,
        issueTitle: issue.title,
        role,
        model: selectedModel.alias,
        fullModel: selectedModel.model,
        modelReason: selectedModel.reason,
        sessionAction,
        announcement,
        labelTransition: `${currentLabel} → ${targetLabel}`,
      };

      if (sessionAction === "send") {
        result.sessionId = existingSessionId;
        result.instructions =
          `Session reuse: send new task to existing session ${existingSessionId}. ` +
          `If model "${selectedModel.alias}" differs from current session model, call sessions.patch first to update the model. ` +
          `Then call sessions_send with the task description. ` +
          `After spawning/sending, update projects.json sessionId if it changed.`;
        result.tokensSavedEstimate = "~50K (session reuse)";
      } else {
        result.instructions =
          `New session: call sessions_spawn with model "${selectedModel.model}" for this ${role.toUpperCase()} task. ` +
          `After spawn completes, call task_pickup_confirm with the returned sessionId to update projects.json.`;
      }

      return {
        content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }],
      };
    },
  });
}
