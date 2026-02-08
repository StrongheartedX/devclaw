# DevClaw

Multi-project dev/qa pipeline orchestration plugin for [OpenClaw](https://openclaw.ai).

Replaces manual orchestration steps with atomic agent tools. Instead of 10+ error-prone manual steps per task, the agent calls a single tool that handles GitLab labels, state management, model selection, and audit logging atomically.

## Tools

| Tool | Description |
|------|-------------|
| `task_pickup` | Pick up a task from the GitLab queue. Handles label transition, model selection, state update, and session reuse detection. |
| `task_complete` | Complete a task (DEV done, QA pass/fail/refine). Handles label transition, issue close/reopen, and fix cycle preparation. |
| `queue_status` | Show task queue counts and worker status across all projects. |
| `session_health` | Detect zombie sessions, stale workers, and state mismatches. Auto-fix with `autoFix: true`. |

## Installation

```bash
# Local development (link from extensions directory)
openclaw plugins install -l ~/.openclaw/extensions/devclaw

# From npm (future)
openclaw plugins install @openclaw/devclaw
```

## Configuration

Optional plugin config in `openclaw.json`:

```json
{
  "plugins": {
    "entries": {
      "devclaw": {
        "config": {
          "glabPath": "/usr/local/bin/glab",
          "modelSelection": {
            "enabled": true,
            "analyzerModel": "anthropic/claude-haiku-4-5"
          }
        }
      }
    }
  }
}
```

Restrict tools to your orchestrator agent:

```json
{
  "agents": {
    "list": [{
      "id": "henk-development",
      "tools": {
        "allow": ["task_pickup", "task_complete", "queue_status", "session_health"]
      }
    }]
  }
}
```

## Requirements

- OpenClaw >= 0.x
- Node.js >= 20
- `glab` CLI installed and authenticated
- `memory/projects.json` in the orchestrator agent's workspace

## License

MIT
