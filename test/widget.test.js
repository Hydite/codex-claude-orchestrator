import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";

test("React control plane bundles the Devin-style board and MCP bridge", async () => {
  const [html, app, bridge] = await Promise.all([
    fs.readFile(new URL("../src/ui/widget.html", import.meta.url), "utf8"),
    fs.readFile(new URL("../ui/app.jsx", import.meta.url), "utf8"),
    fs.readFile(new URL("../src/ui/bridge.js", import.meta.url), "utf8")
  ]);
  assert.match(html, /Codex × Claude Control Plane/);
  assert.match(html, /Running/);
  assert.match(html, /Blocked/);
  assert.match(html, /Ready/);
  assert.match(app, /orchestrator_get_next_actions/);
  assert.match(app, /orchestrator_request_handoff/);
  assert.match(app, /sendMessage/);
  assert.match(bridge, /openai\?\.callTool/);
  assert.match(bridge, /ui\/message/);
});
