/**
 * session_cleanup — Clear tier sessions for a worker.
 *
 * Use this when you want to explicitly remove a session (e.g., after
 * prolonged inactivity, or to force a fresh spawn for the next task).
 */
import type { OpenClawPluginApi, OpenClawPluginToolContext } from "openclaw/plugin-sdk";
import { readProjects, updateWorker } from "../projects.js";
import { log as auditLog } from "../audit.js";

export function createSessionCleanupTool(api: OpenClawPluginApi) {
  return (ctx: OpenClawPluginToolContext) => ({
    name: "session_cleanup",
    description: `Clear tier sessions for a DEV or QA worker. Use to remove stale sessions or force fresh spawns. Clears all tier sessions for the worker, or a specific tier if specified.`,
    parameters: {
      type: "object",
      required: ["role", "projectGroupId"],
      properties: {
        role: { type: "string", enum: ["dev", "qa"], description: "Worker role: dev or qa" },
        projectGroupId: { type: "string", description: "Telegram group ID (key in projects.json)" },
        tier: { type: "string", description: "Specific tier to clear (e.g. haiku, sonnet, opus, grok). Omit to clear all tiers." },
        clearAll: { type: "boolean", description: "Clear all session data including legacy sessionId. Default: false (only clears tier sessions)." },
      },
    },

    async execute(_id: string, params: Record<string, unknown>) {
      const role = params.role as "dev" | "qa";
      const groupId = params.projectGroupId as string;
      const tier = params.tier as string | undefined;
      const clearAll = (params.clearAll as boolean) ?? false;
      const workspaceDir = ctx.workspaceDir;

      if (!workspaceDir) {
        throw new Error("No workspace directory available in tool context");
      }

      const data = await readProjects(workspaceDir);
      const project = data.projects[groupId];
      if (!project) {
        throw new Error(`Project not found for groupId: ${groupId}`);
      }

      const worker = project[role];
      const updates: Record<string, unknown> = {};

      if (tier) {
        // Clear specific tier
        updates.sessions = { ...worker.sessions, [tier]: null };
      } else if (clearAll) {
        // Clear everything including legacy sessionId
        updates.sessions = {};
        updates.sessionId = null;
      } else {
        // Clear all tier sessions but keep legacy sessionId
        updates.sessions = {};
      }

      await updateWorker(workspaceDir, groupId, role, updates);

      const message = tier
        ? `Cleared ${role.toUpperCase()} tier "${tier}" session for ${project.name}`
        : clearAll
          ? `Cleared all sessions for ${role.toUpperCase()} on ${project.name}`
          : `Cleared all tier sessions for ${role.toUpperCase()} on ${project.name}`;

      // Audit log
      await auditLog(workspaceDir, "session_cleanup", {
        project: project.name,
        groupId,
        role,
        tier: tier ?? null,
        clearAll,
      });

      return {
        content: [{ type: "text" as const, text: JSON.stringify({ success: true, message }, null, 2) }],
      };
    },
  });
}
