export const NODE_STATUSES = ["planned", "queued", "running", "handoff", "review", "passed", "blocked", "failed", "merged", "cancelled"];
export const TASK_STATUSES = ["awaiting_constraints", "planned", "running", "review", "completed", "blocked", "failed"];
export const CONSTRAINT_STATUSES = ["pending", "ready", "skipped"];
export const AGENTS = ["codex", "claude"];
export const EXECUTION_MODES = ["codex-lead", "codex-subagent", "claude-cli", "alignment"];
export const HANDOFF_REASONS = [
  "boundary_violation",
  "capability_gap",
  "validation_failure",
  "dependency_change",
  "contract_change",
  "security_escalation",
  "runtime_failure",
  "timeout",
  "scope_conflict",
  "priority_change",
  "workload_balance",
  "user_request",
  "other"
];

export function now() {
  return new Date().toISOString();
}

export function id(prefix) {
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

function stringList(value) {
  if (Array.isArray(value)) return value.map(String).map((item) => item.trim()).filter(Boolean);
  if (typeof value === "string") return value.trim() ? [value.trim()] : [];
  if (value && typeof value === "object") return Object.entries(value).map(([key, item]) => `${key}: ${typeof item === "string" ? item : JSON.stringify(item)}`);
  return [];
}

export function normalizeConstraints(input = {}) {
  const value = input && typeof input === "object" && !Array.isArray(input) ? input : {};
  const agents = value.agents && typeof value.agents === "object" && !Array.isArray(value.agents) ? value.agents : {};
  const skipped = value.skipped === true || value.status === "skipped";
  const hasValues = stringList(value.shared).length || stringList(agents.codex ?? value.codex).length || stringList(agents.claude ?? value.claude).length || stringList(agents.alignment ?? value.alignment).length;
  return {
    status: skipped ? "skipped" : value.status === "pending" ? "pending" : value.status === "ready" || hasValues ? "ready" : "pending",
    skipped,
    promptedAt: value.promptedAt || null,
    resolvedAt: value.resolvedAt || null,
    questions: stringList(value.questions),
    shared: stringList(value.shared),
    agents: {
      codex: stringList(agents.codex ?? value.codex),
      claude: stringList(agents.claude ?? value.claude),
      alignment: stringList(agents.alignment ?? value.alignment)
    },
    notes: value.notes ? String(value.notes) : null
  };
}

export function normalizeNode(input = {}) {
  const agent = AGENTS.includes(input.agent) ? input.agent : "claude";
  const executionMode = EXECUTION_MODES.includes(input.executionMode)
    ? input.executionMode
    : EXECUTION_MODES.includes(input.execution?.mode)
      ? input.execution.mode
      : agent === "claude" ? "claude-cli" : "codex-lead";
  const createdAt = input.createdAt || now();
  return {
    id: input.id || id("node"),
    title: String(input.title || "未命名节点"),
    goal: String(input.goal || ""),
    input: input.input ?? {},
    files: stringList(input.files),
    requiresChanges: input.requiresChanges !== false,
    attempts: Number(input.attempts || 0),
    agent,
    role: String(input.role || "implementation"),
    constraints: stringList(input.constraints),
    assignment: {
      assignedBy: String(input.assignment?.assignedBy || input.assignedBy || "codex"),
      rationale: input.assignment?.rationale || input.assignmentReason ? String(input.assignment?.rationale || input.assignmentReason) : null,
      capabilities: stringList(input.assignment?.capabilities || input.capabilities),
      decidedAt: input.assignment?.decidedAt || createdAt
    },
    tools: stringList(input.tools),
    model: input.model ? String(input.model) : null,
    status: NODE_STATUSES.includes(input.status) ? input.status : "planned",
    dependencies: stringList(input.dependencies),
    baseCommit: input.baseCommit || null,
    branch: input.branch || null,
    worktree: input.worktree || null,
    prompt: input.prompt || null,
    result: input.result || null,
    history: Array.isArray(input.history) ? input.history : [],
    validation: input.validation || null,
    execution: {
      mode: executionMode,
      threadId: input.execution?.threadId || null,
      hostId: input.execution?.hostId || null,
      startedAt: input.execution?.startedAt || null,
      completedAt: input.execution?.completedAt || null
    },
    reservation: input.reservation || null,
    progress: input.progress || null,
    handoffs: Array.isArray(input.handoffs) ? input.handoffs : [],
    lineage: input.lineage || { predecessorNodeId: null, rootNodeId: input.id || null },
    review: input.review || null,
    createdAt,
    updatedAt: input.updatedAt || createdAt
  };
}
