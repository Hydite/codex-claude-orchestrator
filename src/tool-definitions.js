export const WIDGET_URI = "ui://codex-claude-orchestrator/dashboard-v1.html";

const nodeProperties = {
  id: { type: "string" },
  title: { type: "string" },
  goal: { type: "string" },
  input: { type: "object" },
  files: { type: "array", items: { type: "string" } },
  requiresChanges: { type: "boolean", default: true },
  agent: { type: "string", enum: ["claude", "codex"] },
  role: { type: "string", description: "Responsibility assigned to this agent node" },
  tools: { type: "array", items: { type: "string" }, description: "Claude CLI allowed tool names/patterns for this node" },
  model: { type: "string", description: "Optional Claude model override" },
  dependencies: { type: "array", items: { type: "string" } }
};

export const tools = [
  {
    name: "orchestrator_set_workspace",
    description: "Use this first in every Codex task to bind the orchestrator to the active repository root.",
    inputSchema: { type: "object", required: ["workspaceRoot"], properties: { workspaceRoot: { type: "string", description: "Absolute path to the active Git repository" } } },
    annotations: { destructiveHint: false }
  },
  {
    name: "claude_status",
    description: "Use this to detect Claude CLI installation and login. Set probe=true only when a real low-cost API dispatch check is needed.",
    inputSchema: { type: "object", properties: { probe: { type: "boolean", default: false } } },
    annotations: { readOnlyHint: true, openWorldHint: true }
  },
  {
    name: "orchestrator_get_state",
    description: "Use this when you need the live tasks, nodes, agents, events, conflicts, and validation state for the visual dashboard.",
    inputSchema: { type: "object", properties: {} },
    _meta: { "ui.resourceUri": WIDGET_URI, "openai/outputTemplate": WIDGET_URI },
    annotations: { readOnlyHint: true }
  },
  {
    name: "orchestrator_create_task",
    description: "Use this to create a goal and its parallelizable node inputs. Each node must have a clear goal, agent, dependencies, and optional file scope.",
    inputSchema: { type: "object", required: ["goal"], properties: { title: { type: "string" }, goal: { type: "string" }, metadata: { type: "object" }, nodes: { type: "array", items: { type: "object", required: ["title", "goal"], properties: nodeProperties } } } },
    annotations: { destructiveHint: false }
  },
  {
    name: "orchestrator_add_node",
    description: "Use this to add a node-level input and goal to an existing task.",
    inputSchema: { type: "object", required: ["taskId", "title", "goal"], properties: { taskId: { type: "string" }, ...nodeProperties } },
    annotations: { destructiveHint: false }
  },
  {
    name: "orchestrator_dispatch_node",
    description: "Use this to dispatch a Claude node into an isolated Git worktree. The call returns immediately; poll orchestrator_get_state for live progress.",
    inputSchema: { type: "object", required: ["taskId", "nodeId"], properties: { taskId: { type: "string" }, nodeId: { type: "string" }, prompt: { type: "string" } } },
    _meta: { "ui.resourceUri": WIDGET_URI },
    annotations: { destructiveHint: false }
  },
  {
    name: "orchestrator_validate_node",
    description: "Use this to run diff, scope, overlap, and configured regression checks for a Claude node before review or merge.",
    inputSchema: { type: "object", required: ["taskId", "nodeId"], properties: { taskId: { type: "string" }, nodeId: { type: "string" } } },
    annotations: { readOnlyHint: false, destructiveHint: false }
  },
  {
    name: "orchestrator_merge_node",
    description: "Use this only after reviewing a node in review status; it merges the isolated branch into the current Codex branch.",
    inputSchema: { type: "object", required: ["taskId", "nodeId"], properties: { taskId: { type: "string" }, nodeId: { type: "string" } } },
    annotations: { destructiveHint: true, idempotentHint: false }
  },
  {
    name: "orchestrator_record_codex_progress",
    description: "Use this to record Codex-owned work and keep the shared task graph synchronized.",
    inputSchema: { type: "object", required: ["taskId"], properties: { taskId: { type: "string" }, nodeId: { type: "string" }, status: { type: "string", enum: ["planned", "running", "review", "passed", "blocked", "failed", "merged"] }, note: { type: "string" } } },
    annotations: { destructiveHint: false }
  },
  {
    name: "orchestrator_stop_node",
    description: "Use this to stop a running Claude node.",
    inputSchema: { type: "object", required: ["nodeId"], properties: { nodeId: { type: "string" } } },
    annotations: { destructiveHint: true }
  },
  {
    name: "orchestrator_discard_node",
    description: "Use this after rejecting a failed or review node to remove its worktree/branch and reset it for a clean retry.",
    inputSchema: { type: "object", required: ["taskId", "nodeId"], properties: { taskId: { type: "string" }, nodeId: { type: "string" } } },
    annotations: { destructiveHint: true, idempotentHint: true }
  }
];
