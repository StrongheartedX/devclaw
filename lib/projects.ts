/**
 * Atomic projects.json read/write operations.
 * All state mutations go through this module to prevent corruption.
 */
import fs from "node:fs/promises";
import path from "node:path";

export type WorkerState = {
  active: boolean;
  sessionId: string | null; // Deprecated: use sessions[tier] instead
  sessions: Record<string, { sessionId: string; startTime: string } | null>;
  issueId: string | null;
  startTime: string | null;
  model: string | null;
  tier: string | null;
};

export type Project = {
  name: string;
  repo: string;
  groupName: string;
  deployUrl: string;
  baseBranch: string;
  deployBranch: string;
  dev: WorkerState;
  qa: WorkerState;
};

export type ProjectsData = {
  projects: Record<string, Project>;
};

function projectsPath(workspaceDir: string): string {
  return path.join(workspaceDir, "memory", "projects.json");
}

export async function readProjects(workspaceDir: string): Promise<ProjectsData> {
  const raw = await fs.readFile(projectsPath(workspaceDir), "utf-8");
  return JSON.parse(raw) as ProjectsData;
}

export async function writeProjects(
  workspaceDir: string,
  data: ProjectsData,
): Promise<void> {
  const filePath = projectsPath(workspaceDir);
  // Write to temp file first, then rename for atomicity
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
  role: "dev" | "qa",
): WorkerState {
  return project[role];
}

/**
 * Get the session ID for a specific tier from a worker's sessions.
 * Returns null if no session exists for that tier.
 */
export function getTierSession(
  worker: WorkerState,
  tier: string,
): { sessionId: string; startTime: string } | null {
  return worker.sessions?.[tier] ?? null;
}

/**
 * Update worker state for a project. Only provided fields are updated.
 * This prevents accidentally nulling out fields that should be preserved.
 */
export async function updateWorker(
  workspaceDir: string,
  groupId: string,
  role: "dev" | "qa",
  updates: Partial<WorkerState>,
): Promise<ProjectsData> {
  const data = await readProjects(workspaceDir);
  const project = data.projects[groupId];
  if (!project) {
    throw new Error(`Project not found for groupId: ${groupId}`);
  }

  const worker = project[role];
  project[role] = { ...worker, ...updates };

  await writeProjects(workspaceDir, data);
  return data;
}

/**
 * Mark a worker as active with a new task.
 * Sets active=true, issueId, model, tier. Preserves tier sessions.
 */
export async function activateWorker(
  workspaceDir: string,
  groupId: string,
  role: "dev" | "qa",
  params: {
    issueId: string;
    model: string;
    tier: string;
    sessionId?: string;
    startTime?: string;
  },
): Promise<ProjectsData> {
  const updates: Partial<WorkerState> = {
    active: true,
    issueId: params.issueId,
    model: params.model,
    tier: params.tier,
  };
  // Save session to tier-specific slot if provided
  if (params.sessionId !== undefined && params.startTime !== undefined) {
    const tierSession = { sessionId: params.sessionId, startTime: params.startTime };
    updates.sessions = { [params.tier]: tierSession };
    updates.sessionId = params.sessionId; // Keep for backward compatibility
  }
  return updateWorker(workspaceDir, groupId, role, updates);
}

/**
 * Mark a worker as inactive after task completion.
 * Clears issueId and active, PRESERVES tier sessions for reuse.
 * Saves current session to tier slot if tier is set.
 */
export async function deactivateWorker(
  workspaceDir: string,
  groupId: string,
  role: "dev" | "qa",
  params?: {
    tier?: string;
    sessionId?: string;
    startTime?: string;
  },
): Promise<ProjectsData> {
  const data = await readProjects(workspaceDir);
  const project = data.projects[groupId];
  if (!project) {
    throw new Error(`Project not found for groupId: ${groupId}`);
  }

  const worker = project[role];
  const updates: Partial<WorkerState> = {
    active: false,
    issueId: null,
    startTime: null,
    model: null,
    tier: null,
    // sessionId is NOT cleared - kept for backward compatibility
  };

  // Save session to tier slot for future reuse
  const tier = params?.tier ?? worker.tier;
  const sessionId = params?.sessionId ?? worker.sessionId;
  const startTime = params?.startTime ?? worker.startTime;

  if (tier && sessionId && startTime) {
    const tierSession = { sessionId, startTime };
    updates.sessions = {
      ...worker.sessions,
      [tier]: tierSession,
    };
  }

  project[role] = { ...worker, ...updates };
  await writeProjects(workspaceDir, data);
  return data;
}
