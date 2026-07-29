import { AGENTS, EXECUTION_MODES, HANDOFF_REASONS, NODE_STATUSES } from "./schema.js";

export const WIDGET_URI = "ui://codex-claude-orchestrator/dashboard-v2.html";
export const LEGACY_WIDGET_URIS = ["ui://codex-claude-orchestrator/dashboard-v1.html"];

const stringArray = { type: "array", items: { type: "string" } };
const constraintProperties = {
  shared: stringArray,
  codex: stringArray,
  claude: stringArray,
  alignment: stringArray,
  questions: stringArray,
  notes: { type: "string" },
  skip: { type: "boolean", default: false }
};
const nodeProperties = {
  id: { type: "string" },
  title: { type: "string" },
  goal: { type: "string" },
  input: { type: "object" },
  files: stringArray,
  requiresChanges: { type: "boolean", default: true },
  agent: { type: "string", enum: AGENTS },
  executionMode: { type: "string", enum: EXECUTION_MODES },
  role: { type: "string", description: "Implementation, alignment, review, test, or another responsibility" },
  constraints: stringArray,
  assignment: {
    type: "object",
    properties: {
      assignedBy: { type: "string" },
      rationale: { type: "string" },
      capabilities: stringArray
    }
  },
  tools: stringArray,
  model: { type: "string" },
  dependencies: stringArray
};

export const tools = [
  {
    name: "orchestrator_set_workspace",
    description: "Bind the orchestrator to the active absolute Git repository before using any team tools.",
    inputSchema: { type: "object", required: ["workspaceRoot"], properties: { workspaceRoot: { type: "string", description: "Absolute path to the active Git repository" } } },
    annotations: { destructiveHint: false }
  },
  {
    name: "claude_status",
    description: "Detect Claude CLI and its effective provider. Use probe=true only for a real low-cost API request.",
    inputSchema: { type: "object", properties: { probe: { type: "boolean", default: false } } },
    annotations: { readOnlyHint: true, openWorldHint: true }
  },
  {
    name: "orchestrator_get_state",
    description: "Read the authoritative team tasks, nodes, assignments, constraints, checkpoints, handoffs, conflicts, and validation state without opening UI.",
    inputSchema: { type: "object", properties: {} },
    annotations: { readOnlyHint: true }
  },
  {
    name: "orchestrator_open_dashboard",
    description: "Open the React team control plane after reading state or when the user asks to inspect or operate the visual dashboard.",
    inputSchema: { type: "object", properties: {} },
    _meta: { "ui.resourceUri": WIDGET_URI, "openai/outputTemplate": WIDGET_URI },
    annotations: { readOnlyHint: true }
  },
  {
    name: "orchestrator_create_task",
    description: "Create a hybrid-native team goal. If constraints are absent, the task remains awaiting_constraints and no node can start until Codex records answers or an explicit skip.",
    inputSchema: {
      type: "object",
      required: ["goal"],
      properties: {
        title: { type: "string" },
        goal: { type: "string" },
        metadata: { type: "object" },
        constraints: { type: "object", properties: { status: { type: "string", enum: ["pending", "ready", "skipped"] }, skipped: { type: "boolean" }, ...constraintProperties } },
        team: { type: "object", properties: { requireBothAgents: { type: "boolean" }, checkIntervalSeconds: { type: "integer", minimum: 15, maximum: 3600 }, strategy: { type: "string" } } },
        nodes: { type: "array", items: { type: "object", required: ["title", "goal"], properties: nodeProperties } }
      }
    },
    annotations: { destructiveHint: false }
  },
  {
    name: "orchestrator_set_constraints",
    description: "Resolve the pre-development constraint intake with shared and per-agent constraints, or explicitly skip it. Active tasks cannot have constraints rewritten.",
    inputSchema: { type: "object", required: ["taskId"], properties: { taskId: { type: "string" }, ...constraintProperties } },
    annotations: { destructiveHint: false, idempotentHint: false }
  },
  {
    name: "orchestrator_add_node",
    description: "Add a team member node with a measurable goal, assignment rationale, execution mode, dependencies, constraints, and the narrowest practical file scope.",
    inputSchema: { type: "object", required: ["taskId", "title", "goal"], properties: { taskId: { type: "string" }, ...nodeProperties } },
    annotations: { destructiveHint: false }
  },
  {
    name: "orchestrator_assign_node",
    description: "Assign or rebalance an unstarted clean node after Codex compares capabilities. Use reassign_node for a handoff with execution history.",
    inputSchema: { type: "object", required: ["taskId", "nodeId", "agent", "executionMode", "rationale"], properties: { taskId: { type: "string" }, nodeId: { type: "string" }, agent: { type: "string", enum: AGENTS }, executionMode: { type: "string", enum: EXECUTION_MODES }, rationale: { type: "string" }, capabilities: stringArray, constraints: stringArray } },
    annotations: { destructiveHint: false }
  },
  {
    name: "orchestrator_start_codex_node",
    description: "Claim and start a Codex-owned node after the client starts native work itself or through a native subagent. This reserves files and records the native thread identity when available.",
    inputSchema: { type: "object", required: ["taskId", "nodeId"], properties: { taskId: { type: "string" }, nodeId: { type: "string" }, executionMode: { type: "string", enum: ["codex-lead", "codex-subagent", "alignment"] }, threadId: { type: "string" }, hostId: { type: "string" }, note: { type: "string" } } },
    annotations: { destructiveHint: false }
  },
  {
    name: "orchestrator_dispatch_node",
    description: "Dispatch a Claude node into an isolated worktree and return immediately. Codex should start independent Codex work next instead of waiting on Claude.",
    inputSchema: { type: "object", required: ["taskId", "nodeId"], properties: { taskId: { type: "string" }, nodeId: { type: "string" }, prompt: { type: "string" } } },
    annotations: { destructiveHint: false }
  },
  {
    name: "orchestrator_checkpoint_node",
    description: "Record a meaningful milestone for any active node. Report touched files; an out-of-scope file automatically requests a boundary handoff.",
    inputSchema: { type: "object", required: ["taskId", "nodeId", "summary"], properties: { taskId: { type: "string" }, nodeId: { type: "string" }, phase: { type: "string" }, summary: { type: "string" }, percent: { type: "number", minimum: 0, maximum: 100 }, filesTouched: stringArray, blockers: stringArray, nextCheckSeconds: { type: "integer", minimum: 15, maximum: 3600 } } },
    annotations: { destructiveHint: false }
  },
  {
    name: "orchestrator_request_handoff",
    description: "Stop active Claude execution when present and request a traceable handoff for boundary, capability, validation, contract, security, runtime, timeout, conflict, workload, priority, or user reasons.",
    inputSchema: { type: "object", required: ["taskId", "nodeId", "reason", "evidence"], properties: { taskId: { type: "string" }, nodeId: { type: "string" }, reason: { type: "string", enum: HANDOFF_REASONS }, evidence: { type: "string" }, recommendedAgent: { type: "string", enum: AGENTS, default: "codex" }, requestedBy: { type: "string" } } },
    annotations: { destructiveHint: true, idempotentHint: false }
  },
  {
    name: "orchestrator_reassign_node",
    description: "Resolve a handoff by restarting cleanly with another agent or creating a successor that preserves the previous attempt for review. Deleting an existing attempt requires discardAttempt=true.",
    inputSchema: { type: "object", required: ["taskId", "nodeId", "targetAgent", "executionMode", "rationale"], properties: { taskId: { type: "string" }, nodeId: { type: "string" }, targetAgent: { type: "string", enum: AGENTS }, executionMode: { type: "string", enum: EXECUTION_MODES }, rationale: { type: "string" }, strategy: { type: "string", enum: ["restart", "successor"], default: "restart" }, discardAttempt: { type: "boolean", default: false }, successorId: { type: "string" }, constraints: stringArray } },
    annotations: { destructiveHint: true, idempotentHint: false }
  },
  {
    name: "orchestrator_finish_codex_node",
    description: "Finish a Codex lead or native subagent node into review, failed, or blocked with concrete files and checks. Passing still requires a separate review call.",
    inputSchema: { type: "object", required: ["taskId", "nodeId", "summary"], properties: { taskId: { type: "string" }, nodeId: { type: "string" }, outcome: { type: "string", enum: ["review", "failed", "blocked"], default: "review" }, summary: { type: "string" }, filesTouched: stringArray, checks: { type: "array", items: { type: "object" } }, blockers: stringArray } },
    annotations: { destructiveHint: false }
  },
  {
    name: "orchestrator_review_codex_node",
    description: "Independently accept or reject a completed Codex-owned node after reviewing its changes and checks.",
    inputSchema: { type: "object", required: ["taskId", "nodeId", "approved"], properties: { taskId: { type: "string" }, nodeId: { type: "string" }, approved: { type: "boolean" }, note: { type: "string" }, checks: { type: "array", items: { type: "object" } } } },
    annotations: { destructiveHint: false }
  },
  {
    name: "orchestrator_get_next_actions",
    description: "Return deterministic next actions for the client-side team loop: constraint intake, team-plan gaps, dispatches, overdue checkpoints, handoffs, reviews, failures, and completion.",
    inputSchema: { type: "object", properties: {} },
    annotations: { readOnlyHint: true }
  },
  {
    name: "orchestrator_validate_node",
    description: "Run scope, overlap, base-change, and configured regression checks for an isolated worktree node before review or merge.",
    inputSchema: { type: "object", required: ["taskId", "nodeId"], properties: { taskId: { type: "string" }, nodeId: { type: "string" } } },
    annotations: { readOnlyHint: false, destructiveHint: false }
  },
  {
    name: "orchestrator_merge_node",
    description: "Merge a reviewed isolated branch only after all merge gates are revalidated and the Codex worktree is clean.",
    inputSchema: { type: "object", required: ["taskId", "nodeId"], properties: { taskId: { type: "string" }, nodeId: { type: "string" } } },
    annotations: { destructiveHint: true, idempotentHint: false }
  },
  {
    name: "orchestrator_record_codex_progress",
    description: "Backward-compatible Codex progress adapter. New clients should use start_codex_node, checkpoint_node, finish_codex_node, and review_codex_node.",
    inputSchema: { type: "object", required: ["taskId"], properties: { taskId: { type: "string" }, nodeId: { type: "string" }, status: { type: "string", enum: NODE_STATUSES }, note: { type: "string" } } },
    annotations: { destructiveHint: false }
  },
  {
    name: "orchestrator_stop_node",
    description: "Stop a running Claude process. Use request_handoff when work should continue with another agent.",
    inputSchema: { type: "object", required: ["nodeId"], properties: { nodeId: { type: "string" } } },
    annotations: { destructiveHint: true }
  },
  {
    name: "orchestrator_discard_node",
    description: "Delete a failed, blocked, handoff, or review node worktree and branch, archive the attempt, and reset the node for a clean retry.",
    inputSchema: { type: "object", required: ["taskId", "nodeId"], properties: { taskId: { type: "string" }, nodeId: { type: "string" } } },
    annotations: { destructiveHint: true, idempotentHint: true }
  }
];
