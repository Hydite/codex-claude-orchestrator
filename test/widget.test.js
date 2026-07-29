import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";

test("dashboard contains live polling and MCP tool bridge", async () => {
  const html = await fs.readFile(new URL("../src/ui/widget.html", import.meta.url), "utf8");
  assert.match(html, /window\.openai\?\.callTool/);
  assert.match(html, /setInterval\(refresh/);
  assert.match(html, /orchestrator_get_state/);
});

