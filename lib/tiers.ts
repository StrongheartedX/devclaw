/**
 * Developer level definitions and model resolution.
 *
 * Level names are plain: "junior", "senior", "reviewer", etc.
 * Role context (dev/qa) is always provided by the caller or parent structure.
 */

export const DEV_LEVELS = ["junior", "medior", "senior"] as const;
export const QA_LEVELS = ["reviewer", "tester"] as const;
export const ARCHITECT_LEVELS = ["opus", "sonnet"] as const;

export type DevLevel = (typeof DEV_LEVELS)[number];
export type QaLevel = (typeof QA_LEVELS)[number];
export type ArchitectLevel = (typeof ARCHITECT_LEVELS)[number];
export type Level = DevLevel | QaLevel | ArchitectLevel;

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
  architect: {
    opus: "anthropic/claude-opus-4-5",
    sonnet: "anthropic/claude-sonnet-4-5",
  },
};

/** Emoji used in announcements, nested by role. */
export const LEVEL_EMOJI = {
  dev: {
    junior: "⚡",
    medior: "🔧",
    senior: "🧠",
  },
  qa: {
    reviewer: "🔍",
    tester: "👀",
  },
  architect: {
    opus: "🏗️",
    sonnet: "📐",
  },
};

/** Check if a level belongs to the dev role. */
export function isDevLevel(value: string): value is DevLevel {
  return (DEV_LEVELS as readonly string[]).includes(value);
}

/** Check if a level belongs to the qa role. */
export function isQaLevel(value: string): value is QaLevel {
  return (QA_LEVELS as readonly string[]).includes(value);
}

/** Check if a level belongs to the architect role. */
export function isArchitectLevel(value: string): value is ArchitectLevel {
  return (ARCHITECT_LEVELS as readonly string[]).includes(value);
}

/** Determine the role a level belongs to. */
export function levelRole(level: string): WorkerRole | undefined {
  if (isDevLevel(level)) return "dev";
  if (isQaLevel(level)) return "qa";
  if (isArchitectLevel(level)) return "architect";
  return undefined;
}

/** All valid worker roles. */
export type WorkerRole = "dev" | "qa" | "architect";

/** Get the default model for a role + level. */
export function defaultModel(role: WorkerRole, level: string): string | undefined {
  return (DEFAULT_MODELS[role] as Record<string, string>)[level];
}

/** Get the emoji for a role + level. */
export function levelEmoji(role: WorkerRole, level: string): string | undefined {
  return (LEVEL_EMOJI[role] as Record<string, string>)[level];
}

/**
 * Resolve a level to a full model ID.
 *
 * Resolution order:
 * 1. Plugin config `models.<role>.<level>`
 * 2. DEFAULT_MODELS[role][level]
 * 3. Passthrough (treat as raw model ID)
 */
export function resolveModel(
  role: WorkerRole,
  level: string,
  pluginConfig?: Record<string, unknown>,
): string {
  const models = (pluginConfig as { models?: Record<string, unknown> })?.models;

  if (models && typeof models === "object") {
    const roleModels = models[role] as Record<string, string> | undefined;
    if (roleModels?.[level]) return roleModels[level];
  }

  return defaultModel(role, level) ?? level;
}
