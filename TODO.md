# DevClaw Onboarding Guide

Welcome! This guide will get you up and running with DevClaw, the multi-project development pipeline plugin for OpenClaw.

---

## Prerequisites

Before you begin, ensure you have the following installed:

- **Node.js** >= 20
- **OpenClaw** (the agent framework)
- **GitLab CLI (`glab`)** OR **GitHub CLI (`gh`)** — authenticated with your account

### Check your versions

```bash
node --version    # Should be v20 or higher
openclaw --version
```

### Install GLab (GitLab)

```bash
# macOS
brew install glab

# Linux (Debian/Ubuntu)
sudo apt install glab

# Authenticate
glab auth login
```

### Install GitHub CLI

```bash
# macOS
brew install gh

# Linux
sudo apt install gh

# Authenticate
gh auth login
```

---

## 1. Clone the Repository

```bash
git clone https://github.com/laurentenhoor/devclaw.git
cd devclaw
```

---

## 2. Install Dependencies

```bash
npm install
```

---

## 3. Build & Type Check

Run TypeScript checks:

```bash
npm run check
```

Or watch for changes during development:

```bash
npm run watch
```

---

## 4. Install the Plugin

Copy the plugin to your OpenClaw extensions directory:

```bash
cp -r . ~/.openclaw/extensions/devclaw
```

---

## 5. Run Setup

Run the interactive setup to create your orchestrator agent:

```bash
openclaw devclaw setup
```

This will:
- Create AGENTS.md and HEARTBEAT.md in your workspace
- Scaffold role instruction templates
- Configure model tiers (junior/medior/senior/qa)
- Optionally create a new agent with channel bindings

---

## 6. Register Your First Project

Add the bot to a Telegram or WhatsApp group, then register a project:

```
project_register
  projectGroupId: "-1234567890"
  name: "my-webapp"
  repo: "~/git/my-webapp"
  baseBranch: "main"
```

---

## Development Workflow

### Making Changes

1. Edit TypeScript source files
2. Run `npm run check` to verify
3. Re-install to OpenClaw extensions: `cp -r . ~/.openclaw/extensions/devclaw`
4. Restart OpenClaw to pick up changes

### Project Structure

```
devclaw/
├── index.ts              # Plugin entry point
├── lib/                  # Core library code
│   ├── commands/         # CLI command handlers
│   └── providers/        # GitLab/GitHub providers
├── roles/                # Worker role instructions (generated)
│   ├── default/          # Default dev.md and qa.md
│   └── <project>/        # Per-project overrides
├── docs/                 # Documentation
├── assets/               # Logo and images
├── package.json          # Dependencies and scripts
└── tsconfig.json         # TypeScript config
```

---

## Next Steps

- Read the [README](README.md) for full documentation
- Check [docs/ONBOARDING.md](docs/ONBOARDING.md) for detailed setup instructions
- Configure model tiers in your `openclaw.json`
- Create your first task with `task_create`

---

## Troubleshooting

### TypeScript errors

Ensure you're using TypeScript 5.8 or later:

```bash
npx tsc --version
```

### Plugin not loading

Check that the plugin is in the correct location:

```bash
ls ~/.openclaw/extensions/devclaw
```

### GLab/GitHub CLI not found

Make sure the CLI is in your PATH and authenticated:

```bash
which glab    # or: which gh
glab auth status
```

---

## Resources

- [OpenClaw Documentation](https://docs.openclaw.ai)
- [GitLab CLI Docs](https://docs.gitlab.com/ee/integration/glab/)
- [GitHub CLI Docs](https://cli.github.com/manual/)
- [Issue Tracker](https://github.com/laurentenhoor/devclaw/issues)
