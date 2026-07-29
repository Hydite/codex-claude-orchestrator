import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { Orchestrator } from "../src/orchestrator.js";
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
  const first = await orchestrator.createTask({ goal: "A", nodes: [{ title: "A", goal: "A", files: ["src/shared.js"] }] });
  const second = await orchestrator.createTask({ goal: "B", nodes: [{ title: "B", goal: "B", files: ["src/shared.js"] }] });
  await orchestrator.reserve(first.nodes[0], first.id);
  await orchestrator.store.update((state) => { state.tasks[first.id].nodes[0].status = "running"; });
  await assert.rejects(orchestrator.reserve(second.nodes[0], second.id), /冲突/);
});

