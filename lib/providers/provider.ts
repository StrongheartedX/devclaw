/**
 * IssueProvider — Abstract interface for issue tracker operations.
 *
 * Implementations: GitHub (gh CLI), GitLab (glab CLI).
 *
 * Note: STATE_LABELS and LABEL_COLORS are kept for backward compatibility
 * but new code should use the workflow config via lib/workflow.ts.
 */
import { DEFAULT_WORKFLOW, getStateLabels, getLabelColors } from "../workflow.js";

// ---------------------------------------------------------------------------
// State labels — derived from default workflow for backward compatibility
// ---------------------------------------------------------------------------

/**
 * @deprecated Use workflow.getStateLabels() instead.
 * Kept for backward compatibility with existing code.
 */
export const STATE_LABELS = getStateLabels(DEFAULT_WORKFLOW) as readonly string[];

/**
 * StateLabel type — union of all valid state labels.
 * This remains a string type for flexibility with custom workflows.
 */
export type StateLabel = string;

/**
 * @deprecated Use workflow.getLabelColors() instead.
 * Kept for backward compatibility with existing code.
 */
export const LABEL_COLORS: Record<string, string> = getLabelColors(DEFAULT_WORKFLOW);

// ---------------------------------------------------------------------------
// Issue types
// ---------------------------------------------------------------------------

export type Issue = {
  iid: number;
  title: string;
  description: string;
  labels: string[];
  state: string;
  web_url: string;
};

export type IssueComment = {
  author: string;
  body: string;
  created_at: string;
};

// ---------------------------------------------------------------------------
// Provider interface
// ---------------------------------------------------------------------------

export interface IssueProvider {
  ensureLabel(name: string, color: string): Promise<void>;
  ensureAllStateLabels(): Promise<void>;
  createIssue(title: string, description: string, label: StateLabel, assignees?: string[]): Promise<Issue>;
  listIssuesByLabel(label: StateLabel): Promise<Issue[]>;
  getIssue(issueId: number): Promise<Issue>;
  listComments(issueId: number): Promise<IssueComment[]>;
  transitionLabel(issueId: number, from: StateLabel, to: StateLabel): Promise<void>;
  closeIssue(issueId: number): Promise<void>;
  reopenIssue(issueId: number): Promise<void>;
  hasStateLabel(issue: Issue, expected: StateLabel): boolean;
  getCurrentStateLabel(issue: Issue): StateLabel | null;
  hasMergedMR(issueId: number): Promise<boolean>;
  getMergedMRUrl(issueId: number): Promise<string | null>;
  addComment(issueId: number, body: string): Promise<void>;
  healthCheck(): Promise<boolean>;
}

/** @deprecated Use IssueProvider */
export type TaskManager = IssueProvider;
