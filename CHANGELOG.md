# Changelog

All notable changes to DevClaw will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [1.0.0] - 2026-02-12

### 🎉 First Official Launch

DevClaw is now production-ready! Turn any group chat into a dev team that ships.

This is the first stable release of DevClaw, a plugin for [OpenClaw](https://openclaw.ai) that transforms your orchestrator agent into a development manager. It hires developers, assigns tasks, reviews code, and keeps the pipeline moving — across as many projects as you have group chats.

### ✨ Core Features

#### Multi-Project Development Pipeline
- **Autonomous scheduling engine** — `work_heartbeat` continuously scans queues, dispatches workers, and drives DEV → QA → DEV feedback loops with zero LLM tokens
- **Project isolation** — Each project has its own queue, workers, sessions, and state
- **Parallel execution** — DEV and QA work simultaneously within projects, multiple projects run concurrently

#### Intelligent Developer Assignment
- **Tier-based model selection** — Junior (Haiku) for simple fixes, Medior (Sonnet) for features, Senior (Opus) for architecture
- **Automatic complexity evaluation** — Orchestrator analyzes tasks and assigns appropriate developer level
- **Session reuse** — Workers accumulate codebase knowledge across tasks, reducing token usage by 40-60%

#### Process Enforcement
- **GitHub/GitLab integration** — Issues are the single source of truth, not an internal database
- **Atomic operations** — Label transitions, state updates, and session dispatch happen atomically with rollback on failure
- **Tool-based guardrails** — 11 tools enforce the development process deterministically

#### Token Efficiency
- **~60-80% token savings** through tier selection, session reuse, and token-free scheduling
- **No reasoning overhead** — Plugin handles orchestration mechanics, agent provides intent only

### 🚀 Recent Improvements

#### Added
- **LLM-powered model auto-configuration** — Intelligent model selection based on task complexity
- **Enhanced onboarding experience** — Model access verification and Telegram group guidance
- **Orchestrator role enforcement** — Clear separation between planning (orchestrator) and implementation (workers)
- **Role-specific instructions** — Per-project, per-role instruction files injected at dispatch time
- **Automatic log truncation** — Maintains last 250 audit log entries for manageable file sizes
- **Comprehensive documentation** — Architecture, tools reference, configuration guide, QA workflow, and more

#### Fixed
- **Worker health monitoring** — Detects and recovers from crashed or stale worker sessions
- **Label transition atomicity** — Clean state management prevents orphaned labels
- **Session persistence** — Workers properly maintain context between tasks

### 📚 Documentation

Comprehensive documentation available in the `docs/` directory:
- [Architecture](docs/ARCHITECTURE.md) — System design and data flow
- [Tools Reference](docs/TOOLS.md) — All 11 tools with parameters
- [Configuration](docs/CONFIGURATION.md) — `openclaw.json` and `projects.json` schemas
- [Onboarding Guide](docs/ONBOARDING.md) — Step-by-step setup
- [QA Workflow](docs/QA_WORKFLOW.md) — Review process and templates
- [Management Theory](docs/MANAGEMENT.md) — Design philosophy

### 🔧 Installation

```bash
openclaw plugins install @laurentenhoor/devclaw
```

Then start onboarding:
```bash
openclaw chat "Hey, can you help me set up DevClaw?"
```

### 📦 Requirements

- OpenClaw >= 2026.0.0
- Node.js >= 20
- `gh` CLI (GitHub) or `glab` CLI (GitLab), authenticated

---

## [0.1.1] - 2026-01-XX

### Fixed
- Correct npm package entry point and include manifest file
- Update installation commands to reflect new package name

---

## [0.1.0] - 2026-01-XX

### Added
- Initial npm publishing infrastructure
- Core plugin functionality
- Work heartbeat service for autonomous scheduling
- Multi-project support with isolated state
- Developer tier system (Junior/Medior/Senior)
- QA workflow with Reviewer/Tester roles
- 11 tools for task and workflow management
- GitHub and GitLab issue provider integration
- Session reuse and context accumulation
- Audit logging system

---

[1.0.0]: https://github.com/laurentenhoor/devclaw/compare/v0.1.1...v1.0.0
[0.1.1]: https://github.com/laurentenhoor/devclaw/compare/v0.1.0...v0.1.1
[0.1.0]: https://github.com/laurentenhoor/devclaw/releases/tag/v0.1.0
