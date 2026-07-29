export const NODE_STATUSES = ["planned", "queued", "running", "review", "passed", "blocked", "failed", "merged"];
export const TASK_STATUSES = ["planned", "running", "review", "completed", "blocked", "failed"];

export function now() {
  return new Date().toISOString();
}

export function id(prefix) {
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

export function normalizeNode(input = {}) {
  return {
    id: input.id || id("node"),
    title: String(input.title || "未命名节点"),
    goal: String(input.goal || ""),
    input: input.input ?? {},
    files: Array.isArray(input.files) ? input.files.map(String) : [],
    agent: input.agent || "claude",
    status: input.status || "planned",
    dependencies: Array.isArray(input.dependencies) ? input.dependencies.map(String) : [],
    baseCommit: input.baseCommit || null,
    branch: input.branch || null,
    worktree: input.worktree || null,
    result: input.result || null,
    validation: input.validation || null,
    createdAt: input.createdAt || now(),
    updatedAt: now()
  };
}

