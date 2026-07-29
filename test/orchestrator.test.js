import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { Orchestrator, deriveTaskStatus, fileMatchesScope, scopesOverlap, validateTaskGraph } from "../src/orchestrator.js";
import { DEFAULT_CONFIG } from "../src/config.js";

async function create() {
  const cwd = await fs.mkdtemp(path.join(os.tmpdir(), "cco-orchestrator-"));
  return new Orchestrator({ ...DEFAULT_CONFIG, cwd, stateFile: ".state/state.json" });
}

test("creates task goal with node-level structured input", async () => {
  const orchestrator = await create();
  const task = await orchestrator.createTask({ goal: "发布插件", nodes: [{ title: "UI", goal: "实现面板", input: { theme: "dark" }, files: ["src/ui/widget.html"], agent: "claude" }] });
  assert.equal(task.nodes[0].input.theme, "dark");
  assert.equal((await orchestrator.snapshot()).tasks[task.id].goal, "发布插件");
});

test("rejects overlapping file reservations", async () => {
  const orchestrator = await create();
  const first = await orchestrator.createTask({ goal: "A", constraints: { status: "skipped", skipped: true }, nodes: [{ title: "A", goal: "A", files: ["src/shared.js"] }] });
  const second = await orchestrator.createTask({ goal: "B", constraints: { status: "skipped", skipped: true }, nodes: [{ title: "B", goal: "B", files: ["src/shared.js"] }] });
  await orchestrator.reserve(first.nodes[0], first.id);
  await orchestrator.store.update((state) => { state.tasks[first.id].nodes[0].status = "running"; });
  await assert.rejects(orchestrator.reserve(second.nodes[0], second.id), /冲突/);
});

test("constraint intake blocks development until answered or skipped", async () => {
  const orchestrator = await create();
  const task = await orchestrator.createTask({ goal: "full stack", team: { requireBothAgents: true }, nodes: [
    { id: "frontend", title: "Frontend", goal: "build UI", agent: "codex", executionMode: "codex-lead", files: ["web/"] },
    { id: "backend", title: "Backend", goal: "build API", agent: "claude", executionMode: "claude-cli", files: ["api/"] }
  ] });
  assert.equal(task.status, "awaiting_constraints");
  await assert.rejects(orchestrator.reserve(task.nodes[0], task.id), /约束/);
  await orchestrator.setConstraints({ taskId: task.id, shared: ["TypeScript strict"], codex: ["use accessible UI"], claude: ["no shell interpolation"], alignment: ["OpenAPI is authoritative"] });
  const state = await orchestrator.snapshot();
  assert.equal(state.tasks[task.id].constraints.status, "ready");
  assert.deepEqual(state.tasks[task.id].nodes[0].constraints, ["TypeScript strict", "use accessible UI"]);
  const actions = await orchestrator.getNextActions();
  assert.deepEqual(actions.actions.filter((item) => item.taskId === task.id && /start_codex|dispatch_claude/.test(item.type)).map((item) => item.type).sort(), ["dispatch_claude", "start_codex"]);
});

test("explicit pending constraints remain pending even when draft text exists", async () => {
  const orchestrator = await create();
  const task = await orchestrator.createTask({ goal: "needs intake", constraints: { status: "pending", shared: ["draft question"] } });
  assert.equal(task.constraints.status, "pending");
  assert.ok(task.constraints.promptedAt);
  assert.equal((await orchestrator.getNextActions()).actions[0].type, "collect_constraints");
});

test("Codex nodes require start, checkpoint, finish, and independent review", async () => {
  const orchestrator = await create();
  const task = await orchestrator.createTask({ goal: "frontend", constraints: { status: "ready", shared: ["keep scope"] }, nodes: [{ id: "ui", title: "UI", goal: "build UI", agent: "codex", executionMode: "codex-subagent", files: ["src/ui/"] }] });
  await orchestrator.startCodexNode({ taskId: task.id, nodeId: "ui", executionMode: "codex-subagent", threadId: "thread-1" });
  await orchestrator.checkpointNode({ taskId: task.id, nodeId: "ui", summary: "components complete", percent: 70, filesTouched: ["src/ui/app.jsx"] });
  await orchestrator.finishCodexNode({ taskId: task.id, nodeId: "ui", summary: "UI done", filesTouched: ["src/ui/app.jsx"], checks: [{ command: "npm test", passed: true }] });
  let node = (await orchestrator.snapshot()).tasks[task.id].nodes[0];
  assert.equal(node.status, "review");
  assert.equal(node.execution.threadId, "thread-1");
  await orchestrator.reviewCodexNode({ taskId: task.id, nodeId: "ui", approved: true, note: "diff reviewed" });
  node = (await orchestrator.snapshot()).tasks[task.id].nodes[0];
  assert.equal(node.status, "passed");
  assert.equal((await orchestrator.snapshot()).tasks[task.id].status, "completed");
});

test("reported boundary violations trigger a handoff and safe reassignment", async () => {
  const orchestrator = await create();
  const task = await orchestrator.createTask({ goal: "bounded", constraints: { status: "skipped", skipped: true }, nodes: [{ id: "api", title: "API", goal: "build API", agent: "codex", executionMode: "codex-lead", files: ["src/api/"] }] });
  await orchestrator.startCodexNode({ taskId: task.id, nodeId: "api" });
  const checkpoint = await orchestrator.checkpointNode({ taskId: task.id, nodeId: "api", summary: "needed UI change", filesTouched: ["src/api/index.js", "src/ui/app.jsx"] });
  assert.equal(checkpoint.handoffRequired, true);
  assert.deepEqual(checkpoint.boundaryFiles, ["src/ui/app.jsx"]);
  let node = (await orchestrator.snapshot()).tasks[task.id].nodes[0];
  assert.equal(node.status, "handoff");
  assert.equal(node.handoffs[0].reason, "boundary_violation");
  await orchestrator.reassignNode({ taskId: task.id, nodeId: "api", targetAgent: "claude", executionMode: "claude-cli", rationale: "Claude owns the clean API boundary", strategy: "restart" });
  node = (await orchestrator.snapshot()).tasks[task.id].nodes[0];
  assert.equal(node.status, "planned");
  assert.equal(node.agent, "claude");
  assert.equal(node.handoffs[0].status, "completed");
});

test("successor handoff preserves lineage and prior evidence", async () => {
  const orchestrator = await create();
  const task = await orchestrator.createTask({ goal: "handoff", constraints: { status: "ready" }, nodes: [{ id: "backend", title: "Backend", goal: "backend", agent: "claude", files: ["api/"] }] });
  await orchestrator.requestHandoff({ taskId: task.id, nodeId: "backend", reason: "capability_gap", evidence: "required host-native integration", recommendedAgent: "codex" });
  const result = await orchestrator.reassignNode({ taskId: task.id, nodeId: "backend", targetAgent: "codex", executionMode: "codex-subagent", rationale: "Codex has the required host tool", strategy: "successor" });
  assert.equal(result.successor.agent, "codex");
  assert.equal(result.successor.lineage.predecessorNodeId, "backend");
  assert.equal(result.successor.input.handoff.evidence, "required host-native integration");
  const source = (await orchestrator.snapshot()).tasks[task.id].nodes.find((node) => node.id === "backend");
  assert.equal(source.status, "blocked");
  assert.equal(source.handoffs[0].successorNodeId, result.successor.id);
});

test("directory scopes match files and overlap nested scopes", () => {
  assert.equal(fileMatchesScope("src/api/client.js", "src/api/"), true);
  assert.equal(fileMatchesScope("src/ui/client.js", "src/api/"), false);
  assert.equal(scopesOverlap("src/api/", "src/api/client.js"), true);
  assert.equal(scopesOverlap("src/api/", "src/ui/"), false);
});

test("task status keeps running while any parallel node is active", () => {
  assert.equal(deriveTaskStatus([{ status: "review" }, { status: "running" }]), "running");
  assert.equal(deriveTaskStatus([{ status: "merged" }, { status: "passed" }]), "completed");
  assert.equal(deriveTaskStatus([{ status: "review" }, { status: "planned" }]), "review");
});

test("task graph rejects missing and cyclic dependencies", () => {
  assert.throws(() => validateTaskGraph([{ id: "a", dependencies: ["missing"] }]), /不存在/);
  assert.throws(() => validateTaskGraph([{ id: "a", dependencies: ["b"] }, { id: "b", dependencies: ["a"] }]), /循环依赖/);
  assert.equal(validateTaskGraph([{ id: "a", dependencies: [] }, { id: "b", dependencies: ["a"] }]), true);
});
