import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { StateStore } from "../src/state-store.js";

test("StateStore serializes concurrent events without data loss", async () => {
  const cwd = await fs.mkdtemp(path.join(os.tmpdir(), "cco-state-"));
  const store = new StateStore({ cwd, stateFile: ".state/state.json" });
  await Promise.all(Array.from({ length: 25 }, (_, index) => store.event("test", { index })));
  const state = await store.load();
  assert.equal(state.events.length, 25);
  const disk = JSON.parse(await fs.readFile(path.join(cwd, ".state/state.json"), "utf8"));
  assert.equal(disk.events.length, 25);
});

