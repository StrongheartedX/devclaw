/**
 * Model selection for dev/qa tasks.
 * MVP: Simple heuristic-based selection. LLM-based analysis can be added later.
 */

export type ModelRecommendation = {
  model: string;
  alias: string;
  reason: string;
};

// Keywords that indicate simple tasks
const SIMPLE_KEYWORDS = [
  "typo",
  "fix typo",
  "rename",
  "update text",
  "change color",
  "minor",
  "small",
  "css",
  "style",
  "copy",
  "wording",
];

// Keywords that indicate complex tasks
const COMPLEX_KEYWORDS = [
  "architect",
  "refactor",
  "redesign",
  "system-wide",
  "migration",
  "database schema",
  "security",
  "performance",
  "infrastructure",
  "multi-service",
];

/**
 * Select appropriate model based on task description.
 *
 * Model tiers:
 * - haiku: very simple (typos, single-file fixes, CSS tweaks)
 * - grok: default QA (code inspection, validation, test runs)
 * - sonnet: default DEV (features, bug fixes, multi-file changes)
 * - opus: deep/architectural (system-wide refactoring, novel design)
 */
export function selectModel(
  issueTitle: string,
  issueDescription: string,
  role: "dev" | "qa",
): ModelRecommendation {
  if (role === "qa") {
    return {
      model: "github-copilot/grok-code-fast-1",
      alias: "grok",
      reason: "Default QA model for code inspection and validation",
    };
  }

  const text = `${issueTitle} ${issueDescription}`.toLowerCase();
  const wordCount = text.split(/\s+/).length;

  // Check for simple task indicators
  const isSimple = SIMPLE_KEYWORDS.some((kw) => text.includes(kw));
  if (isSimple && wordCount < 100) {
    return {
      model: "anthropic/claude-haiku-4-5",
      alias: "haiku",
      reason: `Simple task detected (keywords: ${SIMPLE_KEYWORDS.filter((kw) => text.includes(kw)).join(", ")})`,
    };
  }

  // Check for complex task indicators
  const isComplex = COMPLEX_KEYWORDS.some((kw) => text.includes(kw));
  if (isComplex || wordCount > 500) {
    return {
      model: "anthropic/claude-opus-4-5",
      alias: "opus",
      reason: `Complex task detected (${isComplex ? "keywords: " + COMPLEX_KEYWORDS.filter((kw) => text.includes(kw)).join(", ") : "long description"})`,
    };
  }

  // Default: sonnet for standard dev work
  return {
    model: "anthropic/claude-sonnet-4-5",
    alias: "sonnet",
    reason: "Standard dev task — multi-file changes, features, bug fixes",
  };
}
