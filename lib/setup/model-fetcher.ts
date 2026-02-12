/**
 * model-fetcher.ts — Shared helper for fetching OpenClaw models without logging.
 *
 * Uses execSync to bypass OpenClaw's command logging infrastructure.
 */
import { execSync } from "node:child_process";

export type OpenClawModelRow = {
  key: string;
  name?: string;
  input: string;
  contextWindow: number | null;
  local: boolean;
  available: boolean;
  tags: string[];
  missing?: boolean;
};

/**
 * Fetch all models from OpenClaw without logging.
 *
 * @param allModels - If true, fetches all models (--all flag). If false, only authenticated models.
 * @returns Array of model objects from OpenClaw's model registry
 */
export function fetchModels(allModels = true): OpenClawModelRow[] {
  try {
    const command = allModels
      ? "openclaw models list --all --json"
      : "openclaw models list --json";

    // Use execSync directly to bypass OpenClaw's command logging
    const output = execSync(command, {
      encoding: "utf-8",
      timeout: 10000,
      cwd: process.cwd(),
      // Suppress stderr to avoid any error messages
      stdio: ["pipe", "pipe", "ignore"],
    }).trim();

    if (!output) {
      throw new Error("Empty output from openclaw models list");
    }

    // Parse JSON (skip any log lines like "[plugins] ...")
    const lines = output.split("\n");

    // Find the first line that starts with { (the beginning of JSON)
    const jsonStartIndex = lines.findIndex((line: string) => {
      const trimmed = line.trim();
      return trimmed.startsWith("{");
    });

    if (jsonStartIndex === -1) {
      throw new Error(
        `No JSON object found in output. Got: ${output.substring(0, 200)}...`,
      );
    }

    // Join all lines from the JSON start to the end
    const jsonString = lines.slice(jsonStartIndex).join("\n");

    const data = JSON.parse(jsonString);
    const models = data.models as OpenClawModelRow[];

    if (!Array.isArray(models)) {
      throw new Error(`Expected array of models, got: ${typeof models}`);
    }

    return models;
  } catch (err) {
    throw new Error(`Failed to fetch models: ${(err as Error).message}`);
  }
}

/**
 * Fetch only authenticated models (available: true).
 */
export function fetchAuthenticatedModels(): OpenClawModelRow[] {
  // Use --all flag but suppress logging via stdio in fetchModels()
  return fetchModels(true).filter((m) => m.available === true);
}
