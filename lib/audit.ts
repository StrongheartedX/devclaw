/**
 * Append-only NDJSON audit logging.
 * Every tool call automatically logs — no manual action needed from agents.
 */
import { appendFile, mkdir } from "node:fs/promises";
import { join, dirname } from "node:path";

export async function log(
  workspaceDir: string,
  event: string,
  data: Record<string, unknown>,
): Promise<void> {
  const filePath = join(workspaceDir, "log", "audit.log");
  const entry = JSON.stringify({
    ts: new Date().toISOString(),
    event,
    ...data,
  });
  try {
    await appendFile(filePath, entry + "\n");
  } catch (err: unknown) {
    // If directory doesn't exist, create it and retry
    if ((err as NodeJS.ErrnoException).code === "ENOENT") {
      await mkdir(dirname(filePath), { recursive: true });
      await appendFile(filePath, entry + "\n");
    }
    // Audit logging should never break the tool — silently ignore other errors
  }
}
