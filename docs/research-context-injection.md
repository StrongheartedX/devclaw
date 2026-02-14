# Research: OpenClaw-Native Context Injection Patterns

**Issue:** #181  
**Date:** 2026-02-14  
**Author:** DEV Worker (medior)  

## Executive Summary

Investigated OpenClaw-native alternatives to the current file-read-network pattern in `dispatch.ts` that triggers security audit warnings. **Found a viable solution: Bootstrap Hooks** — an existing OpenClaw mechanism designed for exactly this use case.

### Recommended Approach

**Use OpenClaw's Bootstrap Hook System** to inject role instructions dynamically during agent initialization rather than appending them to the message payload.

**Implementation Strategy:**
- Register an `agent:bootstrap` hook in devclaw's plugin
- Hook receives session context (sessionKey, agentId, workspaceDir)
- Dynamically adds role instructions as virtual workspace files
- Zero file I/O in dispatch path, no network-send pattern trigger

---

## Current Approach & Problem

### What We Do Now

```typescript
// dispatch.ts:240-260
async function loadRoleInstructions(
  workspaceDir: string, projectName: string, role: "dev" | "qa"
): Promise<string> {
  const projectFile = path.join(workspaceDir, "projects", "roles", projectName, `${role}.md`);
  try { return await fs.readFile(projectFile, "utf-8"); } catch { /* fallback */ }
  const defaultFile = path.join(workspaceDir, "projects", "roles", "default", `${role}.md`);
  try { return await fs.readFile(defaultFile, "utf-8"); } catch { /* fallback */ }
  return "";
}
```

**Flow:**
1. Read role instructions from disk (`projects/roles/{project}/{role}.md`)
2. Append to task message string
3. Send via CLI/Gateway RPC to worker session

**Why It Triggers Audit:**
- File read → network send pattern matches potential data exfiltration
- While this is intentional/legitimate, it creates audit noise
- False positives distract from real security issues

---

## Investigation Results

### 1. Bootstrap Hooks (✅ RECOMMENDED)

**Location:** `src/hooks/internal-hooks.ts`, `src/agents/bootstrap-hooks.ts`

**What It Is:**
An event-driven hook system that fires during agent initialization, allowing plugins to inject or modify workspace files before the system prompt is built.

**Key APIs:**

```typescript
// Hook registration (in plugin's register() function)
import { registerInternalHook } from "openclaw/hooks/internal-hooks";

registerInternalHook("agent:bootstrap", async (event) => {
  const { workspaceDir, bootstrapFiles, sessionKey } = event.context;
  
  // Modify bootstrapFiles array to inject role instructions
  if (isDevClawWorkerSession(sessionKey)) {
    const roleInstructions = await loadRoleInstructions(/* ... */);
    bootstrapFiles.push({
      name: "WORKER_INSTRUCTIONS.md",
      path: "<virtual>",
      content: roleInstructions,
      missing: false,
    });
  }
});
```

**How It Works:**
1. Plugin registers `agent:bootstrap` hook during initialization
2. When a worker session starts, OpenClaw calls `applyBootstrapHookOverrides()`
3. Hook receives `bootstrapFiles` array (workspace context files)
4. Hook can add/modify/remove files dynamically
5. Modified files are included in system prompt automatically
6. **No file-read-network pattern** — happens at system prompt build time

**Example from OpenClaw Source:**
```typescript
// src/agents/bootstrap-files.ts:38-48
export async function resolveBootstrapFilesForRun(params: {
  workspaceDir: string;
  config?: OpenClawConfig;
  sessionKey?: string;
  sessionId?: string;
  agentId?: string;
}): Promise<WorkspaceBootstrapFile[]> {
  const bootstrapFiles = filterBootstrapFilesForSession(
    await loadWorkspaceBootstrapFiles(params.workspaceDir),
    sessionKey,
  );
  return applyBootstrapHookOverrides({
    files: bootstrapFiles,
    workspaceDir: params.workspaceDir,
    config: params.config,
    sessionKey: params.sessionKey,
    sessionId: params.sessionId,
    agentId: params.agentId,
  });
}
```

**Pros:**
- ✅ Purpose-built for this exact use case
- ✅ Fires at agent init (system prompt construction time)
- ✅ No file-read-network pattern in dispatch
- ✅ Session-aware (can inspect sessionKey to determine role/project)
- ✅ Clean separation: dispatch logic vs. context injection
- ✅ Virtual files supported (no disk I/O required)
- ✅ Works with existing OpenClaw architecture

**Cons:**
- ⚠️ Requires plugin hook registration (minor refactor)
- ⚠️ Session metadata must carry role/project info (solvable via label or sessionKey naming)

**Session Identification Strategy:**

DevClaw already uses deterministic session keys:
```typescript
// From getSessionForLevel() in projects.ts
sessionKey = `subagent:${agentId}/${projectName}/${role}/${level}`
```

Parse this in the hook to extract role/project context:
```typescript
const match = sessionKey.match(/^subagent:[^/]+\/([^/]+)\/([^/]+)/);
if (match) {
  const [_, projectName, role] = match;
  // Load appropriate instructions
}
```

---

### 2. Session Metadata Fields

**Location:** `src/config/sessions/types.ts`

**Investigated:** SessionEntry type definition

**Findings:**
- SessionEntry has ~40 fields (model, provider, thinkingLevel, etc.)
- No generic "metadata" or "contextData" field
- `spawnedBy` field tracks parent session (used for sandbox scoping)
- Could theoretically extend SessionEntry, but:
  - Requires OpenClaw core changes (not plugin-only)
  - session.patch API would need schema updates
  - Not idiomatic (bootstrap files are the intended pattern)

**Conclusion:** Not viable for plugin-only solution.

---

### 3. Session Hooks / Memory System

**Location:** `src/auto-reply/reply/memory-flush.ts`

**Findings:**
- Memory system is for long-term context persistence across sessions
- Not designed for per-task dynamic context
- Would require workers to manually fetch instructions on startup
- Adds complexity vs. bootstrap hooks

**Conclusion:** Wrong abstraction layer for this use case.

---

### 4. System Prompt Injection

**Location:** `src/agents/system-prompt.ts`

**Investigated:** `buildAgentSystemPrompt()` parameters

**Findings:**
- Accepts `extraSystemPrompt?: string` parameter
- **However:** This is set at agent run time, not per-task
- Would still require dispatch code to pass instructions → same pattern
- Bootstrap hooks are the mechanism that feeds into this

**Conclusion:** Bootstrap hooks are the recommended upstream injection point.

---

### 5. Alternative Patterns Considered

#### A. Worker-Pull Pattern
**Idea:** Workers fetch their own instructions on startup via a tool call.

**Issues:**
- Requires worker to know what to fetch (chicken-egg problem)
- Adds latency (extra tool call before work starts)
- More fragile (what if fetch fails?)

#### B. Central Configuration Database
**Idea:** Store role instructions in plugin config, load at dispatch.

**Issues:**
- Doesn't solve file-read-network pattern (just moves file source)
- Less flexible (config reload required for instruction updates)
- Loses per-project customization (unless config becomes massive)

#### C. Cron Job contextMessages Feature
**Location:** `src/agents/tools/cron-tool.ts`

**What It Does:** Adds recent message context to scheduled jobs.

**Why It Doesn't Apply:** 
- For scheduled tasks, not real-time dispatch
- Still requires message content to be populated

---

## Detailed Implementation Plan

### Phase 1: Register Bootstrap Hook

**File:** `index.ts`

```typescript
import { registerInternalHook, isAgentBootstrapEvent } from "openclaw/hooks/internal-hooks";
import type { WorkspaceBootstrapFile } from "openclaw/agents/workspace";

export default {
  // ... existing plugin def ...
  
  register(api: OpenClawPluginApi) {
    // Existing tool/CLI/service registration...
    
    // Register bootstrap hook for role instruction injection
    registerInternalHook("agent:bootstrap", async (event) => {
      if (!isAgentBootstrapEvent(event)) return;
      
      const { sessionKey, workspaceDir, bootstrapFiles } = event.context;
      
      // Parse sessionKey: subagent:agentId/projectName/role/level
      const match = sessionKey?.match(/^subagent:[^/]+\/([^/]+)\/(dev|qa)/);
      if (!match) return; // Not a DevClaw worker session
      
      const [_, projectName, role] = match;
      
      // Load role instructions (same logic as current loadRoleInstructions)
      const instructions = await loadRoleInstructionsForHook(
        workspaceDir,
        projectName,
        role as "dev" | "qa"
      );
      
      if (instructions) {
        // Inject as virtual workspace file
        bootstrapFiles.push({
          name: "WORKER_INSTRUCTIONS.md" as const,
          path: `<devclaw:${projectName}:${role}>`,
          content: instructions,
          missing: false,
        });
      }
    });
    
    api.logger.info("DevClaw: registered agent:bootstrap hook for role instruction injection");
  }
};
```

### Phase 2: Refactor Dispatch

**File:** `lib/dispatch.ts`

**Remove:**
- `loadRoleInstructions()` function call from `buildTaskMessage()`
- File read logic

**Keep:**
- Task message construction (issue details, completion instructions)
- Completion instructions (work_finish call template)

**New Flow:**
1. `dispatchTask()` builds minimal task message (issue only)
2. Session spawn/send happens (unchanged)
3. **Bootstrap hook fires** during agent init (automatic)
4. Worker receives task message + role instructions via system prompt

**Critical:** Ensure completion instructions remain in task message (not bootstrap files) so they're specific to each task.

### Phase 3: Helper Function

**File:** `lib/bootstrap-hook.ts` (new)

```typescript
import fs from "node:fs/promises";
import path from "node:path";

/**
 * Load role instructions for bootstrap hook injection.
 * Same logic as original loadRoleInstructions, but in a hook-specific module.
 */
export async function loadRoleInstructionsForHook(
  workspaceDir: string,
  projectName: string,
  role: "dev" | "qa"
): Promise<string> {
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
    // Fallback to default
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
```

### Phase 4: Testing

**Scenarios:**
1. ✅ Dev worker receives instructions in system prompt
2. ✅ QA worker receives different instructions
3. ✅ Project-specific instructions override defaults
4. ✅ Missing instruction files fall back gracefully
5. ✅ Non-DevClaw sessions unaffected
6. ✅ Security audit no longer flags dispatch.ts

**Test Plan:**
```bash
# 1. Pick up a dev task
devclaw work start --issue 999 --role dev --level medior

# 2. Verify worker session has instructions
openclaw session inspect subagent:devclaw/test-project/dev/medior

# 3. Check system prompt includes WORKER_INSTRUCTIONS.md
openclaw session context subagent:devclaw/test-project/dev/medior

# 4. Run security audit
openclaw audit --plugin devclaw
```

---

## Pros/Cons Summary

### Bootstrap Hooks (Recommended)

**Pros:**
- ✅ Zero changes to OpenClaw core
- ✅ Plugin-only solution
- ✅ Idiomatic (uses existing infrastructure)
- ✅ Eliminates file-read-network pattern from dispatch
- ✅ Session-aware dynamic injection
- ✅ Virtual files (no temp file creation)
- ✅ Automatic inclusion in system prompt
- ✅ Clean separation of concerns

**Cons:**
- ⚠️ Moderate refactor (move logic from dispatch to hook)
- ⚠️ Requires sessionKey parsing (already deterministic)
- ⚠️ Hook registration happens once (not per-task) — need robust sessionKey matching

**Effort:** ~4-6 hours (hook registration, refactor dispatch, testing)

### Alternative: Worker-Pull (Not Recommended)

**Pros:**
- ✅ Explicit (worker knows it's fetching instructions)

**Cons:**
- ❌ Extra latency (tool call overhead)
- ❌ Fragile (fetch failures block work)
- ❌ Chicken-egg problem (how does worker know what to fetch?)
- ❌ Still requires file read somewhere

**Effort:** ~6-8 hours (new tool, worker logic, error handling)

---

## Decision Matrix

| Criterion | Bootstrap Hooks | Worker-Pull | Session Metadata | Current (File-Read) |
|-----------|-----------------|-------------|------------------|---------------------|
| Plugin-only | ✅ Yes | ✅ Yes | ❌ Needs core | ✅ Yes |
| No audit trigger | ✅ Yes | ⚠️ Maybe | ✅ Yes | ❌ No |
| Idiomatic | ✅ Yes | ❌ No | ⚠️ Maybe | ⚠️ Current |
| Performance | ✅ Fast | ⚠️ +1 tool call | ✅ Fast | ✅ Fast |
| Maintainability | ✅ High | ⚠️ Medium | ❌ Core dependency | ✅ High |
| Risk | 🟢 Low | 🟡 Medium | 🔴 High | 🟡 Medium |

**Winner:** Bootstrap Hooks

---

## Recommendation

1. **Implement Bootstrap Hook injection** as the primary solution
2. Keep task message minimal (issue details + completion template)
3. Migrate role instruction loading to hook callback
4. Add sessionKey parsing logic to identify DevClaw workers
5. Test thoroughly (especially fallback paths)
6. Document in AGENTS.md that instructions are injected at init, not dispatch

**Timeline:**
- Implementation: 4-6 hours
- Testing: 2-3 hours
- Documentation: 1 hour
- **Total: ~1 working day**

**Security Impact:**
- Eliminates false positive audit trigger
- No change to security posture (instructions are still file-sourced, just at a different layer)
- Improves audit signal-to-noise ratio

---

## Proof of Concept

### Minimal PoC Code

```typescript
// PoC: Bootstrap hook registration in index.ts
registerInternalHook("agent:bootstrap", async (event) => {
  if (!isAgentBootstrapEvent(event)) return;
  
  const { sessionKey, workspaceDir, bootstrapFiles } = event.context;
  const match = sessionKey?.match(/^subagent:[^/]+\/([^/]+)\/(dev|qa)/);
  
  if (match) {
    const [_, projectName, role] = match;
    const instructions = `# ${role.toUpperCase()} Instructions\n\nThis is a PoC injection.`;
    
    bootstrapFiles.push({
      name: "WORKER_INSTRUCTIONS.md",
      path: `<devclaw-poc>`,
      content: instructions,
      missing: false,
    });
    
    console.log(`[DevClaw PoC] Injected instructions for ${projectName}/${role}`);
  }
});
```

**Test:**
```bash
# Start a dev worker session
openclaw session create subagent:devclaw/test/dev/medior --model claude-sonnet-4

# Check if WORKER_INSTRUCTIONS.md appears in context
openclaw session context subagent:devclaw/test/dev/medior
```

**Expected Output:**
System prompt should include section:
```
## WORKER_INSTRUCTIONS.md
# DEV Instructions

This is a PoC injection.
```

---

## References

### OpenClaw Source Files Reviewed

1. `src/hooks/internal-hooks.ts` — Hook event system
2. `src/agents/bootstrap-hooks.ts` — Bootstrap hook application
3. `src/agents/bootstrap-files.ts` — Bootstrap file resolution
4. `src/agents/workspace.ts` — WorkspaceBootstrapFile type
5. `src/agents/system-prompt.ts` — System prompt construction
6. `src/config/sessions/types.ts` — SessionEntry definition
7. `src/gateway/sessions-patch.ts` — Session patch API

### DevClaw Files Modified (Proposed)

1. `index.ts` — Hook registration
2. `lib/dispatch.ts` — Remove file-read logic
3. `lib/bootstrap-hook.ts` — New helper module (optional)
4. `docs/research-context-injection.md` — This document

---

## Next Steps

1. **Create PoC** (30 min) — Validate hook fires and sessionKey parsing works
2. **Full Implementation** (4-6 hrs) — Refactor dispatch.ts, add hook logic
3. **Integration Testing** (2-3 hrs) — Verify dev/qa workflows unchanged
4. **Security Audit Verification** (30 min) — Confirm audit no longer flags dispatch
5. **Documentation Update** (1 hr) — Update AGENTS.md and README
6. **PR & Review** (1-2 hrs) — Submit for review

**Total Effort:** ~1-1.5 working days

---

## Appendix: OpenClaw Hook Event Structure

```typescript
export interface InternalHookEvent {
  type: "command" | "session" | "agent" | "gateway";
  action: string; // "bootstrap" for agent:bootstrap
  sessionKey: string;
  context: Record<string, unknown>;
  timestamp: Date;
  messages: string[]; // Can push confirmation messages
}

export type AgentBootstrapHookContext = {
  workspaceDir: string;
  bootstrapFiles: WorkspaceBootstrapFile[];
  cfg?: OpenClawConfig;
  sessionKey?: string;
  sessionId?: string;
  agentId?: string;
};

export type WorkspaceBootstrapFile = {
  name: string; // E.g., "AGENTS.md", "WORKER_INSTRUCTIONS.md"
  path: string; // File path or "<virtual>" marker
  content?: string; // File content (if loaded)
  missing: boolean; // True if file doesn't exist
};
```

---

**End of Research Document**
