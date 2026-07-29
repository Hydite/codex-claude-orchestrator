import path from "node:path";
import { StateStore } from "./state-store.js";
import { ClaudeRuntime } from "./claude-runtime.js";
import { normalizeNode, id, now } from "./schema.js";
import { git, gitOrThrow, changedFiles, currentCommit } from "./git.js";
import { exec } from "node:child_process";
import { promisify } from "node:util";
const execCommand = promisify(exec);

export function fileMatchesScope(file, scope) {
  return file === scope || (scope.endsWith("/") && file.startsWith(scope));
}

export function scopesOverlap(left, right) {
  return fileMatchesScope(left, right) || fileMatchesScope(right, left);
}

export function deriveTaskStatus(nodes) {
  if (nodes.every((node) => ["merged", "passed"].includes(node.status))) return "completed";
  if (nodes.some((node) => ["queued", "running"].includes(node.status))) return "running";
  if (nodes.some((node) => node.status === "failed")) return "failed";
  if (nodes.some((node) => node.status === "blocked")) return "blocked";
  if (nodes.some((node) => node.status === "review")) return "review";
  return "planned";
}

export function validateTaskGraph(nodes) {
  const ids = new Set();
  for (const node of nodes) {
    if (ids.has(node.id)) throw new Error(`节点 ID 重复: ${node.id}`);
    ids.add(node.id);
  }
  for (const node of nodes) for (const dependency of node.dependencies) if (!ids.has(dependency)) throw new Error(`节点 ${node.id} 引用了不存在的依赖 ${dependency}`);
  const visiting = new Set(), visited = new Set();
  const visit = (nodeId) => {
    if (visiting.has(nodeId)) throw new Error(`任务图存在循环依赖: ${nodeId}`);
    if (visited.has(nodeId)) return;
    visiting.add(nodeId);
    const node = nodes.find((item) => item.id === nodeId);
    for (const dependency of node.dependencies) visit(dependency);
    visiting.delete(nodeId); visited.add(nodeId);
  };
  for (const node of nodes) visit(node.id);
  return true;
}

export class Orchestrator {
  constructor(config) {
    this.config = config;
    this.store = new StateStore(config);
    this.claude = new ClaudeRuntime(config, this.store);
  }

  async status({ probe = false } = {}) {
    await this.store.load();
    const nodes = Object.values(this.store.state.tasks || {}).flatMap((task) => task.nodes || []);
    return { claude: probe ? await this.claude.probe() : await this.claude.detect(), service: { configured: Array.isArray(this.config.serviceCommand) && this.config.serviceCommand.length > 0, autoStart: this.config.autoStartService, startedByOrchestrator: this.claude.serviceStarted }, cwd: this.config.cwd, config: this.config.configPath, activeNodes: nodes.filter((node) => node.status === "running").length };
  }

  async snapshot() { await this.store.load(); return this.store.state; }

  async createTask({ goal, title, nodes = [], metadata = {} }) {
    if (!goal) throw new Error("goal 是必填项");
    const task = { id: id("task"), title: title || goal.slice(0, 80), goal, metadata, status: "planned", nodes: nodes.map(normalizeNode), createdAt: now(), updatedAt: now() };
    validateTaskGraph(task.nodes);
    await this.store.update((state) => { state.tasks[task.id] = task; for (const node of task.nodes) state.agents[node.agent] = { ...(state.agents[node.agent] || {}), id: node.agent, name: node.agent, kind: node.agent === "claude" ? "external-cli" : "codex", status: state.agents[node.agent]?.status || "idle", activeNodes: state.agents[node.agent]?.activeNodes || [], updatedAt: now() }; });
    await this.store.event("task.created", { taskId: task.id, goal, nodeCount: task.nodes.length });
    return task;
  }

  async addNode({ taskId, ...input }) {
    const node = normalizeNode(input);
    await this.store.update((state) => { const task = state.tasks[taskId]; if (!task) throw new Error(`找不到任务 ${taskId}`); validateTaskGraph([...task.nodes, node]); task.nodes.push(node); task.updatedAt = now(); state.agents[node.agent] = { ...(state.agents[node.agent] || {}), id: node.agent, name: node.agent, kind: node.agent === "claude" ? "external-cli" : "codex", status: state.agents[node.agent]?.status || "idle", activeNodes: state.agents[node.agent]?.activeNodes || [], updatedAt: now() }; });
    await this.store.event("node.planned", { taskId, nodeId: node.id, title: node.title, files: node.files });
    return node;
  }

  async reserve(node, taskId) {
    await this.store.update((state) => {
      const task = state.tasks[taskId];
      const current = task?.nodes.find((x) => x.id === node.id);
      if (!task || !current) throw new Error("任务或节点不存在");
      if (!["planned", "failed", "blocked"].includes(current.status)) throw new Error(`节点状态 ${current.status} 不允许派发`);
      const active = Object.values(state.tasks).flatMap((item) => item.nodes || []).filter((other) => ["queued", "running"].includes(other.status) && other.id !== node.id);
      if (active.length >= this.config.maxConcurrentNodes) throw new Error(`已达到最大并发节点数 ${this.config.maxConcurrentNodes}`);
      const overlaps = active.flatMap((other) => current.files.flatMap((scope) => other.files.filter((otherScope) => scopesOverlap(scope, otherScope)).map((otherScope) => ({ scope, otherScope, nodeId: other.id }))));
      if (overlaps.length) throw new Error(`节点文件范围与运行中节点冲突: ${overlaps.map((x) => `${x.scope} ↔ ${x.otherScope}`).join(", ")}`);
      current.attempts = (current.attempts || 0) + 1; current.status = "queued"; current.updatedAt = now(); task.status = "running"; task.updatedAt = now();
    });
  }

  async dispatchNode({ taskId, nodeId, prompt = null }) {
    await this.store.load();
    const task = this.store.state.tasks[taskId]; if (!task) throw new Error(`找不到任务 ${taskId}`);
    const node = task.nodes.find((x) => x.id === nodeId); if (!node) throw new Error(`找不到节点 ${nodeId}`);
    if (node.agent !== "claude") throw new Error("当前版本 dispatchNode 只支持 agent=claude；Codex 节点由主 Agent 直接执行");
    for (const dependency of node.dependencies) { const dep = task.nodes.find((x) => x.id === dependency); if (!dep || !["passed", "merged"].includes(dep.status)) throw new Error(`依赖节点未通过: ${dependency}`); }
    if (["failed", "blocked"].includes(node.status) && (node.worktree || node.branch)) await this.cleanupAttempt({ taskId, nodeId, reset: true });
    await this.reserve(node, taskId);
    const run = async () => {
      await this.store.update((state) => { const n = state.tasks[taskId].nodes.find((x) => x.id === nodeId); n.status = "running"; n.prompt = prompt; n.updatedAt = now(); const agent = state.agents.claude || {}; const activeNodes = [...new Set([...(agent.activeNodes || []), nodeId])]; state.agents.claude = { ...agent, id: "claude", name: "claude", kind: "external-cli", status: "running", activeNodes, updatedAt: now() }; });
      let result;
      try { result = await this.claude.runNode(node, task, prompt); } catch (error) { result = { code: 1, error: error.message }; }
      let validation = await this.validateNode({ taskId, nodeId, worktree: result.worktree, baseCommit: result.baseCommit });
      if (result.code === 0 && validation.passed && validation.files.length) {
        const commit = await this.commitNode({ taskId, nodeId, worktree: result.worktree });
        validation = { ...validation, commit };
      }
      await this.store.update((state) => { const currentTask = state.tasks[taskId]; const n = currentTask.nodes.find((x) => x.id === nodeId); n.status = result.code === 0 && validation.passed ? "review" : "failed"; n.result = result; n.validation = validation; n.branch = result.branch || n.branch; n.worktree = result.worktree || n.worktree; n.baseCommit = result.baseCommit || n.baseCommit; n.updatedAt = now(); currentTask.status = deriveTaskStatus(currentTask.nodes); currentTask.updatedAt = now(); const agent = state.agents.claude || {}; const activeNodes = (agent.activeNodes || []).filter((id) => id !== nodeId); state.agents.claude = { ...agent, status: activeNodes.length ? "running" : "idle", activeNodes, updatedAt: now() }; });
      await this.store.event("node.completed", { taskId, nodeId, status: result.code === 0 && validation.passed ? "review" : "failed", validation, code: result.code });
      return { ...result, validation };
    };
    run().catch(async (error) => { await this.store.update((state) => { const task = state.tasks[taskId]; const n = task?.nodes.find((x) => x.id === nodeId); if (n) { n.status = "failed"; n.result = { error: error.message }; task.status = deriveTaskStatus(task.nodes); task.updatedAt = now(); } const agent = state.agents.claude || {}; const activeNodes = (agent.activeNodes || []).filter((id) => id !== nodeId); state.agents.claude = { ...agent, status: activeNodes.length ? "running" : "idle", activeNodes, updatedAt: now() }; }); });
    return { accepted: true, taskId, nodeId, message: "节点已进入后台执行，可用 orchestrator_get_state 查看实时进度" };
  }

  async validateNode({ taskId, nodeId, worktree, baseCommit }) {
    await this.store.load();
    const task = this.store.state.tasks[taskId];
    const node = task?.nodes.find((x) => x.id === nodeId);
    if (!task || !node) return { passed: false, checks: [], error: "任务或节点不存在" };
    worktree ||= node.worktree;
    baseCommit ||= node.baseCommit;
    if (!worktree) return { passed: false, checks: [], error: "没有 worktree，无法验证" };
    const checks = [];
    for (const command of this.config.validationCommands) {
      try {
        const result = await execCommand(command, { cwd: worktree, timeout: 15 * 60 * 1000, maxBuffer: 10 * 1024 * 1024 });
        checks.push({ command, passed: true, output: `${result.stdout || ""}${result.stderr || ""}`.slice(0, 4000) });
      } catch (error) {
        checks.push({ command, passed: false, output: `${error.stdout || ""}${error.stderr || error.message}`.slice(0, 4000) });
      }
    }
    const files = await changedFiles(worktree, baseCommit).catch(() => []);
    const allowed = (file) => node.files.some((scope) => fileMatchesScope(file, scope));
    const outOfScope = node.files.length ? files.filter((file) => !allowed(file)) : [];
    const active = Object.values(this.store.state.tasks).flatMap((t) => t.nodes || []).filter((n) => n.id !== nodeId && ["running", "review"].includes(n.status));
    const overlaps = active.flatMap((other) => files.filter((file) => other.files.some((scope) => fileMatchesScope(file, scope))).map((file) => ({ file, nodeId: other.id })));
    const mainFiles = baseCommit ? await changedFiles(this.config.cwd, baseCommit).catch(() => []) : [];
    const baseOverlaps = files.filter((file) => mainFiles.includes(file));
    const hasExpectedChanges = !node.requiresChanges || files.length > 0;
    const passed = checks.every((x) => x.passed) && !outOfScope.length && !overlaps.length && !baseOverlaps.length && hasExpectedChanges;
    return { passed, files, checks, outOfScope, overlaps, baseOverlaps, hasExpectedChanges };
  }

  async commitNode({ taskId, nodeId, worktree }) {
    await gitOrThrow(worktree, ["add", "--all"]);
    const result = await git(worktree, ["commit", "-m", `feat(orchestrator): complete ${nodeId}`]);
    if (result.code !== 0 && !result.stdout.includes("nothing to commit") && !result.stderr.includes("nothing to commit")) throw new Error(`节点提交失败: ${result.stderr.trim()}`);
    const commit = await currentCommit(worktree);
    await this.store.event("node.committed", { taskId, nodeId, commit });
    return commit;
  }

  async cleanupAttempt({ taskId, nodeId, reset = false }) {
    await this.store.load();
    const task = this.store.state.tasks[taskId]; const node = task?.nodes.find((x) => x.id === nodeId);
    if (!node) throw new Error("任务或节点不存在");
    if (node.status === "running") throw new Error("不能清理正在运行的节点；请先停止");
    if (node.worktree) await git(this.config.cwd, ["worktree", "remove", "--force", node.worktree]);
    if (node.branch) await git(this.config.cwd, ["branch", "-D", node.branch]);
    await this.store.update((state) => {
      const currentTask = state.tasks[taskId]; const current = currentTask.nodes.find((x) => x.id === nodeId);
      current.history ||= []; if (current.result || current.validation) current.history.push({ result: current.result, validation: current.validation, branch: current.branch, worktree: current.worktree, archivedAt: now() });
      current.branch = null; current.worktree = null; current.baseCommit = null; current.result = null; current.validation = null; if (reset) current.status = "planned"; current.updatedAt = now();
      if (reset) currentTask.status = "planned"; currentTask.updatedAt = now();
    });
    await this.store.event("node.attempt.cleaned", { taskId, nodeId, reset });
    return { cleaned: true, taskId, nodeId, reset };
  }

  async mergeNode({ taskId, nodeId }) {
    await this.store.load(); const task = this.store.state.tasks[taskId]; const node = task?.nodes.find((x) => x.id === nodeId);
    if (!node || node.status !== "review") throw new Error("只有通过回归检查且处于 review 状态的节点才能合并");
    const dirty = await gitOrThrow(this.config.cwd, ["status", "--porcelain=v1"]);
    if (dirty.stdout.trim()) throw new Error("Codex 主工作区存在未提交修改；请先提交或暂存后再合并 Claude 节点");
    const validation = await this.validateNode({ taskId, nodeId });
    if (!validation.passed) throw new Error(`节点在合并前重新验证失败: ${JSON.stringify(validation)}`);
    const result = await git(this.config.cwd, ["merge", "--no-ff", "--no-edit", node.branch]);
    if (result.code !== 0) { await this.store.event("merge.conflict", { taskId, nodeId, branch: node.branch, output: result.stderr }); throw new Error(`合并冲突: ${result.stderr.trim()}`); }
    await this.store.update((state) => { const taskState = state.tasks[taskId]; const n = taskState.nodes.find((x) => x.id === nodeId); n.status = "merged"; n.updatedAt = now(); taskState.status = deriveTaskStatus(taskState.nodes); taskState.updatedAt = now(); });
    await this.store.event("node.merged", { taskId, nodeId, branch: node.branch });
    if (this.config.cleanupWorktreeOnMerge && node.worktree) {
      await git(this.config.cwd, ["worktree", "remove", "--force", node.worktree]);
      await git(this.config.cwd, ["branch", "-d", node.branch]);
      await this.store.event("node.worktree.cleaned", { taskId, nodeId, worktree: node.worktree, branch: node.branch });
    }
    return { merged: true, branch: node.branch, commit: await currentCommit(this.config.cwd) };
  }

  async recordCodexProgress({ taskId, nodeId = null, status = "review", note = "" }) {
    await this.store.update((state) => { const task = state.tasks[taskId]; if (!task) throw new Error(`找不到任务 ${taskId}`); if (nodeId) { const node = task.nodes.find((x) => x.id === nodeId); if (!node) throw new Error(`找不到节点 ${nodeId}`); node.status = status; node.note = note; node.updatedAt = now(); } task.status = deriveTaskStatus(task.nodes); task.updatedAt = now(); const agent = state.agents.codex || {}; const activeNodes = new Set(agent.activeNodes || []); if (nodeId && status === "running") activeNodes.add(nodeId); else if (nodeId) activeNodes.delete(nodeId); state.agents.codex = { ...agent, id: "codex", name: "codex", kind: "codex", status: activeNodes.size ? "running" : "idle", activeNodes: [...activeNodes], updatedAt: now() }; });
    return this.store.event("codex.progress", { taskId, nodeId, status, note });
  }

  async stopNode(nodeId) { const stopped = this.claude.stopNode(nodeId); await this.store.event("node.stop.requested", { nodeId, stopped }); return { stopped, nodeId }; }
}
