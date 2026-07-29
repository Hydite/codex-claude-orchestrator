import path from "node:path";
import { StateStore } from "./state-store.js";
import { ClaudeRuntime } from "./claude-runtime.js";
import { normalizeNode, id, now } from "./schema.js";
import { git, gitOrThrow, changedFiles, currentCommit } from "./git.js";
import { exec } from "node:child_process";
import { promisify } from "node:util";
const execCommand = promisify(exec);

export class Orchestrator {
  constructor(config) {
    this.config = config;
    this.store = new StateStore(config);
    this.claude = new ClaudeRuntime(config, this.store);
  }

  async status() {
    await this.store.load();
    const nodes = Object.values(this.store.state.tasks || {}).flatMap((task) => task.nodes || []);
    return { claude: await this.claude.detect(), cwd: this.config.cwd, config: this.config.configPath, activeNodes: nodes.filter((node) => node.status === "running").length };
  }

  async snapshot() { await this.store.load(); return this.store.state; }

  async createTask({ goal, title, nodes = [], metadata = {} }) {
    if (!goal) throw new Error("goal 是必填项");
    const task = { id: id("task"), title: title || goal.slice(0, 80), goal, metadata, status: "planned", nodes: nodes.map(normalizeNode), createdAt: now(), updatedAt: now() };
    await this.store.update((state) => { state.tasks[task.id] = task; for (const node of task.nodes) state.agents[node.agent] = { id: node.agent, name: node.agent, kind: node.agent === "claude" ? "external-cli" : "codex", status: "idle", updatedAt: now() }; });
    await this.store.event("task.created", { taskId: task.id, goal, nodeCount: task.nodes.length });
    return task;
  }

  async addNode({ taskId, ...input }) {
    const node = normalizeNode(input);
    await this.store.update((state) => { const task = state.tasks[taskId]; if (!task) throw new Error(`找不到任务 ${taskId}`); task.nodes.push(node); task.updatedAt = now(); });
    await this.store.event("node.planned", { taskId, nodeId: node.id, title: node.title, files: node.files });
    return node;
  }

  async reserve(node, taskId) {
    await this.store.load();
    const active = Object.values(this.store.state.tasks).flatMap((task) => task.nodes || []).filter((other) => other.status === "running" && other.id !== node.id);
    const overlaps = active.flatMap((other) => other.files.filter((file) => node.files.includes(file)).map((file) => ({ file, nodeId: other.id, taskId: other.taskId || null })));
    if (overlaps.length) throw new Error(`节点文件范围与运行中节点冲突: ${overlaps.map((x) => x.file).join(", ")}`);
    await this.store.update((state) => { const task = state.tasks[taskId]; const current = task.nodes.find((x) => x.id === node.id); current.status = "queued"; current.updatedAt = now(); task.status = "running"; task.updatedAt = now(); });
  }

  async dispatchNode({ taskId, nodeId, prompt = null }) {
    await this.store.load();
    const task = this.store.state.tasks[taskId]; if (!task) throw new Error(`找不到任务 ${taskId}`);
    const node = task.nodes.find((x) => x.id === nodeId); if (!node) throw new Error(`找不到节点 ${nodeId}`);
    if (node.agent !== "claude") throw new Error("当前版本 dispatchNode 只支持 agent=claude；Codex 节点由主 Agent 直接执行");
    for (const dependency of node.dependencies) { const dep = task.nodes.find((x) => x.id === dependency); if (!dep || !["passed", "merged"].includes(dep.status)) throw new Error(`依赖节点未通过: ${dependency}`); }
    const activeCount = Object.values(this.store.state.tasks).flatMap((x) => x.nodes).filter((x) => x.status === "running").length;
    if (activeCount >= this.config.maxConcurrentNodes) throw new Error(`已达到最大并发节点数 ${this.config.maxConcurrentNodes}`);
    await this.reserve(node, taskId);
    const run = async () => {
      await this.store.update((state) => { const n = state.tasks[taskId].nodes.find((x) => x.id === nodeId); n.status = "running"; n.prompt = prompt; n.updatedAt = now(); });
      let result;
      try { result = await this.claude.runNode(node, task, prompt); } catch (error) { result = { code: 1, error: error.message }; }
      const validation = await this.validateNode({ taskId, nodeId, worktree: result.worktree, baseCommit: result.baseCommit });
      await this.store.update((state) => { const n = state.tasks[taskId].nodes.find((x) => x.id === nodeId); n.status = result.code === 0 && validation.passed ? "review" : "failed"; n.result = result; n.validation = validation; n.branch = result.branch || n.branch; n.worktree = result.worktree || n.worktree; n.baseCommit = result.baseCommit || n.baseCommit; n.updatedAt = now(); });
      await this.store.event("node.completed", { taskId, nodeId, status: result.code === 0 && validation.passed ? "review" : "failed", validation, code: result.code });
      return { ...result, validation };
    };
    run().catch(async (error) => { await this.store.update((state) => { const n = state.tasks[taskId]?.nodes.find((x) => x.id === nodeId); if (n) { n.status = "failed"; n.result = { error: error.message }; } }); });
    return { accepted: true, taskId, nodeId, message: "节点已进入后台执行，可用 orchestrator_get_state 查看实时进度" };
  }

  async validateNode({ taskId, nodeId, worktree, baseCommit }) {
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
    const task = this.store.state.tasks[taskId]; const node = task.nodes.find((x) => x.id === nodeId);
    const outOfScope = node.files.length ? files.filter((file) => !node.files.includes(file)) : [];
    const active = Object.values(this.store.state.tasks).flatMap((t) => t.nodes || []).filter((n) => n.id !== nodeId && ["running", "review"].includes(n.status));
    const overlaps = active.flatMap((other) => files.filter((file) => other.files.includes(file)).map((file) => ({ file, nodeId: other.id })));
    const passed = checks.every((x) => x.passed) && !outOfScope.length && !overlaps.length;
    return { passed, files, checks, outOfScope, overlaps };
  }

  async mergeNode({ taskId, nodeId }) {
    await this.store.load(); const task = this.store.state.tasks[taskId]; const node = task?.nodes.find((x) => x.id === nodeId);
    if (!node || node.status !== "review") throw new Error("只有通过回归检查且处于 review 状态的节点才能合并");
    const result = await git(this.config.cwd, ["merge", "--no-ff", "--no-edit", node.branch]);
    if (result.code !== 0) { await this.store.event("merge.conflict", { taskId, nodeId, branch: node.branch, output: result.stderr }); throw new Error(`合并冲突: ${result.stderr.trim()}`); }
    await this.store.update((state) => { const n = state.tasks[taskId].nodes.find((x) => x.id === nodeId); n.status = "merged"; n.updatedAt = now(); if (state.tasks[taskId].nodes.every((x) => ["merged", "passed"].includes(x.status))) state.tasks[taskId].status = "completed"; });
    await this.store.event("node.merged", { taskId, nodeId, branch: node.branch });
    return { merged: true, branch: node.branch, commit: await currentCommit(this.config.cwd) };
  }

  async recordCodexProgress({ taskId, nodeId = null, status = "review", note = "" }) {
    await this.store.update((state) => { const task = state.tasks[taskId]; if (!task) throw new Error(`找不到任务 ${taskId}`); if (nodeId) { const node = task.nodes.find((x) => x.id === nodeId); if (!node) throw new Error(`找不到节点 ${nodeId}`); node.status = status; node.note = note; node.updatedAt = now(); } task.updatedAt = now(); });
    return this.store.event("codex.progress", { taskId, nodeId, status, note });
  }

  async stopNode(nodeId) { const stopped = this.claude.stopNode(nodeId); await this.store.event("node.stop.requested", { nodeId, stopped }); return { stopped, nodeId }; }
}
