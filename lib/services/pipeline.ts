/**
 * Pipeline service — declarative completion rules.
 *
 * Uses workflow config to determine transitions and side effects.
 */
import type { PluginRuntime } from "openclaw/plugin-sdk";
import type { StateLabel, IssueProvider } from "../providers/provider.js";
import { deactivateWorker } from "../projects.js";
import { runCommand } from "../run-command.js";
import { notify, getNotificationConfig } from "../notify.js";
import {
  DEFAULT_WORKFLOW,
  getCompletionRule,
  getNextStateDescription,
  getCompletionEmoji,
  type CompletionRule,
  type WorkflowConfig,
} from "../workflow.js";

// ---------------------------------------------------------------------------
// Backward compatibility exports
// ---------------------------------------------------------------------------

/**
 * @deprecated Use getCompletionRule() from workflow.ts instead.
 * Kept for backward compatibility.
 */
export const COMPLETION_RULES: Record<string, CompletionRule> = {
  "dev:done":    { from: "Doing",   to: "To Test",    gitPull: true, detectPr: true },
  "qa:pass":     { from: "Testing", to: "Done",       closeIssue: true },
  "qa:fail":     { from: "Testing", to: "To Improve", reopenIssue: true },
  "qa:refine":   { from: "Testing", to: "Refining" },
  "dev:blocked": { from: "Doing",   to: "Refining" },
  "qa:blocked":  { from: "Testing", to: "Refining" },
};

/**
 * @deprecated Use getNextStateDescription() from workflow.ts instead.
 */
export const NEXT_STATE: Record<string, string> = {
  "dev:done":    "QA queue",
  "dev:blocked": "moved to Refining - needs human input",
  "qa:pass":     "Done!",
  "qa:fail":     "back to DEV",
  "qa:refine":   "awaiting human decision",
  "qa:blocked":  "moved to Refining - needs human input",
};

// Re-export CompletionRule type for backward compatibility
export type { CompletionRule };

export type CompletionOutput = {
  labelTransition: string;
  announcement: string;
  nextState: string;
  prUrl?: string;
  issueUrl?: string;
  issueClosed?: boolean;
  issueReopened?: boolean;
};

/**
 * Get completion rule for a role:result pair.
 * Uses workflow config when available.
 */
export function getRule(
  role: string,
  result: string,
  workflow: WorkflowConfig = DEFAULT_WORKFLOW,
): CompletionRule | undefined {
  return getCompletionRule(workflow, role as "dev" | "qa", result) ?? undefined;
}

/**
 * Execute the completion side-effects for a role:result pair.
 */
export async function executeCompletion(opts: {
  workspaceDir: string;
  groupId: string;
  role: "dev" | "qa";
  result: string;
  issueId: number;
  summary?: string;
  prUrl?: string;
  provider: IssueProvider;
  repoPath: string;
  projectName: string;
  channel?: string;
  pluginConfig?: Record<string, unknown>;
  /** Plugin runtime for direct API access (avoids CLI subprocess timeouts) */
  runtime?: PluginRuntime;
  /** Workflow config (defaults to DEFAULT_WORKFLOW) */
  workflow?: WorkflowConfig;
}): Promise<CompletionOutput> {
  const {
    workspaceDir, groupId, role, result, issueId, summary, provider,
    repoPath, projectName, channel, pluginConfig, runtime,
    workflow = DEFAULT_WORKFLOW,
  } = opts;

  const key = `${role}:${result}`;
  const rule = getCompletionRule(workflow, role, result);
  if (!rule) throw new Error(`No completion rule for ${key}`);

  let prUrl = opts.prUrl;

  // Git pull (dev:done)
  if (rule.gitPull) {
    try {
      await runCommand(["git", "pull"], { timeoutMs: 30_000, cwd: repoPath });
    } catch { /* best-effort */ }
  }

  // Auto-detect PR URL (dev:done)
  if (rule.detectPr && !prUrl) {
    try { prUrl = await provider.getMergedMRUrl(issueId) ?? undefined; } catch { /* ignore */ }
  }

  // Get issue early (for URL in notification)
  const issue = await provider.getIssue(issueId);

  // Get next state description from workflow
  const nextState = getNextStateDescription(workflow, role, result);

  // Send notification early (before deactivation and label transition which can fail)
  const notifyConfig = getNotificationConfig(pluginConfig);
  notify(
    {
      type: "workerComplete",
      project: projectName,
      groupId,
      issueId,
      issueUrl: issue.web_url,
      role,
      result: result as "done" | "pass" | "fail" | "refine" | "blocked",
      summary,
      nextState,
    },
    {
      workspaceDir,
      config: notifyConfig,
      groupId,
      channel: channel ?? "telegram",
      runtime,
    },
  ).catch(() => { /* non-fatal */ });

  // Deactivate worker + transition label
  await deactivateWorker(workspaceDir, groupId, role);
  await provider.transitionLabel(issueId, rule.from as StateLabel, rule.to as StateLabel);

  // Close/reopen
  if (rule.closeIssue) await provider.closeIssue(issueId);
  if (rule.reopenIssue) await provider.reopenIssue(issueId);

  // Build announcement using workflow-derived emoji
  const emoji = getCompletionEmoji(role, result);
  const label = key.replace(":", " ").toUpperCase();
  let announcement = `${emoji} ${label} #${issueId}`;
  if (summary) announcement += ` — ${summary}`;
  announcement += `\n📋 Issue: ${issue.web_url}`;
  if (prUrl) announcement += `\n🔗 PR: ${prUrl}`;
  announcement += `\n${nextState}.`;

  return {
    labelTransition: `${rule.from} → ${rule.to}`,
    announcement,
    nextState,
    prUrl,
    issueUrl: issue.web_url,
    issueClosed: rule.closeIssue,
    issueReopened: rule.reopenIssue,
  };
}
