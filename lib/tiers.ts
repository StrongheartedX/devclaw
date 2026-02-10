/**
 * Developer tier definitions and model resolution.
 *
 * Tier names always include the role prefix: "dev.junior", "qa.reviewer", etc.
 * This makes tier names globally unique and self-documenting.
 */

export const DEV_TIERS = ["dev.junior", "dev.medior", "dev.senior"] as const;
export const QA_TIERS = ["qa.reviewer", "qa.tester"] as const;
export const ALL_TIERS = [...DEV_TIERS, ...QA_TIERS] as const;

export type DevTier = (typeof DEV_TIERS)[number];
export type QaTier = (typeof QA_TIERS)[number];
export type Tier = (typeof ALL_TIERS)[number];

/** Default models, nested by role. */
export const DEFAULT_MODELS = {
  dev: {
    junior: "anthropic/claude-haiku-4-5",
    medior: "anthropic/claude-sonnet-4-5",
    senior: "anthropic/claude-opus-4-5",
  },
  qa: {
    reviewer: "anthropic/claude-sonnet-4-5",
    tester: "anthropic/claude-haiku-4-5",
  },
};

/** Emoji used in announcements, nested by role. */
export const TIER_EMOJI = {
  dev: {
    junior: "⚡",
    medior: "🔧",
    senior: "🧠",
  },
  qa: {
    reviewer: "🔍",
    tester: "👀",
  },
};

/** Check if a string is a valid tier name. */
export function isTier(value: string): value is Tier {
  return (ALL_TIERS as readonly string[]).includes(value);
}

/** Check if a tier belongs to the dev role. */
export function isDevTier(value: string): value is DevTier {
  return (DEV_TIERS as readonly string[]).includes(value);
}

/** Extract the role from a tier name (e.g. "dev.junior" → "dev"). */
export function tierRole(tier: string): "dev" | "qa" | undefined {
  if (tier.startsWith("dev.")) return "dev";
  if (tier.startsWith("qa.")) return "qa";
  return undefined;
}

/** Extract the short name from a tier (e.g. "dev.junior" → "junior"). */
export function tierName(tier: string): string {
  const dot = tier.indexOf(".");
  return dot >= 0 ? tier.slice(dot + 1) : tier;
}

/** Look up a value from a nested role structure using a full tier name. */
function lookupNested<T>(map: Record<string, Record<string, T>>, tier: string): T | undefined {
  const role = tierRole(tier);
  if (!role) return undefined;
  return map[role]?.[tierName(tier)];
}

/** Get the default model for a tier. */
export function defaultModel(tier: string): string | undefined {
  return lookupNested(DEFAULT_MODELS, tier);
}

/** Get the emoji for a tier. */
export function tierEmoji(tier: string): string | undefined {
  return lookupNested(TIER_EMOJI, tier);
}

/** Build a flat Record<Tier, string> of all default models. */
export function allDefaultModels(): Record<Tier, string> {
  const result = {} as Record<Tier, string>;
  for (const tier of ALL_TIERS) {
    result[tier] = defaultModel(tier)!;
  }
  return result;
}

/**
 * Resolve a tier name to a full model ID.
 *
 * Resolution order:
 * 1. Parse "role.name" → look up config `models.<role>.<name>`
 * 2. DEFAULT_MODELS[role][name]
 * 3. Passthrough (treat as raw model ID)
 */
export function resolveTierToModel(
  tier: string,
  pluginConfig?: Record<string, unknown>,
): string {
  const models = (pluginConfig as { models?: Record<string, unknown> })?.models;

  if (models && typeof models === "object") {
    const role = tierRole(tier);
    const name = tierName(tier);
    if (role) {
      const roleModels = models[role] as Record<string, string> | undefined;
      if (roleModels?.[name]) return roleModels[name];
    }
  }

  return defaultModel(tier) ?? tier;
}
