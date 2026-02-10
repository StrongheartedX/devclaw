import type { OpenClawPluginApi } from "openclaw/plugin-sdk";
import { createTaskPickupTool } from "./lib/tools/task-pickup.js";
import { createTaskCompleteTool } from "./lib/tools/task-complete.js";
import { createQueueStatusTool } from "./lib/tools/queue-status.js";
import { createSessionHealthTool } from "./lib/tools/session-health.js";
import { createSessionCleanupTool } from "./lib/tools/session-cleanup.js";

const plugin = {
  id: "devclaw",
  name: "DevClaw",
  description:
    "Multi-project dev/qa pipeline orchestration with GitLab integration, model selection, and audit logging.",
  configSchema: {},

  register(api: OpenClawPluginApi) {
    // Agent tools (primary interface — agent calls these directly)
    api.registerTool(createTaskPickupTool(api), {
      names: ["task_pickup"],
    });
    api.registerTool(createTaskCompleteTool(api), {
      names: ["task_complete"],
    });
    api.registerTool(createQueueStatusTool(api), {
      names: ["queue_status"],
    });
    api.registerTool(createSessionHealthTool(api), {
      names: ["session_health"],
    });
    api.registerTool(createSessionCleanupTool(api), {
      names: ["session_cleanup"],
    });

    api.logger.info("DevClaw plugin registered (5 tools)");
  },
};

export default plugin;
