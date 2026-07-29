import { exec } from "node:child_process";
import { promisify } from "node:util";
import { StateStore } from "./state-store.js";
import { ClaudeRuntime } from "./claude-runtime.js";
import { AGENTS, EXECUTION_MODES, HANDOFF_REASONS, id, normalizeConstraints, normalizeNode, now } from "./schema.js";
import { git, gitOrThrow, changedFiles, currentCommit } from "./git.js";

const execCommand = promisify(exec);
const ACTIVE_RESERVATION_STATUSES = new Set(["queued", "running", "handoff", "review"]);
const DEPENDENCY_SUCCESS_STATUSES = new Set(["passed", "merged"]);

export function fileMatchesScope(file, scope) {
  if (!file || !scope) return false;
  const normalized = String(scope).replace(/\\/g, "/").replace(/^\.\//, "").replace(/\/$/, "");
  const candidate = String(file).replace(/\\/g, "/").replace(/^\.\//, "");
  return candidate === normalized || candidate.startsWith(`${normalized}/`);
}

export function scopesOverlap(left, right) {
  return fileMatchesScope(left, right) || fileMatchesScope(right, left);
}

export function deriveTaskStatus(nodes, constraints = { status: "ready" }) {
  if (constraints?.status === "pending") return "awaiting_constraints";
  if (!nodes.length) return "planned";
  if (nodes.every((node) => ["merged", "passed", "cancelled"].includes(node.status))) return "completed";
  if (nodes.some((node) => ["queued", "running"].includes(node.status))) return "running";
  if (nodes.some((node) => ["handoff", "blocked"].includes(node.status))) return "blocked";
  if (nodes.some((node) => node.status === "failed")) return "failed";
  if (nodes.some((node) => node.status === "review")) return "review";
  return "planned";
}

export function validateTaskGraph(nodes) {
  const ids = new Set();
  for (const node of nodes) {
    if (ids.has(node.id)) throw new Error(`节点 ID 重复: ${node.id}`);
    ids.add(node.id);
  }
  for (const node of nodes) {
    for (const dependency of node.dependencies) {
      if (!ids.has(dependency)) throw new Error(`节点 ${node.id} 引用了不存在的依赖 ${dependency}`);
    }
  }
  const visiting = new Set();
  const visited = new Set();
  const visit = (nodeId) => {
    if (visiting.has(nodeId)) throw new Error(`任务图存在循环依赖: ${nodeId}`);
    if (visited.has(nodeId)) return;
    visiting.add(nodeId);
    const node = nodes.find((item) => item.id === nodeId);
    for (const dependency of node.dependencies) visit(dependency);
    visiting.delete(nodeId);
    visited.add(nodeId);
  };
  for (const node of nodes) visit(node.id);
  return true;
}

function constraintGroup(node) {
  return /align|contract|接口|契约|对齐/i.test(`${node.role} ${node.title}`) ? "alignment" : node.agent;
}

function taskNodeConstraints(task, node) {
  const group = constraintGroup(node);
  return [...new Set([...(task.constraints.shared || []), ...(task.constraints.agents?.[group] || []), ...(node.constraints || [])])];
}

function ensureAgent(agent) {
  if (!AGENTS.includes(agent)) throw new Error(`agent 必须是 ${AGENTS.join(" 或 ")}`);
}

function ensureExecutionMode(agent, mode) {
  if (!EXECUTION_MODES.includes(mode)) throw new Error(`executionMode 无效: ${mode}`);
  if (agent === "claude" && !["claude-cli", "alignment"].includes(mode)) throw new Error("Claude 节点只能使用 claude-cli 或 alignment 执行模式");
  if (agent === "codex" && !["codex-lead", "codex-subagent", "alignment"].includes(mode)) throw new Error("Codex 节点执行模式无效");
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
    return {
      claude: probe ? await this.claude.probe() : await this.claude.detect(),
      service: {
        configured: Array.isArray(this.config.serviceCommand) && this.config.serviceCommand.length > 0,
        autoStart: this.config.autoStartService,
        startedByOrchestrator: this.claude.serviceStarted
      },
      cwd: this.config.cwd,
      config: this.config.configPath,
      activeNodes: nodes.filter((node) => ["queued", "running"].includes(node.status)).length
    };
  }

  async snapshot() {
    await this.store.load();
    return this.store.state;
  }

  agentState(node) {
    return {
      id: node.agent,
      name: node.agent,
      kind: node.agent === "claude" ? "external-cli" : "codex-native",
      status: "idle",
      activeNodes: [],
      updatedAt: now()
    };
  }

  async createTask({ goal, title, nodes = [], metadata = {}, constraints = {}, team = {} }) {
    if (!goal) throw new Error("goal 是必填项");
    const normalizedConstraints = normalizeConstraints(constraints);
    if (normalizedConstraints.status === "pending" && !normalizedConstraints.promptedAt) normalizedConstraints.promptedAt = now();
    const normalizedNodes = nodes.map(normalizeNode);
    const task = {
      id: id("task"),
      title: title || goal.slice(0, 80),
      goal,
      metadata,
      constraints: normalizedConstraints,
      team: {
        mode: "hybrid-native",
        lead: "codex",
        requireBothAgents: team.requireBothAgents === true,
        checkIntervalSeconds: Number(team.checkIntervalSeconds || this.config.checkpointIntervalSeconds || 120),
        strategy: team.strategy ? String(team.strategy) : null
      },
      status: normalizedConstraints.status === "pending" ? "awaiting_constraints" : "planned",
      nodes: normalizedNodes,
      createdAt: now(),
      updatedAt: now()
    };
    for (const node of task.nodes) node.constraints = taskNodeConstraints(task, node);
    validateTaskGraph(task.nodes);
    await this.store.update((state) => {
      state.tasks[task.id] = task;
      for (const node of task.nodes) state.agents[node.agent] = { ...this.agentState(node), ...(state.agents[node.agent] || {}) };
    });
    await this.store.event("task.created", { taskId: task.id, goal, nodeCount: task.nodes.length, constraintStatus: task.constraints.status, team: task.team });
    if (task.constraints.status === "pending") await this.store.event("constraints.requested", { taskId: task.id, questions: task.constraints.questions });
    return task;
  }

  async setConstraints({ taskId, shared = [], codex = [], claude = [], alignment = [], questions = [], notes = null, skip = false }) {
    let result;
    await this.store.update((state) => {
      const task = state.tasks[taskId];
      if (!task) throw new Error(`找不到任务 ${taskId}`);
      if (task.nodes.some((node) => ["queued", "running", "review", "handoff"].includes(node.status))) throw new Error("已有节点开始执行，不能重写开发约束");
      task.constraints = normalizeConstraints({
        status: skip ? "skipped" : "ready",
        skipped: skip,
        promptedAt: task.constraints?.promptedAt || now(),
        resolvedAt: now(),
        questions,
        shared,
        agents: { codex, claude, alignment },
        notes
      });
      for (const node of task.nodes) node.constraints = taskNodeConstraints(task, node);
      task.status = deriveTaskStatus(task.nodes, task.constraints);
      task.updatedAt = now();
      result = task.constraints;
    });
    await this.store.event(skip ? "constraints.skipped" : "constraints.resolved", { taskId, constraintCounts: { shared: result.shared.length, codex: result.agents.codex.length, claude: result.agents.claude.length, alignment: result.agents.alignment.length } });
    return result;
  }

  async addNode({ taskId, ...input }) {
    const node = normalizeNode(input);
    await this.store.update((state) => {
      const task = state.tasks[taskId];
      if (!task) throw new Error(`找不到任务 ${taskId}`);
      node.constraints = taskNodeConstraints(task, node);
      validateTaskGraph([...task.nodes, node]);
      task.nodes.push(node);
      task.status = deriveTaskStatus(task.nodes, task.constraints);
      task.updatedAt = now();
      state.agents[node.agent] = { ...this.agentState(node), ...(state.agents[node.agent] || {}) };
    });
    await this.store.event("node.planned", { taskId, nodeId: node.id, title: node.title, agent: node.agent, executionMode: node.execution.mode, files: node.files, rationale: node.assignment.rationale });
    return node;
  }

  dependenciesReady(task, node) {
    return node.dependencies.every((dependency) => DEPENDENCY_SUCCESS_STATUSES.has(task.nodes.find((item) => item.id === dependency)?.status));
  }

  async assignNode({ taskId, nodeId, agent, executionMode, rationale, capabilities = [], constraints = [] }) {
    ensureAgent(agent);
    ensureExecutionMode(agent, executionMode);
    let assigned;
    await this.store.update((state) => {
      const task = state.tasks[taskId];
      const node = task?.nodes.find((item) => item.id === nodeId);
      if (!node) throw new Error("任务或节点不存在");
      if (!['planned', 'failed', 'blocked'].includes(node.status) || node.worktree || node.branch) throw new Error("只有未开始且没有遗留 worktree 的节点可以直接分配");
      node.agent = agent;
      node.execution = { mode: executionMode, threadId: null, hostId: null, startedAt: null, completedAt: null };
      node.assignment = { assignedBy: "codex", rationale: String(rationale || ""), capabilities: capabilities.map(String), decidedAt: now() };
      node.constraints = [...new Set([...taskNodeConstraints(task, node), ...constraints.map(String)])];
      node.status = "planned";
      node.updatedAt = now();
      state.agents[agent] = { ...this.agentState(node), ...(state.agents[agent] || {}) };
      assigned = node;
    });
    await this.store.event("node.assigned", { taskId, nodeId, agent, executionMode, rationale, capabilities });
    return assigned;
  }

  async reserve(node, taskId) {
    await this.store.update((state) => {
      const task = state.tasks[taskId];
      const current = task?.nodes.find((item) => item.id === node.id);
      if (!task || !current) throw new Error("任务或节点不存在");
      if (task.constraints.status === "pending") throw new Error("开发约束尚未完成；请先设置约束或明确跳过");
      if (!["planned", "failed", "blocked"].includes(current.status)) throw new Error(`节点状态 ${current.status} 不允许启动`);
      if (!this.dependenciesReady(task, current)) throw new Error(`节点依赖尚未通过: ${current.dependencies.join(", ")}`);
      const allNodes = Object.values(state.tasks).flatMap((item) => item.nodes || []);
      const running = allNodes.filter((other) => ["queued", "running"].includes(other.status) && other.id !== current.id);
      if (running.length >= this.config.maxConcurrentNodes) throw new Error(`已达到最大并发节点数 ${this.config.maxConcurrentNodes}`);
      const reserved = allNodes.filter((other) => ACTIVE_RESERVATION_STATUSES.has(other.status) && other.id !== current.id);
      const overlaps = reserved.flatMap((other) => current.files.flatMap((scope) => other.files.filter((otherScope) => scopesOverlap(scope, otherScope)).map((otherScope) => ({ scope, otherScope, nodeId: other.id }))));
      if (overlaps.length) throw new Error(`节点文件范围与活动节点冲突: ${overlaps.map((item) => `${item.scope} ↔ ${item.otherScope}`).join(", ")}`);
      current.attempts = (current.attempts || 0) + 1;
      current.status = "queued";
      current.reservation = { files: [...current.files], reservedAt: now(), releasedAt: null };
      current.updatedAt = now();
      task.status = "running";
      task.updatedAt = now();
    });
    await this.store.event("node.reserved", { taskId, nodeId: node.id, files: node.files });
  }

  async startCodexNode({ taskId, nodeId, executionMode, threadId = null, hostId = null, note = "" }) {
    await this.store.load();
    const task = this.store.state.tasks[taskId];
    const node = task?.nodes.find((item) => item.id === nodeId);
    if (!node) throw new Error("任务或节点不存在");
    if (node.agent !== "codex") throw new Error("只有 agent=codex 的节点可由 Codex 客户端启动");
    const mode = executionMode || node.execution.mode;
    ensureExecutionMode("codex", mode);
    await this.reserve(node, taskId);
    const baseCommit = await currentCommit(this.config.cwd).catch(() => null);
    await this.store.update((state) => {
      const currentTask = state.tasks[taskId];
      const current = currentTask.nodes.find((item) => item.id === nodeId);
      current.status = "running";
      current.baseCommit = baseCommit;
      current.execution = { mode, threadId, hostId, startedAt: now(), completedAt: null };
      current.progress = { phase: "implementation", percent: 0, summary: note, filesTouched: [], blockers: [], checkpointAt: now(), nextCheckAt: new Date(Date.now() + currentTask.team.checkIntervalSeconds * 1000).toISOString() };
      current.updatedAt = now();
      const agent = state.agents.codex || this.agentState(current);
      state.agents.codex = { ...agent, status: "running", activeNodes: [...new Set([...(agent.activeNodes || []), nodeId])], updatedAt: now() };
    });
    await this.store.event("node.started", { taskId, nodeId, agent: "codex", executionMode: mode, threadId, hostId, baseCommit });
    return { accepted: true, taskId, nodeId, executionMode: mode, constraints: node.constraints, files: node.files };
  }

  async dispatchNode({ taskId, nodeId, prompt = null }) {
    await this.store.load();
    const task = this.store.state.tasks[taskId];
    const node = task?.nodes.find((item) => item.id === nodeId);
    if (!task) throw new Error(`找不到任务 ${taskId}`);
    if (!node) throw new Error(`找不到节点 ${nodeId}`);
    if (node.agent !== "claude") throw new Error("Claude dispatch 只支持 agent=claude；Codex 节点使用 orchestrator_start_codex_node");
    if (["failed", "blocked"].includes(node.status) && (node.worktree || node.branch)) await this.cleanupAttempt({ taskId, nodeId, reset: true });
    await this.reserve(node, taskId);
    const run = async () => {
      await this.store.update((state) => {
        const currentTask = state.tasks[taskId];
        const current = currentTask.nodes.find((item) => item.id === nodeId);
        current.status = "running";
        current.prompt = prompt;
        current.execution = { ...current.execution, mode: current.execution.mode === "alignment" ? "alignment" : "claude-cli", startedAt: now(), completedAt: null };
        current.progress = { phase: "implementation", percent: 0, summary: "Claude CLI 已启动", filesTouched: [], blockers: [], checkpointAt: now(), nextCheckAt: new Date(Date.now() + currentTask.team.checkIntervalSeconds * 1000).toISOString() };
        current.updatedAt = now();
        const agent = state.agents.claude || this.agentState(current);
        state.agents.claude = { ...agent, status: "running", activeNodes: [...new Set([...(agent.activeNodes || []), nodeId])], updatedAt: now() };
      });
      let result;
      try {
        result = await this.claude.runNode({ ...node, constraints: taskNodeConstraints(task, node) }, task, prompt);
      } catch (error) {
        result = { code: 1, error: error.message };
      }
      let validation = await this.validateNode({ taskId, nodeId, worktree: result.worktree, baseCommit: result.baseCommit });
      if (result.code === 0 && validation.passed && (validation.files.length || !node.requiresChanges)) {
        const commit = validation.files.length ? await this.commitNode({ taskId, nodeId, worktree: result.worktree }) : null;
        validation = { ...validation, commit };
      }
      const completedStatus = result.code === 0 && validation.passed ? "review" : "failed";
      let recordedStatus = completedStatus;
      await this.store.update((state) => {
        const currentTask = state.tasks[taskId];
        const current = currentTask.nodes.find((item) => item.id === nodeId);
        const handoffPending = current.status === "handoff";
        recordedStatus = handoffPending ? "handoff" : completedStatus;
        current.status = recordedStatus;
        current.result = result;
        current.validation = validation;
        current.branch = result.branch || current.branch;
        current.worktree = result.worktree || current.worktree;
        current.baseCommit = result.baseCommit || current.baseCommit;
        current.execution = { ...current.execution, completedAt: now() };
        current.progress = { ...(current.progress || {}), phase: recordedStatus, percent: 100, summary: result.claudeError || result.error || (recordedStatus === "review" ? "等待 Codex 审查" : recordedStatus === "handoff" ? "执行已停止，等待移交" : "Claude 节点失败"), checkpointAt: now(), nextCheckAt: null };
        current.updatedAt = now();
        currentTask.status = deriveTaskStatus(currentTask.nodes, currentTask.constraints);
        currentTask.updatedAt = now();
        const agent = state.agents.claude || {};
        const activeNodes = (agent.activeNodes || []).filter((item) => item !== nodeId);
        state.agents.claude = { ...agent, status: activeNodes.length ? "running" : "idle", activeNodes, updatedAt: now() };
      });
      await this.store.event("node.completed", { taskId, nodeId, agent: "claude", status: recordedStatus, validation, code: result.code });
      return { ...result, validation };
    };
    run().catch(async (error) => {
      await this.store.update((state) => {
        const currentTask = state.tasks[taskId];
        const current = currentTask?.nodes.find((item) => item.id === nodeId);
        if (current) {
          if (current.status !== "handoff") current.status = "failed";
          current.result = { error: error.message };
          current.execution = { ...current.execution, completedAt: now() };
          currentTask.status = deriveTaskStatus(currentTask.nodes, currentTask.constraints);
          currentTask.updatedAt = now();
        }
        const agent = state.agents.claude || {};
        const activeNodes = (agent.activeNodes || []).filter((item) => item !== nodeId);
        state.agents.claude = { ...agent, status: activeNodes.length ? "running" : "idle", activeNodes, updatedAt: now() };
      });
      await this.store.event("node.failed", { taskId, nodeId, agent: "claude", error: error.message });
    });
    await this.store.event("node.dispatched", { taskId, nodeId, agent: "claude", executionMode: node.execution.mode });
    return { accepted: true, taskId, nodeId, message: "Claude 节点已进入后台执行；Codex 应立即继续自己的开发节点，并在检查点查询团队状态" };
  }

  async checkpointNode({ taskId, nodeId, phase = "implementation", summary, percent = null, filesTouched = [], blockers = [], nextCheckSeconds = null }) {
    let checkpoint;
    let boundaryFiles = [];
    await this.store.update((state) => {
      const task = state.tasks[taskId];
      const node = task?.nodes.find((item) => item.id === nodeId);
      if (!node) throw new Error("任务或节点不存在");
      if (!["queued", "running", "handoff", "review"].includes(node.status)) throw new Error(`节点状态 ${node.status} 不能记录执行检查点`);
      const touched = [...new Set(filesTouched.map(String))];
      boundaryFiles = node.files.length ? touched.filter((file) => !node.files.some((scope) => fileMatchesScope(file, scope))) : [];
      const seconds = Number(nextCheckSeconds || task.team.checkIntervalSeconds || 120);
      checkpoint = {
        id: id("checkpoint"),
        at: now(),
        phase: String(phase),
        summary: String(summary || ""),
        percent: percent === null ? null : Math.max(0, Math.min(100, Number(percent))),
        filesTouched: touched,
        blockers: blockers.map(String),
        nextCheckAt: new Date(Date.now() + seconds * 1000).toISOString()
      };
      node.progress = { ...checkpoint, checkpointAt: checkpoint.at };
      node.updatedAt = now();
      if (boundaryFiles.length) {
        node.status = "handoff";
        node.handoffs.push({ id: id("handoff"), status: "requested", reason: "boundary_violation", evidence: `报告了范围外文件: ${boundaryFiles.join(", ")}`, requestedBy: node.agent, recommendedAgent: "codex", requestedAt: now(), completedAt: null, successorNodeId: null });
        task.status = deriveTaskStatus(task.nodes, task.constraints);
      }
      task.updatedAt = now();
    });
    const stopped = boundaryFiles.length ? this.claude.stopNode(nodeId) : false;
    await this.store.event("node.checkpoint", { taskId, nodeId, checkpoint, boundaryFiles });
    if (boundaryFiles.length) await this.store.event("node.handoff.requested", { taskId, nodeId, reason: "boundary_violation", boundaryFiles, recommendedAgent: "codex", automatic: true, stopped });
    return { checkpoint, boundaryViolation: boundaryFiles.length > 0, boundaryFiles, handoffRequired: boundaryFiles.length > 0, stopped };
  }

  async requestHandoff({ taskId, nodeId, reason, evidence, recommendedAgent = "codex", requestedBy = "codex" }) {
    if (!HANDOFF_REASONS.includes(reason)) throw new Error(`handoff reason 无效: ${reason}`);
    ensureAgent(recommendedAgent);
    const stopped = this.claude.stopNode(nodeId);
    let handoff;
    await this.store.update((state) => {
      const task = state.tasks[taskId];
      const node = task?.nodes.find((item) => item.id === nodeId);
      if (!node) throw new Error("任务或节点不存在");
      if (["merged", "passed", "cancelled"].includes(node.status)) throw new Error(`终态节点 ${node.status} 不能移交`);
      handoff = { id: id("handoff"), status: "requested", reason, evidence: String(evidence || ""), requestedBy: String(requestedBy), recommendedAgent, requestedAt: now(), completedAt: null, successorNodeId: null };
      node.handoffs.push(handoff);
      node.status = "handoff";
      node.progress = { ...(node.progress || {}), phase: "handoff", summary: handoff.evidence, blockers: [...new Set([...(node.progress?.blockers || []), reason])], checkpointAt: now(), nextCheckAt: null };
      node.updatedAt = now();
      task.status = deriveTaskStatus(task.nodes, task.constraints);
      task.updatedAt = now();
      const agent = state.agents[node.agent] || {};
      const activeNodes = (agent.activeNodes || []).filter((item) => item !== nodeId);
      state.agents[node.agent] = { ...agent, status: activeNodes.length ? "running" : "idle", activeNodes, updatedAt: now() };
    });
    await this.store.event("node.handoff.requested", { taskId, nodeId, handoff, stopped });
    return { handoff, stopped };
  }

  async reassignNode({ taskId, nodeId, targetAgent, executionMode, rationale, strategy = "restart", discardAttempt = false, successorId = null, constraints = [] }) {
    ensureAgent(targetAgent);
    ensureExecutionMode(targetAgent, executionMode);
    if (!["restart", "successor"].includes(strategy)) throw new Error("strategy 必须是 restart 或 successor");
    await this.store.load();
    const task = this.store.state.tasks[taskId];
    const source = task?.nodes.find((item) => item.id === nodeId);
    if (!source) throw new Error("任务或节点不存在");
    if (!["handoff", "failed", "blocked"].includes(source.status)) throw new Error("只有 handoff、failed 或 blocked 节点可以重新分配");
    const latest = source.handoffs.at(-1);
    if (strategy === "restart") {
      if ((source.worktree || source.branch) && !discardAttempt) throw new Error("节点存在隔离工作成果；restart 前必须明确 discardAttempt=true，或使用 successor 策略保留审查链");
      if (source.worktree || source.branch) await this.cleanupAttempt({ taskId, nodeId, reset: false });
      let reassigned;
      await this.store.update((state) => {
        const currentTask = state.tasks[taskId];
        const node = currentTask.nodes.find((item) => item.id === nodeId);
        node.history.push({ type: "reassignment", fromAgent: node.agent, toAgent: targetAgent, execution: node.execution, progress: node.progress, result: node.result, validation: node.validation, at: now() });
        node.agent = targetAgent;
        node.execution = { mode: executionMode, threadId: null, hostId: null, startedAt: null, completedAt: null };
        node.assignment = { assignedBy: "codex", rationale: String(rationale || ""), capabilities: [], decidedAt: now() };
        node.constraints = [...new Set([...taskNodeConstraints(currentTask, node), ...constraints.map(String)])];
        node.status = "planned";
        node.result = null;
        node.validation = null;
        node.progress = null;
        node.reservation = null;
        node.baseCommit = null;
        node.branch = null;
        node.worktree = null;
        if (node.handoffs.length) node.handoffs[node.handoffs.length - 1] = { ...node.handoffs.at(-1), status: "completed", completedAt: now(), targetAgent };
        node.updatedAt = now();
        currentTask.status = deriveTaskStatus(currentTask.nodes, currentTask.constraints);
        currentTask.updatedAt = now();
        state.agents[targetAgent] = { ...this.agentState(node), ...(state.agents[targetAgent] || {}) };
        reassigned = node;
      });
      await this.store.event("node.reassigned", { taskId, nodeId, targetAgent, executionMode, rationale, strategy, handoffId: latest?.id || null });
      return { strategy, node: reassigned };
    }
    const successor = await this.addNode({
      taskId,
      id: successorId || `${source.id}-handoff-${source.handoffs.length || 1}`,
      title: `${source.title}（移交）`,
      goal: source.goal,
      input: { ...source.input, handoff: { fromNodeId: source.id, reason: latest?.reason || "other", evidence: latest?.evidence || "", priorProgress: source.progress || null } },
      files: source.files,
      requiresChanges: source.requiresChanges,
      agent: targetAgent,
      executionMode,
      role: source.role,
      constraints: [...source.constraints, ...constraints],
      assignment: { assignedBy: "codex", rationale, capabilities: [] },
      tools: source.tools,
      model: source.model,
      dependencies: source.dependencies,
      lineage: { predecessorNodeId: source.id, rootNodeId: source.lineage?.rootNodeId || source.id }
    });
    await this.store.update((state) => {
      const currentTask = state.tasks[taskId];
      const node = currentTask.nodes.find((item) => item.id === nodeId);
      node.status = "blocked";
      node.reservation = node.reservation ? { ...node.reservation, releasedAt: now() } : null;
      if (node.handoffs.length) node.handoffs[node.handoffs.length - 1] = { ...node.handoffs.at(-1), status: "completed", completedAt: now(), targetAgent, successorNodeId: successor.id };
      node.updatedAt = now();
      currentTask.status = deriveTaskStatus(currentTask.nodes, currentTask.constraints);
      currentTask.updatedAt = now();
    });
    await this.store.event("node.handoff.completed", { taskId, nodeId, successorNodeId: successor.id, targetAgent, executionMode, rationale, strategy });
    return { strategy, sourceNodeId: nodeId, successor };
  }

  async finishCodexNode({ taskId, nodeId, outcome = "review", summary, filesTouched = [], checks = [], blockers = [] }) {
    if (!["review", "failed", "blocked"].includes(outcome)) throw new Error("Codex 节点只能结束为 review、failed 或 blocked；passed 需要独立审查调用");
    let result;
    await this.store.update((state) => {
      const task = state.tasks[taskId];
      const node = task?.nodes.find((item) => item.id === nodeId);
      if (!node || node.agent !== "codex") throw new Error("找不到 Codex 节点");
      if (!['running', 'handoff'].includes(node.status)) throw new Error(`Codex 节点状态 ${node.status} 不能结束`);
      const touched = [...new Set(filesTouched.map(String))];
      const outOfScope = node.files.length ? touched.filter((file) => !node.files.some((scope) => fileMatchesScope(file, scope))) : [];
      const finalOutcome = outOfScope.length ? "handoff" : outcome;
      result = { summary: String(summary || ""), filesTouched: touched, checks, blockers: blockers.map(String), outOfScope, completedAt: now() };
      node.result = result;
      node.status = finalOutcome;
      node.execution = { ...node.execution, completedAt: now() };
      node.progress = { ...(node.progress || {}), phase: finalOutcome, percent: 100, summary: result.summary, filesTouched: touched, blockers: result.blockers, checkpointAt: now(), nextCheckAt: null };
      node.reservation = node.reservation ? { ...node.reservation, releasedAt: finalOutcome === "handoff" ? null : now() } : null;
      if (outOfScope.length) node.handoffs.push({ id: id("handoff"), status: "requested", reason: "boundary_violation", evidence: `Codex 节点报告范围外文件: ${outOfScope.join(", ")}`, requestedBy: "codex", recommendedAgent: "codex", requestedAt: now(), completedAt: null, successorNodeId: null });
      node.updatedAt = now();
      task.status = deriveTaskStatus(task.nodes, task.constraints);
      task.updatedAt = now();
      const agent = state.agents.codex || {};
      const activeNodes = (agent.activeNodes || []).filter((item) => item !== nodeId);
      state.agents.codex = { ...agent, status: activeNodes.length ? "running" : "idle", activeNodes, updatedAt: now() };
    });
    await this.store.event("node.completed", { taskId, nodeId, agent: "codex", status: result.outOfScope.length ? "handoff" : outcome, result });
    if (result.outOfScope.length) await this.store.event("node.handoff.requested", { taskId, nodeId, reason: "boundary_violation", boundaryFiles: result.outOfScope, recommendedAgent: "codex", automatic: true });
    return result;
  }

  async reviewCodexNode({ taskId, nodeId, approved, note = "", checks = [] }) {
    let review;
    await this.store.update((state) => {
      const task = state.tasks[taskId];
      const node = task?.nodes.find((item) => item.id === nodeId);
      if (!node || node.agent !== "codex" || node.status !== "review") throw new Error("只有 review 状态的 Codex 节点可以审查");
      review = { approved: approved === true, note: String(note), checks, reviewedBy: "codex-lead", reviewedAt: now() };
      node.review = review;
      node.status = review.approved ? "passed" : "failed";
      node.updatedAt = now();
      task.status = deriveTaskStatus(task.nodes, task.constraints);
      task.updatedAt = now();
    });
    await this.store.event(review.approved ? "node.review.approved" : "node.review.rejected", { taskId, nodeId, review });
    return review;
  }

  async validateNode({ taskId, nodeId, worktree, baseCommit }) {
    await this.store.load();
    const task = this.store.state.tasks[taskId];
    const node = task?.nodes.find((item) => item.id === nodeId);
    if (!task || !node) return { passed: false, checks: [], error: "任务或节点不存在" };
    worktree ||= node.worktree;
    baseCommit ||= node.baseCommit;
    if (!worktree) return { passed: false, checks: [], error: "没有 worktree，无法验证" };
    const checks = [];
    for (const command of this.config.validationCommands) {
      try {
        const commandResult = await execCommand(command, { cwd: worktree, timeout: 15 * 60 * 1000, maxBuffer: 10 * 1024 * 1024 });
        checks.push({ command, passed: true, output: `${commandResult.stdout || ""}${commandResult.stderr || ""}`.slice(0, 4000) });
      } catch (error) {
        checks.push({ command, passed: false, output: `${error.stdout || ""}${error.stderr || error.message}`.slice(0, 4000) });
      }
    }
    const files = await changedFiles(worktree, baseCommit).catch(() => []);
    const outOfScope = node.files.length ? files.filter((file) => !node.files.some((scope) => fileMatchesScope(file, scope))) : [];
    const active = Object.values(this.store.state.tasks).flatMap((item) => item.nodes || []).filter((item) => item.id !== nodeId && ACTIVE_RESERVATION_STATUSES.has(item.status));
    const overlaps = active.flatMap((other) => files.filter((file) => other.files.some((scope) => fileMatchesScope(file, scope))).map((file) => ({ file, nodeId: other.id })));
    const mainFiles = baseCommit ? await changedFiles(this.config.cwd, baseCommit).catch(() => []) : [];
    const baseOverlaps = files.filter((file) => mainFiles.includes(file));
    const hasExpectedChanges = !node.requiresChanges || files.length > 0;
    const passed = checks.every((item) => item.passed) && !outOfScope.length && !overlaps.length && !baseOverlaps.length && hasExpectedChanges;
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
    const task = this.store.state.tasks[taskId];
    const node = task?.nodes.find((item) => item.id === nodeId);
    if (!node) throw new Error("任务或节点不存在");
    if (node.status === "running") throw new Error("不能清理正在运行的节点；请先停止或请求移交");
    if (node.worktree) await git(this.config.cwd, ["worktree", "remove", "--force", node.worktree]);
    if (node.branch) await git(this.config.cwd, ["branch", "-D", node.branch]);
    await this.store.update((state) => {
      const currentTask = state.tasks[taskId];
      const current = currentTask.nodes.find((item) => item.id === nodeId);
      if (current.result || current.validation || current.worktree || current.branch) current.history.push({ type: "attempt", result: current.result, validation: current.validation, branch: current.branch, worktree: current.worktree, archivedAt: now() });
      current.branch = null;
      current.worktree = null;
      current.baseCommit = null;
      current.result = null;
      current.validation = null;
      current.reservation = null;
      if (reset) current.status = "planned";
      current.updatedAt = now();
      currentTask.status = deriveTaskStatus(currentTask.nodes, currentTask.constraints);
      currentTask.updatedAt = now();
    });
    await this.store.event("node.attempt.cleaned", { taskId, nodeId, reset });
    return { cleaned: true, taskId, nodeId, reset };
  }

  async mergeNode({ taskId, nodeId }) {
    await this.store.load();
    const task = this.store.state.tasks[taskId];
    const node = task?.nodes.find((item) => item.id === nodeId);
    if (!node || node.status !== "review") throw new Error("只有通过回归检查且处于 review 状态的隔离节点才能合并");
    if (!node.branch || !node.worktree) throw new Error("节点没有可合并的隔离分支");
    const dirty = await gitOrThrow(this.config.cwd, ["status", "--porcelain=v1"]);
    if (dirty.stdout.trim()) throw new Error("Codex 主工作区存在未提交修改；请先完成 Codex 节点并提交后再合并隔离节点");
    const validation = await this.validateNode({ taskId, nodeId });
    if (!validation.passed) throw new Error(`节点在合并前重新验证失败: ${JSON.stringify(validation)}`);
    const result = await git(this.config.cwd, ["merge", "--no-ff", "--no-edit", node.branch]);
    if (result.code !== 0) {
      await this.store.event("merge.conflict", { taskId, nodeId, branch: node.branch, output: result.stderr });
      throw new Error(`合并冲突: ${result.stderr.trim()}`);
    }
    await this.store.update((state) => {
      const currentTask = state.tasks[taskId];
      const current = currentTask.nodes.find((item) => item.id === nodeId);
      current.status = "merged";
      current.reservation = current.reservation ? { ...current.reservation, releasedAt: now() } : null;
      current.updatedAt = now();
      currentTask.status = deriveTaskStatus(currentTask.nodes, currentTask.constraints);
      currentTask.updatedAt = now();
    });
    await this.store.event("node.merged", { taskId, nodeId, branch: node.branch });
    if (this.config.cleanupWorktreeOnMerge && node.worktree) {
      await git(this.config.cwd, ["worktree", "remove", "--force", node.worktree]);
      await git(this.config.cwd, ["branch", "-d", node.branch]);
      await this.store.event("node.worktree.cleaned", { taskId, nodeId, worktree: node.worktree, branch: node.branch });
    }
    return { merged: true, branch: node.branch, commit: await currentCommit(this.config.cwd) };
  }

  async recordCodexProgress({ taskId, nodeId = null, status = "review", note = "" }) {
    if (!nodeId) {
      await this.store.event("codex.progress", { taskId, nodeId: null, status, note });
      return { recorded: true, taskId, status };
    }
    await this.store.load();
    const node = this.store.state.tasks[taskId]?.nodes.find((item) => item.id === nodeId);
    if (!node) throw new Error("任务或节点不存在");
    if (status === "running" && ["planned", "failed", "blocked"].includes(node.status)) return this.startCodexNode({ taskId, nodeId, executionMode: node.execution.mode, note });
    if (status === "review" && node.status === "running") return this.finishCodexNode({ taskId, nodeId, outcome: "review", summary: note });
    if (status === "passed" && node.status === "review") return this.reviewCodexNode({ taskId, nodeId, approved: true, note });
    return this.checkpointNode({ taskId, nodeId, phase: status, summary: note });
  }

  async getNextActions() {
    await this.store.load();
    const actions = [];
    const currentTime = Date.now();
    for (const task of Object.values(this.store.state.tasks || {})) {
      if (task.constraints?.status === "pending") actions.push({ priority: 100, type: "collect_constraints", taskId: task.id, reason: "开发约束尚未回答或跳过" });
      const agentSet = new Set(task.nodes.map((node) => node.agent));
      if (task.team?.requireBothAgents && (!agentSet.has("codex") || !agentSet.has("claude"))) actions.push({ priority: 95, type: "complete_team_plan", taskId: task.id, reason: "任务要求 Codex 与 Claude 都承担职责" });
      for (const node of task.nodes) {
        if (node.status === "planned" && task.constraints?.status !== "pending") {
          if (this.dependenciesReady(task, node)) actions.push({ priority: 70, type: node.agent === "claude" ? "dispatch_claude" : "start_codex", taskId: task.id, nodeId: node.id, executionMode: node.execution.mode, reason: "依赖已满足且节点可启动" });
          else actions.push({ priority: 20, type: "wait_dependencies", taskId: task.id, nodeId: node.id, dependencies: node.dependencies, reason: "等待依赖节点通过" });
        }
        if (node.status === "running" && node.progress?.nextCheckAt && Date.parse(node.progress.nextCheckAt) <= currentTime) actions.push({ priority: 80, type: "checkpoint_overdue", taskId: task.id, nodeId: node.id, reason: "节点超过计划检查时间" });
        if (node.status === "handoff") actions.push({ priority: 90, type: "resolve_handoff", taskId: task.id, nodeId: node.id, handoff: node.handoffs.at(-1) || null, reason: "节点等待重新分配或建立后继节点" });
        if (node.status === "review") actions.push({ priority: 85, type: node.agent === "claude" ? "review_and_merge" : "review_codex", taskId: task.id, nodeId: node.id, reason: "执行成果等待 Codex 审查" });
        if (node.status === "failed") actions.push({ priority: 75, type: "diagnose_or_handoff", taskId: task.id, nodeId: node.id, reason: node.result?.claudeError || node.result?.error || "节点执行失败" });
      }
      if (deriveTaskStatus(task.nodes, task.constraints) === "completed") actions.push({ priority: 10, type: "task_complete", taskId: task.id, reason: "全部节点已通过或合并" });
    }
    return { actions: actions.sort((left, right) => right.priority - left.priority), generatedAt: now() };
  }

  async stopNode(nodeId) {
    const stopped = this.claude.stopNode(nodeId);
    await this.store.event("node.stop.requested", { nodeId, stopped });
    return { stopped, nodeId };
  }
}
