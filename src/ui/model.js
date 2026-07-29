export const ACTIVE_STATUSES = new Set(["queued", "running"]);
export const ATTENTION_STATUSES = new Set(["handoff", "blocked", "failed"]);

export function allTasks(state) {
  return Object.values(state?.tasks || {});
}

export function allNodes(state) {
  return allTasks(state).flatMap((task) => (task.nodes || []).map((node) => ({ ...node, taskId: task.id })));
}

export function dashboardCounts(state) {
  const tasks = allTasks(state);
  const nodes = allNodes(state);
  return {
    tasks: tasks.length,
    active: nodes.filter((node) => ACTIVE_STATUSES.has(node.status)).length,
    review: nodes.filter((node) => node.status === "review").length,
    attention: nodes.filter((node) => ATTENTION_STATUSES.has(node.status)).length
  };
}

export function agentKind(node) {
  const role = `${node?.role || ""} ${node?.title || ""}`.toLowerCase();
  if (node?.execution?.mode === "alignment" || /align|contract|接口|契约|对齐/.test(role)) return "alignment";
  return node?.agent === "claude" ? "claude" : "codex";
}

export function topologyLanes(task) {
  const lanes = { codex: [], alignment: [], claude: [] };
  for (const node of task?.nodes || []) lanes[agentKind(node)].push(node);
  return lanes;
}

export function listFromText(value) {
  return String(value || "").split(/\r?\n/).map((item) => item.trim()).filter(Boolean);
}

export function commaList(value) {
  return String(value || "").split(/[\n,]/).map((item) => item.trim()).filter(Boolean);
}

export function constraintPayload(value = {}, skip = false) {
  return {
    status: skip ? "skipped" : "ready",
    skipped: skip,
    shared: skip ? [] : listFromText(value.shared),
    codex: skip ? [] : listFromText(value.codex),
    claude: skip ? [] : listFromText(value.claude),
    alignment: skip ? [] : listFromText(value.alignment),
    questions: listFromText(value.questions),
    notes: String(value.notes || "").trim() || undefined
  };
}

export function taskCreationPayload(draft, skip = false) {
  return {
    title: String(draft.title || "").trim() || String(draft.goal || "").trim().slice(0, 80),
    goal: String(draft.goal || "").trim(),
    constraints: constraintPayload(draft.constraints, skip),
    team: {
      requireBothAgents: draft.requireBothAgents !== false,
      checkIntervalSeconds: Number(draft.checkIntervalSeconds || 120),
      strategy: String(draft.strategy || "Codex 动态评估能力并分配开发、对齐、验证与移交职责")
    },
    metadata: { teamMode: "hybrid-native", planning: "codex-directed", createdFrom: "react-mcp-app" }
  };
}

export function nodeCreationPayload(draft) {
  return {
    taskId: draft.taskId,
    title: String(draft.title || "").trim(),
    goal: String(draft.goal || "").trim(),
    agent: draft.agent,
    executionMode: draft.executionMode,
    role: String(draft.role || "implementation").trim(),
    files: commaList(draft.files),
    dependencies: commaList(draft.dependencies),
    constraints: listFromText(draft.constraints),
    assignment: {
      assignedBy: "codex",
      rationale: String(draft.rationale || "").trim(),
      capabilities: listFromText(draft.capabilities)
    }
  };
}

export function latestHandoff(node) {
  return Array.isArray(node?.handoffs) && node.handoffs.length ? node.handoffs.at(-1) : null;
}

export function eventLabel(event) {
  const labels = {
    "task.created": "任务建立",
    "constraints.requested": "等待约束",
    "constraints.resolved": "约束已写入",
    "constraints.skipped": "已跳过约束",
    "node.planned": "职责规划",
    "node.assigned": "职责分配",
    "node.reserved": "文件已预约",
    "node.dispatched": "Claude 开工",
    "node.started": "成员开工",
    "node.checkpoint": "定期检查",
    "node.handoff.requested": "请求移交",
    "node.handoff.completed": "移交完成",
    "node.reassigned": "重新分配",
    "node.completed": "等待审查",
    "node.review.approved": "审查通过",
    "node.review.rejected": "审查驳回",
    "node.merged": "成果合并"
  };
  return labels[event?.type] || event?.type || "事件";
}

export function formatTime(value) {
  if (!value) return "尚未更新";
  const time = new Date(value);
  if (Number.isNaN(time.valueOf())) return String(value);
  return new Intl.DateTimeFormat("zh-CN", { hour: "2-digit", minute: "2-digit", second: "2-digit" }).format(time);
}
