import test from "node:test";
import assert from "node:assert/strict";
import { constraintPayload, dashboardCounts, nodeCreationPayload, taskCreationPayload, topologyLanes } from "../src/ui/model.js";

test("UI creates hybrid team payloads with per-agent constraints", () => {
  const payload = taskCreationPayload({ goal: "full app", requireBothAgents: true, checkIntervalSeconds: 90, constraints: { shared: "strict types\nno secrets", codex: "accessible UI", claude: "API only", alignment: "OpenAPI first" } });
  assert.equal(payload.team.requireBothAgents, true);
  assert.equal(payload.team.checkIntervalSeconds, 90);
  assert.deepEqual(payload.constraints.shared, ["strict types", "no secrets"]);
  assert.deepEqual(payload.constraints.claude, ["API only"]);
});

test("UI explicit skip does not fabricate constraints", () => {
  assert.deepEqual(constraintPayload({ shared: "ignored" }, true), { status: "skipped", skipped: true, shared: [], codex: [], claude: [], alignment: [], questions: [], notes: undefined });
});

test("UI node payload and lanes preserve alignment as a distinct team role", () => {
  const node = nodeCreationPayload({ taskId: "t", title: "Contract", goal: "align", agent: "codex", executionMode: "alignment", role: "API contract", files: "contracts/openapi.json", dependencies: "", constraints: "schema first", rationale: "shared API", capabilities: "cross-stack review" });
  assert.deepEqual(node.files, ["contracts/openapi.json"]);
  assert.equal(node.assignment.rationale, "shared API");
  const lanes = topologyLanes({ nodes: [{ ...node, id: "n", execution: { mode: "alignment" } }] });
  assert.equal(lanes.alignment.length, 1);
});

test("dashboard counts active, review, and attention nodes", () => {
  const counts = dashboardCounts({ tasks: { t: { nodes: [{ status: "running" }, { status: "review" }, { status: "handoff" }] } } });
  assert.deepEqual(counts, { tasks: 1, active: 1, review: 1, attention: 1 });
});
