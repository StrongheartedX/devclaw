/**
 * cli.ts — CLI command for `openclaw devclaw setup`.
 *
 * Interactive and non-interactive modes for onboarding.
 */
import { createInterface } from "node:readline";
import { runSetup, type SetupOpts } from "./setup.js";
import { ALL_TIERS, DEFAULT_MODELS, type Tier } from "./tiers.js";

type CliArgs = {
  /** Create a new agent */
  newAgent?: string;
  /** Use existing agent */
  agent?: string;
  /** Direct workspace path */
  workspace?: string;
  /** Model overrides */
  junior?: string;
  medior?: string;
  senior?: string;
  qa?: string;
  /** Skip prompts */
  nonInteractive?: boolean;
};

/**
 * Parse CLI arguments from argv-style array.
 * Expects: ["setup", "--new-agent", "name", "--junior", "model", ...]
 */
export function parseArgs(argv: string[]): CliArgs {
  const args: CliArgs = {};
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    const next = argv[i + 1];
    switch (arg) {
      case "--new-agent":
        args.newAgent = next;
        i++;
        break;
      case "--agent":
        args.agent = next;
        i++;
        break;
      case "--workspace":
        args.workspace = next;
        i++;
        break;
      case "--junior":
        args.junior = next;
        i++;
        break;
      case "--medior":
        args.medior = next;
        i++;
        break;
      case "--senior":
        args.senior = next;
        i++;
        break;
      case "--qa":
        args.qa = next;
        i++;
        break;
      case "--non-interactive":
        args.nonInteractive = true;
        break;
    }
  }
  return args;
}

/**
 * Run the interactive setup wizard.
 */
async function interactiveSetup(): Promise<SetupOpts> {
  const rl = createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  const ask = (question: string): Promise<string> =>
    new Promise((resolve) => rl.question(question, resolve));

  console.log("");
  console.log("DevClaw Setup");
  console.log("=============");
  console.log("");

  // Step 1: Agent
  console.log("Step 1: Agent");
  console.log("─────────────");
  const agentChoice = await ask(
    "Create a new agent or use an existing one? [new/existing]: ",
  );

  let newAgentName: string | undefined;
  let agentId: string | undefined;

  if (agentChoice.toLowerCase().startsWith("n")) {
    newAgentName = await ask("Agent name: ");
    if (!newAgentName.trim()) {
      rl.close();
      throw new Error("Agent name cannot be empty");
    }
    newAgentName = newAgentName.trim();
  } else {
    agentId = await ask("Agent ID: ");
    if (!agentId.trim()) {
      rl.close();
      throw new Error("Agent ID cannot be empty");
    }
    agentId = agentId.trim();
  }

  // Step 2: Models
  console.log("");
  console.log("Step 2: Developer Team (models)");
  console.log("───────────────────────────────");
  console.log("Press Enter to accept defaults.");
  console.log("");

  const models: Partial<Record<Tier, string>> = {};
  for (const tier of ALL_TIERS) {
    const label =
      tier === "junior"
        ? "Junior dev (fast, cheap tasks)"
        : tier === "medior"
          ? "Medior dev (standard tasks)"
          : tier === "senior"
            ? "Senior dev (complex tasks)"
            : "QA engineer (code review)";
    const answer = await ask(`  ${label} [${DEFAULT_MODELS[tier]}]: `);
    if (answer.trim()) {
      models[tier] = answer.trim();
    }
  }

  rl.close();

  console.log("");
  console.log("Step 3: Workspace");
  console.log("─────────────────");

  return { newAgentName, agentId, models };
}

/**
 * Main CLI entry point.
 */
export async function runCli(argv: string[]): Promise<void> {
  const args = parseArgs(argv);

  let opts: SetupOpts;

  if (args.nonInteractive || args.newAgent || args.agent || args.workspace) {
    // Non-interactive mode
    const models: Partial<Record<Tier, string>> = {};
    if (args.junior) models.junior = args.junior;
    if (args.medior) models.medior = args.medior;
    if (args.senior) models.senior = args.senior;
    if (args.qa) models.qa = args.qa;

    opts = {
      newAgentName: args.newAgent,
      agentId: args.agent,
      workspacePath: args.workspace,
      models: Object.keys(models).length > 0 ? models : undefined,
    };
  } else {
    // Interactive mode
    opts = await interactiveSetup();
  }

  console.log("");
  const result = await runSetup(opts);

  // Print results
  if (result.agentCreated) {
    console.log(`  Agent "${result.agentId}" created`);
  }

  console.log(`  Models configured:`);
  for (const tier of ALL_TIERS) {
    console.log(`    ${tier}: ${result.models[tier]}`);
  }

  console.log(`  Files written:`);
  for (const file of result.filesWritten) {
    console.log(`    ${file}`);
  }

  if (result.warnings.length > 0) {
    console.log("");
    console.log("  Warnings:");
    for (const w of result.warnings) {
      console.log(`    ${w}`);
    }
  }

  console.log("");
  console.log("Done! Next steps:");
  console.log("  1. Add bot to a Telegram group");
  console.log(
    '  2. Register a project: "Register project <name> at <repo> for group <id>"',
  );
  console.log("  3. Create your first issue and pick it up");
  console.log("");
}
