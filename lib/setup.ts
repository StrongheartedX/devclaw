/**
 * setup.ts — Shared setup logic for DevClaw onboarding.
 *
 * Used by both the `devclaw_setup` tool and the `openclaw devclaw setup` CLI command.
 * Handles: agent creation, model configuration, workspace file writes.
 */
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import fs from "node:fs/promises";
import path from "node:path";
import { ALL_TIERS, DEFAULT_MODELS, type Tier } from "./tiers.js";
import {
  AGENTS_MD_TEMPLATE,
  HEARTBEAT_MD_TEMPLATE,
  DEFAULT_DEV_INSTRUCTIONS,
  DEFAULT_QA_INSTRUCTIONS,
} from "./templates.js";

const execFileAsync = promisify(execFile);

export type SetupOpts = {
  /** Create a new agent with this name. Mutually exclusive with agentId. */
  newAgentName?: string;
  /** Use an existing agent by ID. Mutually exclusive with newAgentName. */
  agentId?: string;
  /** Override workspace path (auto-detected from agent if not given). */
  workspacePath?: string;
  /** Model overrides per tier. Missing tiers use defaults. */
  models?: Partial<Record<Tier, string>>;
};

export type SetupResult = {
  agentId: string;
  agentCreated: boolean;
  workspacePath: string;
  models: Record<Tier, string>;
  filesWritten: string[];
  warnings: string[];
};

/**
 * Run the full DevClaw setup.
 *
 * 1. Create agent (optional) or resolve existing workspace
 * 2. Merge model config and write to openclaw.json
 * 3. Write workspace files (AGENTS.md, HEARTBEAT.md, roles, memory)
 */
export async function runSetup(opts: SetupOpts): Promise<SetupResult> {
  const warnings: string[] = [];
  const filesWritten: string[] = [];
  let agentId: string;
  let agentCreated = false;
  let workspacePath: string;

  // --- Step 1: Agent ---
  if (opts.newAgentName) {
    const result = await createAgent(opts.newAgentName);
    agentId = result.agentId;
    workspacePath = result.workspacePath;
    agentCreated = true;
  } else if (opts.agentId) {
    agentId = opts.agentId;
    workspacePath = opts.workspacePath ?? await resolveWorkspacePath(agentId);
  } else if (opts.workspacePath) {
    agentId = "unknown";
    workspacePath = opts.workspacePath;
  } else {
    throw new Error(
      "Setup requires either newAgentName, agentId, or workspacePath",
    );
  }

  // --- Step 2: Models ---
  const models = { ...DEFAULT_MODELS };
  if (opts.models) {
    for (const [tier, model] of Object.entries(opts.models)) {
      if (model && (ALL_TIERS as readonly string[]).includes(tier)) {
        models[tier as Tier] = model;
      }
    }
  }

  // Write plugin config to openclaw.json
  await writePluginConfig(models);

  // --- Step 3: Workspace files ---

  // AGENTS.md (backup existing)
  const agentsMdPath = path.join(workspacePath, "AGENTS.md");
  await backupAndWrite(agentsMdPath, AGENTS_MD_TEMPLATE);
  filesWritten.push("AGENTS.md");

  // HEARTBEAT.md
  const heartbeatPath = path.join(workspacePath, "HEARTBEAT.md");
  await backupAndWrite(heartbeatPath, HEARTBEAT_MD_TEMPLATE);
  filesWritten.push("HEARTBEAT.md");

  // roles/default/dev.md and qa.md
  const rolesDefaultDir = path.join(workspacePath, "roles", "default");
  await fs.mkdir(rolesDefaultDir, { recursive: true });

  const devRolePath = path.join(rolesDefaultDir, "dev.md");
  const qaRolePath = path.join(rolesDefaultDir, "qa.md");

  if (!await fileExists(devRolePath)) {
    await fs.writeFile(devRolePath, DEFAULT_DEV_INSTRUCTIONS, "utf-8");
    filesWritten.push("roles/default/dev.md");
  }
  if (!await fileExists(qaRolePath)) {
    await fs.writeFile(qaRolePath, DEFAULT_QA_INSTRUCTIONS, "utf-8");
    filesWritten.push("roles/default/qa.md");
  }

  // memory/projects.json
  const memoryDir = path.join(workspacePath, "memory");
  await fs.mkdir(memoryDir, { recursive: true });
  const projectsJsonPath = path.join(memoryDir, "projects.json");
  if (!await fileExists(projectsJsonPath)) {
    await fs.writeFile(
      projectsJsonPath,
      JSON.stringify({ projects: {} }, null, 2) + "\n",
      "utf-8",
    );
    filesWritten.push("memory/projects.json");
  }

  return {
    agentId,
    agentCreated,
    workspacePath,
    models,
    filesWritten,
    warnings,
  };
}

/**
 * Create a new agent via `openclaw agents add`.
 */
async function createAgent(
  name: string,
): Promise<{ agentId: string; workspacePath: string }> {
  // Generate ID from name (lowercase, hyphenated)
  const agentId = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");

  const workspacePath = path.join(
    process.env.HOME ?? "/home/lauren",
    ".openclaw",
    `workspace-${agentId}`,
  );

  try {
    await execFileAsync("openclaw", [
      "agents",
      "add",
      agentId,
      "--name",
      name,
      "--workspace",
      workspacePath,
      "--non-interactive",
    ], { timeout: 30_000 });
  } catch (err) {
    throw new Error(
      `Failed to create agent "${name}": ${(err as Error).message}`,
    );
  }

  // openclaw agents add creates a .git dir in the workspace — remove it
  const gitDir = path.join(workspacePath, ".git");
  try {
    await fs.rm(gitDir, { recursive: true });
  } catch {
    // May not exist — that's fine
  }

  return { agentId, workspacePath };
}

/**
 * Resolve workspace path from an agent ID by reading openclaw.json.
 */
async function resolveWorkspacePath(agentId: string): Promise<string> {
  const configPath = path.join(
    process.env.HOME ?? "/home/lauren",
    ".openclaw",
    "openclaw.json",
  );
  const raw = await fs.readFile(configPath, "utf-8");
  const config = JSON.parse(raw);

  const agent = config.agents?.list?.find(
    (a: { id: string }) => a.id === agentId,
  );
  if (!agent?.workspace) {
    throw new Error(
      `Agent "${agentId}" not found in openclaw.json or has no workspace configured.`,
    );
  }

  return agent.workspace;
}

/**
 * Write DevClaw model tier config to openclaw.json plugins section.
 * Read-modify-write to preserve existing config.
 */
async function writePluginConfig(
  models: Record<Tier, string>,
): Promise<void> {
  const configPath = path.join(
    process.env.HOME ?? "/home/lauren",
    ".openclaw",
    "openclaw.json",
  );
  const raw = await fs.readFile(configPath, "utf-8");
  const config = JSON.parse(raw);

  // Ensure plugins.entries.devclaw.config.models exists
  if (!config.plugins) config.plugins = {};
  if (!config.plugins.entries) config.plugins.entries = {};
  if (!config.plugins.entries.devclaw) config.plugins.entries.devclaw = {};
  if (!config.plugins.entries.devclaw.config)
    config.plugins.entries.devclaw.config = {};

  config.plugins.entries.devclaw.config.models = { ...models };

  // Atomic write
  const tmpPath = configPath + ".tmp";
  await fs.writeFile(tmpPath, JSON.stringify(config, null, 2) + "\n", "utf-8");
  await fs.rename(tmpPath, configPath);
}

/**
 * Backup existing file (if any) and write new content.
 */
async function backupAndWrite(
  filePath: string,
  content: string,
): Promise<void> {
  try {
    await fs.access(filePath);
    // File exists — backup
    const bakPath = filePath + ".bak";
    await fs.copyFile(filePath, bakPath);
  } catch {
    // File doesn't exist — ensure directory
    await fs.mkdir(path.dirname(filePath), { recursive: true });
  }
  await fs.writeFile(filePath, content, "utf-8");
}

async function fileExists(filePath: string): Promise<boolean> {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}
