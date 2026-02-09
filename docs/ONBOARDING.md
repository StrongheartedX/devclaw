# DevClaw — Onboarding Guide

## What you need before starting

| Requirement | Why | How to check |
|---|---|---|
| [OpenClaw](https://openclaw.ai) installed | DevClaw is an OpenClaw plugin | `openclaw --version` |
| Node.js >= 20 | Runtime for plugin | `node --version` |
| [`glab`](https://gitlab.com/gitlab-org/cli) or [`gh`](https://cli.github.com) CLI | Issue tracker provider (auto-detected from remote) | `glab --version` or `gh --version` |
| CLI authenticated | Plugin calls glab/gh for every label transition | `glab auth status` or `gh auth status` |
| A GitLab/GitHub repo with issues | The task backlog lives in the issue tracker | `glab issue list` or `gh issue list` from your repo |

## Setup

### 1. Install the plugin

```bash
# Copy to extensions directory (auto-discovered on next restart)
cp -r devclaw ~/.openclaw/extensions/
```

Verify:
```bash
openclaw plugins list
# Should show: DevClaw | devclaw | loaded
```

### 2. Run setup

```bash
openclaw devclaw setup
```

The setup wizard walks you through:

1. **Agent** — Create a new orchestrator agent or configure an existing one
2. **Developer team** — Choose which LLM model powers each developer tier:
   - **Junior** (fast, cheap tasks) — default: `anthropic/claude-haiku-4-5`
   - **Medior** (standard tasks) — default: `anthropic/claude-sonnet-4-5`
   - **Senior** (complex tasks) — default: `anthropic/claude-opus-4-5`
   - **QA** (code review) — default: `anthropic/claude-sonnet-4-5`
3. **Workspace** — Writes AGENTS.md, HEARTBEAT.md, role templates, and initializes memory

Non-interactive mode:
```bash
# Create new agent with default models
openclaw devclaw setup --new-agent "My Dev Orchestrator" --non-interactive

# Configure existing agent with custom models
openclaw devclaw setup --agent my-orchestrator \
  --junior "anthropic/claude-haiku-4-5" \
  --senior "anthropic/claude-opus-4-5"
```

### 3. Add the agent to the Telegram group

Add your orchestrator bot to the Telegram group for the project. The agent will now receive messages from this group and can operate on the linked project.

### 4. Register your project

Tell the orchestrator agent to register a new project:

> "Register project my-project at ~/git/my-project for group -1234567890 with base branch development"

The agent calls `project_register`, which atomically:
- Validates the repo and auto-detects GitHub/GitLab from remote
- Creates all 8 state labels (idempotent)
- Scaffolds role instruction files (`roles/<project>/dev.md` and `qa.md`)
- Adds the project entry to `projects.json` with `autoChain: false`
- Logs the registration event

```json
{
  "projects": {
    "-1234567890": {
      "name": "my-project",
      "repo": "~/git/my-project",
      "groupName": "Dev - My Project",
      "deployUrl": "",
      "baseBranch": "development",
      "deployBranch": "development",
      "autoChain": false,
      "dev": {
        "active": false,
        "issueId": null,
        "startTime": null,
        "model": null,
        "sessions": { "junior": null, "medior": null, "senior": null }
      },
      "qa": {
        "active": false,
        "issueId": null,
        "startTime": null,
        "model": null,
        "sessions": { "qa": null }
      }
    }
  }
}
```

**Manual fallback:** If you prefer CLI control, you can still create labels manually with `glab label create` and edit `projects.json` directly. See the [Architecture docs](ARCHITECTURE.md) for label names and colors.

**Finding the Telegram group ID:** The group ID is the numeric ID of your Telegram supergroup (a negative number like `-1234567890`). You can find it via the Telegram bot API or from message metadata in OpenClaw logs.

### 5. Create your first issue

Issues can be created in multiple ways:
- **Via the agent** — Ask the orchestrator in the Telegram group: "Create an issue for adding a login page" (uses `task_create`)
- **Via workers** — DEV/QA workers can call `task_create` to file follow-up bugs they discover
- **Via CLI** — `cd ~/git/my-project && glab issue create --title "My first task" --label "To Do"` (or `gh issue create`)
- **Via web UI** — Create an issue and add the "To Do" label

### 6. Test the pipeline

Ask the agent in the Telegram group:

> "Check the queue status"

The agent should call `queue_status` and report the "To Do" issue. Then:

> "Pick up issue #1 for DEV"

The agent calls `task_pickup`, which assigns a developer tier, transitions the label to "Doing", creates or reuses a worker session, and dispatches the task — all in one call. The agent just posts the announcement.

## Adding more projects

Tell the agent to register a new project (step 3) and add the bot to the new Telegram group (step 4). That's it — `project_register` handles labels and state setup.

Each project is fully isolated — separate queue, separate workers, separate state.

## Developer tiers

DevClaw assigns tasks to developer tiers instead of raw model names. This makes the system intuitive — you're assigning a "junior dev" to fix a typo, not configuring model parameters.

| Tier | Role | Default model | When to assign |
|------|------|---------------|----------------|
| **junior** | Junior developer | `anthropic/claude-haiku-4-5` | Typos, single-file fixes, CSS changes |
| **medior** | Mid-level developer | `anthropic/claude-sonnet-4-5` | Features, bug fixes, multi-file changes |
| **senior** | Senior developer | `anthropic/claude-opus-4-5` | Architecture, migrations, system-wide refactoring |
| **qa** | QA engineer | `anthropic/claude-sonnet-4-5` | Code review, test validation |

Change which model powers each tier in `openclaw.json`:
```json
{
  "plugins": {
    "entries": {
      "devclaw": {
        "config": {
          "models": {
            "junior": "anthropic/claude-haiku-4-5",
            "medior": "anthropic/claude-sonnet-4-5",
            "senior": "anthropic/claude-opus-4-5",
            "qa": "anthropic/claude-sonnet-4-5"
          }
        }
      }
    }
  }
}
```

## What the plugin handles vs. what you handle

| Responsibility | Who | Details |
|---|---|---|
| Plugin installation | You (once) | `cp -r devclaw ~/.openclaw/extensions/` |
| Agent + workspace setup | Plugin (`devclaw setup`) | Creates agent, configures models, writes workspace files |
| Label setup | Plugin (`project_register`) | 8 labels, created idempotently via `IssueProvider` |
| Role file scaffolding | Plugin (`project_register`) | Creates `roles/<project>/dev.md` and `qa.md` from defaults |
| Project registration | Plugin (`project_register`) | Entry in `projects.json` with empty worker state |
| Telegram group setup | You (once per project) | Add bot to group |
| Issue creation | Plugin (`task_create`) | Orchestrator or workers create issues from chat |
| Label transitions | Plugin | Atomic label transitions via issue tracker CLI |
| Developer assignment | Plugin | LLM-selected tier by orchestrator, keyword heuristic fallback |
| State management | Plugin | Atomic read/write to `projects.json` |
| Session management | Plugin | Creates, reuses, and dispatches to sessions via CLI. Agent never touches session tools. |
| Task completion | Plugin (`task_complete`) | Workers self-report. Auto-chains if enabled. |
| Role instructions | Plugin (`task_pickup`) | Loaded from `roles/<project>/<role>.md`, appended to task message |
| Audit logging | Plugin | Automatic NDJSON append per tool call |
| Zombie detection | Plugin | `session_health` checks active vs alive |
| Queue scanning | Plugin | `queue_status` queries issue tracker per project |
