/**
 * workflow.ts — XState-style statechart configuration for workflow states.
 *
 * The workflow config defines:
 *   - States with types (queue, active, hold, terminal)
 *   - Transitions with actions (gitPull, detectPr, closeIssue, reopenIssue)
 *   - Role assignments (dev, qa)
 *   - Priority ordering for queue states
 *
 * All workflow behavior is derived from this config — no hardcoded state names.
 */
// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type StateType = "queue" | "active" | "hold" | "terminal";
/** Role identifier. Built-in: "developer", "tester", "architect". Extensible via config. */
export type Role = string;
export type TransitionAction = "gitPull" | "detectPr" | "closeIssue" | "reopenIssue";

export type TransitionTarget = string | {
  target: string;
  actions?: TransitionAction[];
};

export type StateConfig = {
  type: StateType;
  role?: Role;
  label: string;
  color: string;
  priority?: number;
  on?: Record<string, TransitionTarget>;
};

export type WorkflowConfig = {
  initial: string;
  states: Record<string, StateConfig>;
};

export type CompletionRule = {
  from: string;
  to: string;
  gitPull?: boolean;
  detectPr?: boolean;
  closeIssue?: boolean;
  reopenIssue?: boolean;
};

// ---------------------------------------------------------------------------
// Default workflow — matches current hardcoded behavior
// ---------------------------------------------------------------------------

export const DEFAULT_WORKFLOW: WorkflowConfig = {
  initial: "planning",
  states: {
    planning: {
      type: "hold",
      label: "Planning",
      color: "#95a5a6",
      on: { APPROVE: "todo" },
    },
    todo: {
      type: "queue",
      role: "developer",
      label: "To Do",
      color: "#428bca",
      priority: 1,
      on: { PICKUP: "doing" },
    },
    doing: {
      type: "active",
      role: "developer",
      label: "Doing",
      color: "#f0ad4e",
      on: {
        COMPLETE: { target: "toTest", actions: ["gitPull", "detectPr"] },
        BLOCKED: "refining",
      },
    },
    toTest: {
      type: "queue",
      role: "tester",
      label: "To Test",
      color: "#5bc0de",
      priority: 2,
      on: { PICKUP: "testing" },
    },
    testing: {
      type: "active",
      role: "tester",
      label: "Testing",
      color: "#9b59b6",
      on: {
        PASS: { target: "done", actions: ["closeIssue"] },
        FAIL: { target: "toImprove", actions: ["reopenIssue"] },
        REFINE: "refining",
        BLOCKED: "refining",
      },
    },
    toImprove: {
      type: "queue",
      role: "developer",
      label: "To Improve",
      color: "#d9534f",
      priority: 3,
      on: { PICKUP: "doing" },
    },
    refining: {
      type: "hold",
      label: "Refining",
      color: "#f39c12",
      on: { APPROVE: "todo" },
    },
    done: {
      type: "terminal",
      label: "Done",
      color: "#5cb85c",
    },
    toDesign: {
      type: "queue",
      role: "architect",
      label: "To Design",
      color: "#0075ca",
      priority: 1,
      on: { PICKUP: "designing" },
    },
    designing: {
      type: "active",
      role: "architect",
      label: "Designing",
      color: "#d4c5f9",
      on: {
        COMPLETE: "planning",
        BLOCKED: "refining",
      },
    },
  },
};

// ---------------------------------------------------------------------------
// Workflow loading
// ---------------------------------------------------------------------------

/**
 * Load workflow config for a project.
 * Delegates to loadConfig() which handles the three-layer merge.
 */
export async function loadWorkflow(
  workspaceDir: string,
  projectName?: string,
): Promise<WorkflowConfig> {
  const { loadConfig } = await import("./config/loader.js");
  const config = await loadConfig(workspaceDir, projectName);
  return config.workflow;
}

// ---------------------------------------------------------------------------
// Derived helpers — all behavior comes from the config
// ---------------------------------------------------------------------------

/**
 * Get all state labels (for GitHub/GitLab label creation).
 */
export function getStateLabels(workflow: WorkflowConfig): string[] {
  return Object.values(workflow.states).map((s) => s.label);
}

/**
 * Get label → color mapping.
 */
export function getLabelColors(workflow: WorkflowConfig): Record<string, string> {
  const colors: Record<string, string> = {};
  for (const state of Object.values(workflow.states)) {
    colors[state.label] = state.color;
  }
  return colors;
}

/**
 * Get queue labels for a role, ordered by priority (highest first).
 */
export function getQueueLabels(workflow: WorkflowConfig, role: Role): string[] {
  return Object.values(workflow.states)
    .filter((s) => s.type === "queue" && s.role === role)
    .sort((a, b) => (b.priority ?? 0) - (a.priority ?? 0))
    .map((s) => s.label);
}

/**
 * Get all queue labels ordered by priority (for findNextIssue).
 */
export function getAllQueueLabels(workflow: WorkflowConfig): string[] {
  return Object.values(workflow.states)
    .filter((s) => s.type === "queue")
    .sort((a, b) => (b.priority ?? 0) - (a.priority ?? 0))
    .map((s) => s.label);
}

/**
 * Get the active (in-progress) label for a role.
 */
export function getActiveLabel(workflow: WorkflowConfig, role: Role): string {
  const state = Object.values(workflow.states).find(
    (s) => s.type === "active" && s.role === role,
  );
  if (!state) throw new Error(`No active state for role "${role}"`);
  return state.label;
}

/**
 * Get the revert label for a role (first queue state for that role).
 */
export function getRevertLabel(workflow: WorkflowConfig, role: Role): string {
  // Find the state that PICKUP transitions to the active state, then find its label
  const activeLabel = getActiveLabel(workflow, role);
  const activeStateKey = Object.entries(workflow.states).find(
    ([, s]) => s.label === activeLabel,
  )?.[0];

  // Find queue states that transition to this active state
  for (const [, state] of Object.entries(workflow.states)) {
    if (state.type !== "queue" || state.role !== role) continue;
    const pickup = state.on?.PICKUP;
    if (pickup === activeStateKey) {
      return state.label;
    }
  }

  // Fallback: first queue state for role
  return getQueueLabels(workflow, role)[0] ?? "";
}

/**
 * Detect role from a label.
 */
export function detectRoleFromLabel(workflow: WorkflowConfig, label: string): Role | null {
  for (const state of Object.values(workflow.states)) {
    if (state.label === label && state.type === "queue" && state.role) {
      return state.role;
    }
  }
  return null;
}

/**
 * Check if a label is a queue label.
 */
export function isQueueLabel(workflow: WorkflowConfig, label: string): boolean {
  return Object.values(workflow.states).some(
    (s) => s.label === label && s.type === "queue",
  );
}

/**
 * Check if a label is an active label.
 */
export function isActiveLabel(workflow: WorkflowConfig, label: string): boolean {
  return Object.values(workflow.states).some(
    (s) => s.label === label && s.type === "active",
  );
}

/**
 * Find state config by label.
 */
export function findStateByLabel(workflow: WorkflowConfig, label: string): StateConfig | null {
  return Object.values(workflow.states).find((s) => s.label === label) ?? null;
}

/**
 * Find state key by label.
 */
export function findStateKeyByLabel(workflow: WorkflowConfig, label: string): string | null {
  return Object.entries(workflow.states).find(([, s]) => s.label === label)?.[0] ?? null;
}

// ---------------------------------------------------------------------------
// Completion rules — derived from transitions
// ---------------------------------------------------------------------------

/**
 * Map completion result to workflow transition event name.
 * Convention: "done" → COMPLETE, others → uppercase.
 */
function resultToEvent(result: string): string {
  if (result === "done") return "COMPLETE";
  return result.toUpperCase();
}

/**
 * Get completion rule for a role:result pair.
 * Derives entirely from workflow transitions — no hardcoded role:result mapping.
 */
export function getCompletionRule(
  workflow: WorkflowConfig,
  role: Role,
  result: string,
): CompletionRule | null {
  const event = resultToEvent(result);

  let activeLabel: string;
  try {
    activeLabel = getActiveLabel(workflow, role);
  } catch { return null; }

  const activeKey = findStateKeyByLabel(workflow, activeLabel);
  if (!activeKey) return null;

  const activeState = workflow.states[activeKey];
  if (!activeState.on) return null;

  const transition = activeState.on[event];
  if (!transition) return null;

  const targetKey = typeof transition === "string" ? transition : transition.target;
  const actions = typeof transition === "object" ? transition.actions : undefined;
  const targetState = workflow.states[targetKey];
  if (!targetState) return null;

  return {
    from: activeLabel,
    to: targetState.label,
    gitPull: actions?.includes("gitPull"),
    detectPr: actions?.includes("detectPr"),
    closeIssue: actions?.includes("closeIssue"),
    reopenIssue: actions?.includes("reopenIssue"),
  };
}

/**
 * Get human-readable next state description.
 * Derives from target state type — no hardcoded role names.
 */
export function getNextStateDescription(
  workflow: WorkflowConfig,
  role: Role,
  result: string,
): string {
  const rule = getCompletionRule(workflow, role, result);
  if (!rule) return "";

  const targetState = findStateByLabel(workflow, rule.to);
  if (!targetState) return "";

  if (targetState.type === "terminal") return "Done!";
  if (targetState.type === "hold") return "awaiting human decision";
  if (targetState.type === "queue" && targetState.role) {
    return `${targetState.role.toUpperCase()} queue`;
  }

  return rule.to;
}

/**
 * Get emoji for a completion result.
 * Keyed by result name — role-independent.
 */
const RESULT_EMOJI: Record<string, string> = {
  done: "✅",
  pass: "🎉",
  fail: "❌",
  refine: "🤔",
  blocked: "🚫",
};

export function getCompletionEmoji(_role: Role, result: string): string {
  return RESULT_EMOJI[result] ?? "📋";
}

// ---------------------------------------------------------------------------
// Sync helper — ensure workflow states exist as labels in issue tracker
// ---------------------------------------------------------------------------

/**
 * Ensure all workflow state labels exist in the issue tracker.
 */
export async function ensureWorkflowLabels(
  workflow: WorkflowConfig,
  ensureLabel: (name: string, color: string) => Promise<void>,
): Promise<void> {
  const colors = getLabelColors(workflow);
  for (const [label, color] of Object.entries(colors)) {
    await ensureLabel(label, color);
  }
}
