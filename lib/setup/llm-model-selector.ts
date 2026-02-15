/**
 * llm-model-selector.ts — LLM-powered intelligent model selection.
 *
 * Uses an LLM to understand model capabilities and assign optimal models to DevClaw roles.
 */
import { runCommand } from "../run-command.js";

export type ModelAssignment = {
  developer: {
    junior: string;
    medior: string;
    senior: string;
  };
  tester: {
    junior: string;
    medior: string;
    senior: string;
  };
  architect: {
    junior: string;
    senior: string;
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
      developer: { junior: model, medior: model, senior: model },
      tester: { junior: model, medior: model, senior: model },
      architect: { junior: model, senior: model },
    };
  }

  // Create a prompt for the LLM
  const modelList = availableModels.map((m) => m.model).join("\n");

  const prompt = `You are an AI model expert. Analyze the following authenticated AI models and assign them to DevClaw development roles based on their capabilities.

Available models:
${modelList}

All roles use the same level scheme based on task complexity:
- **senior** (most capable): Complex architecture, refactoring, critical decisions
- **medior** (balanced): Features, bug fixes, code review, standard tasks
- **junior** (fast/efficient): Simple fixes, routine tasks

Rules:
1. Prefer same provider for consistency
2. Assign most capable model to senior
3. Assign mid-tier model to medior
4. Assign fastest/cheapest model to junior
5. Consider model version numbers (higher = newer/better)
6. Stable versions (no date) > snapshot versions (with date like 20250514)

Return ONLY a JSON object in this exact format (no markdown, no explanation):
{
  "developer": {
    "junior": "provider/model-name",
    "medior": "provider/model-name",
    "senior": "provider/model-name"
  },
  "tester": {
    "junior": "provider/model-name",
    "medior": "provider/model-name",
    "senior": "provider/model-name"
  },
  "architect": {
    "junior": "provider/model-name",
    "senior": "provider/model-name"
  }
}`;

  try {
    const sessionId = sessionKey ?? "devclaw-model-selection";

    const result = await runCommand(
      ["openclaw", "agent", "--local", "--session-id", sessionId, "--message", prompt, "--json"],
      { timeoutMs: 30_000 },
    );

    const output = result.stdout.trim();

    // Parse the response from openclaw agent --json
    const lines = output.split("\n");
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
    // Backfill architect if LLM didn't return it (graceful upgrade)
    if (!assignment.architect) {
      assignment.architect = {
        senior: assignment.developer?.senior ?? availableModels[0].model,
        junior: assignment.developer?.medior ?? availableModels[0].model,
      };
    }

    if (
      !assignment.developer?.junior ||
      !assignment.developer?.medior ||
      !assignment.developer?.senior ||
      !assignment.tester?.junior ||
      !assignment.tester?.medior ||
      !assignment.tester?.senior
    ) {
      console.error("Invalid assignment structure. Got:", assignment);
      throw new Error(`Invalid assignment structure from LLM. Missing fields in: ${JSON.stringify(Object.keys(assignment))}`);
    }

    return assignment as ModelAssignment;
  } catch (err) {
    console.error("LLM model selection failed:", (err as Error).message);
    return null;
  }
}
