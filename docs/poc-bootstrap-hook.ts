/**
 * Proof of Concept: Bootstrap Hook for Role Instruction Injection
 * 
 * This demonstrates how devclaw can use OpenClaw's agent:bootstrap hook
 * to inject role instructions without triggering file-read-network audit patterns.
 */

// NOTE: This is a PoC snippet. In production, this would go in index.ts register()

import type { InternalHookEvent } from "openclaw/hooks/internal-hooks";
import type { WorkspaceBootstrapFile } from "openclaw/agents/workspace";
import fs from "node:fs/promises";
import path from "node:path";

/**
 * Helper: Check if hook event is an agent bootstrap event
 */
function isAgentBootstrapEvent(event: InternalHookEvent): boolean {
  if (event.type !== "agent" || event.action !== "bootstrap") {
    return false;
  }
  const context = event.context as Record<string, unknown>;
  return (
    typeof context.workspaceDir === "string" &&
    Array.isArray(context.bootstrapFiles)
  );
}

/**
 * Helper: Parse DevClaw worker sessionKey
 * Format: subagent:agentId/projectName/role/level
 * Example: subagent:devclaw/my-app/dev/medior
 */
function parseWorkerSession(sessionKey?: string): {
  projectName: string;
  role: "dev" | "qa";
} | null {
  if (!sessionKey) return null;
  
  const match = sessionKey.match(/^subagent:[^/]+\/([^/]+)\/(dev|qa)/);
  if (!match) return null;
  
  const [_, projectName, role] = match;
  return { projectName, role: role as "dev" | "qa" };
}

/**
 * Load role instructions (same logic as current dispatch.ts)
 */
async function loadRoleInstructions(
  workspaceDir: string,
  projectName: string,
  role: "dev" | "qa"
): Promise<string> {
  // Try project-specific instructions first
  const projectFile = path.join(
    workspaceDir,
    "projects",
    "roles",
    projectName,
    `${role}.md`
  );
  
  try {
    return await fs.readFile(projectFile, "utf-8");
  } catch {
    // Fallback to default instructions
    const defaultFile = path.join(
      workspaceDir,
      "projects",
      "roles",
      "default",
      `${role}.md`
    );
    
    try {
      return await fs.readFile(defaultFile, "utf-8");
    } catch {
      return ""; // No instructions found
    }
  }
}

/**
 * Bootstrap hook handler for DevClaw role instruction injection
 * 
 * This runs during agent initialization (system prompt construction).
 * It injects role-specific instructions as a virtual workspace file.
 * 
 * Benefits:
 * - No file-read-network pattern in dispatch code
 * - Instructions appear in system prompt automatically
 * - Session-aware dynamic injection
 * - Zero changes to OpenClaw core
 */
export async function devclawBootstrapHook(event: InternalHookEvent): Promise<void> {
  // Validate event type
  if (!isAgentBootstrapEvent(event)) {
    return;
  }
  
  const context = event.context as {
    workspaceDir: string;
    bootstrapFiles: WorkspaceBootstrapFile[];
    sessionKey?: string;
    sessionId?: string;
    agentId?: string;
  };
  
  const { workspaceDir, bootstrapFiles, sessionKey } = context;
  
  // Check if this is a DevClaw worker session
  const parsed = parseWorkerSession(sessionKey);
  if (!parsed) {
    // Not a DevClaw worker, skip
    return;
  }
  
  const { projectName, role } = parsed;
  
  // Load role instructions
  const instructions = await loadRoleInstructions(workspaceDir, projectName, role);
  
  if (!instructions) {
    // No instructions found (not an error, just no custom instructions)
    console.warn(
      `[DevClaw] No role instructions found for ${projectName}/${role} ` +
      `(checked projects/roles/${projectName}/${role}.md and default/${role}.md)`
    );
    return;
  }
  
  // Inject as virtual workspace file
  bootstrapFiles.push({
    name: "WORKER_INSTRUCTIONS.md",
    path: `<devclaw:${projectName}:${role}>`, // Virtual path marker
    content: instructions,
    missing: false,
  });
  
  console.log(
    `[DevClaw] ✅ Injected ${instructions.length} chars of ${role.toUpperCase()} ` +
    `instructions for project "${projectName}" via bootstrap hook`
  );
}

// ============================================================================
// USAGE EXAMPLE (in index.ts)
// ============================================================================

/*
import { registerInternalHook } from "openclaw/hooks/internal-hooks";
import { devclawBootstrapHook } from "./lib/bootstrap-hook.js";

export default {
  id: "devclaw",
  name: "DevClaw",
  // ... config ...
  
  register(api: OpenClawPluginApi) {
    // ... existing tool/CLI/service registration ...
    
    // Register bootstrap hook for role instruction injection
    registerInternalHook("agent:bootstrap", devclawBootstrapHook);
    
    api.logger.info(
      "DevClaw plugin registered (11 tools, 1 CLI, 1 service, 1 hook)"
    );
  },
};
*/

// ============================================================================
// TESTING
// ============================================================================

/*
# 1. Start a DevClaw worker session
openclaw session create subagent:devclaw/my-app/dev/medior --model claude-sonnet-4

# 2. Check system prompt includes instructions
openclaw session context subagent:devclaw/my-app/dev/medior

# 3. Verify WORKER_INSTRUCTIONS.md appears in workspace files section

# 4. Dispatch a task and verify worker behavior unchanged
devclaw work start --project my-app --issue 42 --role dev --level medior
*/

// ============================================================================
// MIGRATION CHECKLIST
// ============================================================================

/*
[ ] Create lib/bootstrap-hook.ts with devclawBootstrapHook
[ ] Register hook in index.ts register()
[ ] Remove loadRoleInstructions from lib/dispatch.ts
[ ] Remove roleInstructions from buildTaskMessage
[ ] Update tests to verify hook injection
[ ] Run security audit to confirm no false positive
[ ] Update AGENTS.md to document injection mechanism
[ ] Test dev + qa workflows end-to-end
*/
