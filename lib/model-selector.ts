/**
 * Model selection for dev/qa tasks.
 * Keyword heuristic fallback — used when the orchestrator doesn't specify a tier.
 * Returns full tier names (dev.junior, dev.medior, dev.senior, qa.reviewer, qa.tester).
 */

export type TierRecommendation = {
  tier: string;
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
 * Select appropriate developer tier based on task description.
 *
 * Developer tiers:
 * - dev.junior: very simple (typos, single-file fixes, CSS tweaks)
 * - dev.medior: standard DEV (features, bug fixes, multi-file changes)
 * - dev.senior: deep/architectural (system-wide refactoring, novel design)
 * - qa.reviewer: QA code inspection and validation
 * - qa.tester: QA manual testing
 */
export function selectTier(
  issueTitle: string,
  issueDescription: string,
  role: "dev" | "qa",
): TierRecommendation {
  if (role === "qa") {
    return {
      tier: "qa.reviewer",
      reason: "Default QA tier for code inspection and validation",
    };
  }

  const text = `${issueTitle} ${issueDescription}`.toLowerCase();
  const wordCount = text.split(/\s+/).length;

  // Check for simple task indicators
  const isSimple = SIMPLE_KEYWORDS.some((kw) => text.includes(kw));
  if (isSimple && wordCount < 100) {
    return {
      tier: "dev.junior",
      reason: `Simple task detected (keywords: ${SIMPLE_KEYWORDS.filter((kw) => text.includes(kw)).join(", ")})`,
    };
  }

  // Check for complex task indicators
  const isComplex = COMPLEX_KEYWORDS.some((kw) => text.includes(kw));
  if (isComplex || wordCount > 500) {
    return {
      tier: "dev.senior",
      reason: `Complex task detected (${isComplex ? "keywords: " + COMPLEX_KEYWORDS.filter((kw) => text.includes(kw)).join(", ") : "long description"})`,
    };
  }

  // Default: medior for standard dev work
  return {
    tier: "dev.medior",
    reason: "Standard dev task — multi-file changes, features, bug fixes",
  };
}
