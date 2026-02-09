/**
 * Shared utilities for DevClaw.
 */

/**
 * Resolve the repo path from projects.json repo field (handles ~/).
 */
export function resolveRepoPath(repoField: string): string {
  if (repoField.startsWith("~/")) {
    return repoField.replace("~", process.env.HOME ?? "/home/lauren");
  }
  return repoField;
}
