/**
 * Atomic projects.json read/write operations.
 * All state mutations go through this module to prevent corruption.
 */
import fs from "node:fs/promises";
import path from "node:path";
import { homedir } from "node:os";
import { LEVEL_ALIASES, ROLE_ALIASES } from "./roles/index.js";
export type WorkerState = {
  active: boolean;
  issueId: string | null;
  startTime: string | null;
  level: string | null;
  sessions: Record<string, string | null>;
};

export type Project = {
  name: string;
  repo: string;
  groupName: string;
  deployUrl: string;
  baseBranch: string;
  deployBranch: string;
  /** Messaging channel for this project's group (e.g. "telegram", "whatsapp", "discord", "slack"). Stored at registration time. */
  channel?: string;
  /** Issue tracker provider type (github or gitlab). Auto-detected at registration, stored for reuse. */
  provider?: "github" | "gitlab";
  /** Project-level role execution: parallel (DEVELOPER+TESTER can run simultaneously) or sequential (only one role at a time). Default: parallel */
  roleExecution?: "parallel" | "sequential";
  maxDevWorkers?: number;
  maxQaWorkers?: number;
  /** Worker state per role (developer, tester, architect, or custom roles). */
  workers: Record<string, WorkerState>;
};

export type ProjectsData = {
  projects: Record<string, Project>;
};

function migrateLevel(level: string | null, role: string): string | null {
  if (!level) return null;
  return LEVEL_ALIASES[role]?.[level] ?? level;
}

function migrateSessions(
  sessions: Record<string, string | null>,
  role: string,
): Record<string, string | null> {
  const aliases = LEVEL_ALIASES[role];
  if (!aliases) return sessions;

  const migrated: Record<string, string | null> = {};
  for (const [key, value] of Object.entries(sessions)) {
    const newKey = aliases[key] ?? key;
    migrated[newKey] = value;
  }
  return migrated;
}

function parseWorkerState(worker: Record<string, unknown>, role: string): WorkerState {
  const level = (worker.level ?? worker.tier ?? null) as string | null;
  const sessions = (worker.sessions as Record<string, string | null>) ?? {};
  return {
    active: worker.active as boolean,
    issueId: worker.issueId as string | null,
    startTime: worker.startTime as string | null,
    level: migrateLevel(level, role),
    sessions: migrateSessions(sessions, role),
  };
}

/**
 * Create a blank WorkerState with null sessions for given level names.
 */
export function emptyWorkerState(levels: string[]): WorkerState {
  const sessions: Record<string, string | null> = {};
  for (const l of levels) {
    sessions[l] = null;
  }
  return {
    active: false,
    issueId: null,
    startTime: null,
    level: null,
    sessions,
  };
}

/**
 * Get session key for a specific level from a worker's sessions map.
 */
export function getSessionForLevel(
  worker: WorkerState,
  level: string,
): string | null {
  return worker.sessions[level] ?? null;
}

function projectsPath(workspaceDir: string): string {
  return path.join(workspaceDir, "projects", "projects.json");
}

export async function readProjects(workspaceDir: string): Promise<ProjectsData> {
  const raw = await fs.readFile(projectsPath(workspaceDir), "utf-8");
  const data = JSON.parse(raw) as ProjectsData;

  for (const project of Object.values(data.projects)) {
    // Migrate old format: hardcoded dev/qa/architect fields → workers map
    const raw = project as unknown as Record<string, unknown>;
    if (!raw.workers && (raw.dev || raw.qa || raw.architect)) {
      project.workers = {};
      for (const role of ["dev", "qa", "architect"]) {
        const canonical = ROLE_ALIASES[role] ?? role;
        project.workers[canonical] = raw[role]
          ? parseWorkerState(raw[role] as Record<string, unknown>, role)
          : emptyWorkerState([]);
      }
      // Clean up old fields from the in-memory object
      delete raw.dev;
      delete raw.qa;
      delete raw.architect;
    } else if (raw.workers) {
      // New format: parse each worker with role-aware migration
      const workers = raw.workers as Record<string, Record<string, unknown>>;
      project.workers = {};
      for (const [role, worker] of Object.entries(workers)) {
        // Migrate old role keys (dev→developer, qa→tester)
        const canonical = ROLE_ALIASES[role] ?? role;
        project.workers[canonical] = parseWorkerState(worker, role);
      }
    } else {
      project.workers = {};
    }

    if (!project.channel) {
      project.channel = "telegram";
    }
  }

  return data;
}

export async function writeProjects(
  workspaceDir: string,
  data: ProjectsData,
): Promise<void> {
  const filePath = projectsPath(workspaceDir);
  const tmpPath = filePath + ".tmp";
  await fs.writeFile(tmpPath, JSON.stringify(data, null, 2) + "\n", "utf-8");
  await fs.rename(tmpPath, filePath);
}

export function getProject(
  data: ProjectsData,
  groupId: string,
): Project | undefined {
  return data.projects[groupId];
}

export function getWorker(
  project: Project,
  role: string,
): WorkerState {
  return project.workers[role] ?? emptyWorkerState([]);
}

/**
 * Update worker state for a project. Only provided fields are updated.
 * Sessions are merged (not replaced) when both existing and new sessions are present.
 */
export async function updateWorker(
  workspaceDir: string,
  groupId: string,
  role: string,
  updates: Partial<WorkerState>,
): Promise<ProjectsData> {
  const data = await readProjects(workspaceDir);
  const project = data.projects[groupId];
  if (!project) {
    throw new Error(`Project not found for groupId: ${groupId}`);
  }

  const worker = project.workers[role] ?? emptyWorkerState([]);

  if (updates.sessions && worker.sessions) {
    updates.sessions = { ...worker.sessions, ...updates.sessions };
  }

  project.workers[role] = { ...worker, ...updates };

  await writeProjects(workspaceDir, data);
  return data;
}

/**
 * Mark a worker as active with a new task.
 * Stores session key in sessions[level] when a new session is spawned.
 */
export async function activateWorker(
  workspaceDir: string,
  groupId: string,
  role: string,
  params: {
    issueId: string;
    level: string;
    sessionKey?: string;
    startTime?: string;
  },
): Promise<ProjectsData> {
  const updates: Partial<WorkerState> = {
    active: true,
    issueId: params.issueId,
    level: params.level,
  };
  if (params.sessionKey !== undefined) {
    updates.sessions = { [params.level]: params.sessionKey };
  }
  if (params.startTime !== undefined) {
    updates.startTime = params.startTime;
  }
  return updateWorker(workspaceDir, groupId, role, updates);
}

/**
 * Mark a worker as inactive after task completion.
 * Preserves sessions map and level for reuse via updateWorker's spread.
 * Clears startTime to prevent stale timestamps on inactive workers.
 */
export async function deactivateWorker(
  workspaceDir: string,
  groupId: string,
  role: string,
): Promise<ProjectsData> {
  return updateWorker(workspaceDir, groupId, role, {
    active: false,
    issueId: null,
    startTime: null,
  });
}

/**
 * Resolve repo path from projects.json repo field (handles ~/ expansion).
 */
export function resolveRepoPath(repoField: string): string {
  if (repoField.startsWith("~/")) {
    return repoField.replace("~", homedir());
  }
  return repoField;
}
