/**
 * llm-model-selector.ts — LLM-powered intelligent model selection.
 *
 * Uses an LLM to understand model capabilities and assign optimal models to DevClaw roles.
 */
import { execSync } from "node:child_process";
import { writeFileSync, unlinkSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

export type ModelAssignment = {
  dev: {
    junior: string;
    medior: string;
    senior: string;
  };
  qa: {
    reviewer: string;
    tester: string;
  };
};

/**
 * Use an LLM to intelligently select and assign models to DevClaw roles.
 */
export async function selectModelsWithLLM(
  availableModels: Array<{ model: string; provider: string }>,
  sessionKey?: string,
): Promise<ModelAssignment | null> {
  if (availableModels.length === 0) {
    return null;
  }

  // If only one model, assign it to all roles
  if (availableModels.length === 1) {
    const model = availableModels[0].model;
    return {
      dev: { junior: model, medior: model, senior: model },
      qa: { reviewer: model, tester: model },
    };
  }

  // Create a prompt for the LLM
  const modelList = availableModels.map((m) => m.model).join("\n");

  const prompt = `You are an AI model expert. Analyze the following authenticated AI models and assign them to DevClaw development roles based on their capabilities.

Available models:
${modelList}

Assign models to these roles based on capability:
- **senior** (most capable): Complex architecture, refactoring, critical decisions
- **medior** (balanced): Features, bug fixes, code review
- **junior** (fast/efficient): Simple fixes, testing, routine tasks
- **reviewer** (same as medior): Code review
- **tester** (same as junior): Testing

Rules:
1. Prefer same provider for consistency
2. Assign most capable model to senior
3. Assign mid-tier model to medior/reviewer
4. Assign fastest/cheapest model to junior/tester
5. Consider model version numbers (higher = newer/better)
6. Stable versions (no date) > snapshot versions (with date like 20250514)

Return ONLY a JSON object in this exact format (no markdown, no explanation):
{
  "dev": {
    "junior": "provider/model-name",
    "medior": "provider/model-name",
    "senior": "provider/model-name"
  },
  "qa": {
    "reviewer": "provider/model-name",
    "tester": "provider/model-name"
  }
}`;

  // Write prompt to temp file for safe passing to shell
  const tmpFile = join(tmpdir(), `devclaw-model-select-${Date.now()}.txt`);
  writeFileSync(tmpFile, prompt, "utf-8");

  try {
    // Call openclaw agent using current session context if available
    const sessionFlag = sessionKey
      ? `--session-id "${sessionKey}"`
      : `--session-id devclaw-model-selection`;

    const result = execSync(
      `openclaw agent --local ${sessionFlag} --message "$(cat ${tmpFile})" --json`,
      {
        encoding: "utf-8",
        timeout: 30000,
        stdio: ["pipe", "pipe", "ignore"],
      },
    ).trim();

    // Parse the response from openclaw agent --json
    const lines = result.split("\n");
    const jsonStartIndex = lines.findIndex((line) => line.trim().startsWith("{"));

    if (jsonStartIndex === -1) {
      throw new Error("No JSON found in LLM response");
    }

    const jsonString = lines.slice(jsonStartIndex).join("\n");

    // openclaw agent --json returns: { payloads: [{ text: "```json\n{...}\n```" }], meta: {...} }
    const response = JSON.parse(jsonString);

    if (!response.payloads || !Array.isArray(response.payloads) || response.payloads.length === 0) {
      throw new Error("Invalid openclaw agent response structure - missing payloads");
    }

    // Extract text from first payload
    const textContent = response.payloads[0].text;
    if (!textContent) {
      throw new Error("Empty text content in openclaw agent payload");
    }

    // Strip markdown code blocks (```json and ```)
    const cleanJson = textContent
      .replace(/```json\n?/g, '')
      .replace(/```\n?/g, '')
      .trim();

    // Parse the actual model assignment JSON
    const assignment = JSON.parse(cleanJson);

    // Log what we got for debugging
    console.log("LLM returned:", JSON.stringify(assignment, null, 2));

    // Validate the structure
    if (
      !assignment.dev?.junior ||
      !assignment.dev?.medior ||
      !assignment.dev?.senior ||
      !assignment.qa?.reviewer ||
      !assignment.qa?.tester
    ) {
      console.error("Invalid assignment structure. Got:", assignment);
      throw new Error(`Invalid assignment structure from LLM. Missing fields in: ${JSON.stringify(Object.keys(assignment))}`);
    }

    return assignment as ModelAssignment;
  } catch (err) {
    console.error("LLM model selection failed:", (err as Error).message);
    return null;
  } finally {
    // Clean up temp file
    try {
      unlinkSync(tmpFile);
    } catch {
      // Ignore cleanup errors
    }
  }
}
