# DevClaw — Context Awareness

DevClaw adapts its behavior based on how you interact with it.

## Design Philosophy

**One Group = One Project = One Team**

DevClaw enforces strict boundaries between projects:
- Each Telegram/WhatsApp group represents a **single project**
- Each project has its **own dedicated dev/qa workers**
- Project work happens **inside that project's group**
- Setup and configuration happen **outside project groups**

This prevents:
- Cross-project contamination (workers picking up wrong project's tasks)
- Confusion about which project you're working on
- Accidental registration of wrong groups
- Setup discussions cluttering project work channels

This enables:
- Clear mental model: "This group = this project"
- Isolated work streams: Each project progresses independently
- Dedicated teams: Workers focus on one project at a time
- Clean separation: Setup vs. operational work

## Three Interaction Contexts

### 1. Via Another Agent (Setup Mode)

When you talk to your main agent about DevClaw:
- Use: `onboard`, `setup`
- Avoid: `work_start`, `status` (operational tools)

**Example:**
```
User → Main Agent: "Can you help me set up DevClaw?"
Main Agent → Calls onboard
```

### 2. Direct Message to DevClaw Agent

When you DM the DevClaw agent directly on Telegram/WhatsApp:
- Use: `status` (all projects), `health` (system overview)
- Avoid: `work_start` (project-specific work), setup tools

**Example:**
```
User → DevClaw DM: "Show me the status of all projects"
DevClaw → Calls status (shows all projects)
```

### 3. Project Group Chat

When you message in a Telegram/WhatsApp group bound to a project:
- Use: `work_start`, `work_finish`, `task_create`, `status` (auto-filtered)
- Avoid: Setup tools, system-wide queries

**Example:**
```
User → Project Group: "pick up issue #42"
DevClaw → Calls work_start (only works in groups)
```

## How It Works

### Context Detection

Each tool automatically detects:
- **Agent ID** — Is this the DevClaw agent or another agent?
- **Message Channel** — Telegram, WhatsApp, or CLI?
- **Session Key** — Is this a group chat or direct message?
  - Format: `agent:{agentId}:{channel}:{type}:{id}`
  - Telegram group: `agent:devclaw:telegram:group:-5266044536`
  - WhatsApp group: `agent:devclaw:whatsapp:group:120363123@g.us`
  - DM: `agent:devclaw:telegram:user:657120585`
- **Project Binding** — Which project is this group bound to?

### Guardrails

Tools include context-aware guidance in their responses:
```json
{
  "contextGuidance": "Context: Project Group Chat (telegram)\n    You're in a Telegram group for project 'my-webapp'.\n    Use work_start, work_finish for project work.",
  ...
}
```

## Tool Context Requirements

| Tool | Group chat | Direct DM | Via agent |
|---|---|---|---|
| `onboard` | Blocked | Works | Works |
| `setup` | Works | Works | Works |
| `work_start` | Works | Blocked | Blocked |
| `work_finish` | Works | Works | Works |
| `task_create` | Works | Works | Works |
| `task_update` | Works | Works | Works |
| `task_comment` | Works | Works | Works |
| `status` | Auto-filtered | All projects | Suggests onboard |
| `health` | Auto-filtered | All projects | Works |
| `work_heartbeat` | Single project | All projects | Works |
| `project_register` | Works (required) | Blocked | Blocked |

**Why `project_register` requires group context:**
- Forces deliberate project registration from within the project's space
- You're physically in the group when binding it, making the connection explicit
- Impossible to accidentally register the wrong group

## WhatsApp Support

DevClaw fully supports WhatsApp groups with the same architecture as Telegram:

- WhatsApp group detection via `sessionKey.includes("@g.us")`
- Projects keyed by WhatsApp group ID (e.g., `"120363123@g.us"`)
- Context-aware tools work identically for both channels
- One project = one group (Telegram OR WhatsApp)

**To register a WhatsApp project:**
1. Go to the WhatsApp group chat
2. Call `project_register` from within the group
3. Group ID auto-detected from context

## Implementation

- **Module:** [`lib/context-guard.ts`](../lib/context-guard.ts)
- **Detection logic:** Checks agentId, messageChannel, sessionKey pattern matching
- **Configuration:** `devClawAgentIds` in plugin config lists which agents are DevClaw orchestrators

## Related

- [Configuration — devClawAgentIds](CONFIGURATION.md#devclaw-agent-ids)
- [Architecture — Scope boundaries](ARCHITECTURE.md#scope-boundaries)
