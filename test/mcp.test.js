import test from "node:test";
import assert from "node:assert/strict";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

test("MCP stdio server exposes tools and dashboard resource", async () => {
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [new URL("../src/mcp-server.js", import.meta.url).pathname],
    cwd: new URL("..", import.meta.url).pathname
  });
  const client = new Client({ name: "test-client", version: "1.0.0" });
  try {
    await client.connect(transport);
    const listed = await client.listTools();
    assert.ok(listed.tools.some((tool) => tool.name === "orchestrator_set_workspace"));
    assert.ok(listed.tools.some((tool) => tool.name === "orchestrator_dispatch_node"));
    assert.ok(listed.tools.some((tool) => tool.name === "orchestrator_start_codex_node"));
    assert.ok(listed.tools.some((tool) => tool.name === "orchestrator_request_handoff"));
    assert.ok(listed.tools.some((tool) => tool.name === "orchestrator_get_next_actions"));
    const configured = await client.callTool({ name: "orchestrator_set_workspace", arguments: { workspaceRoot: new URL("..", import.meta.url).pathname } });
    assert.equal(configured.structuredContent.configured, true);
    const state = await client.callTool({ name: "orchestrator_get_state", arguments: {} });
    assert.ok(state.structuredContent.tasks);
    const invalid = await client.callTool({ name: "orchestrator_set_workspace", arguments: { workspaceRoot: "relative/path" } });
    assert.equal(invalid.isError, true);
    const resources = await client.listResources();
    assert.equal(resources.resources[0].uri, "ui://codex-claude-orchestrator/dashboard-v2.html");
    const resource = await client.readResource({ uri: resources.resources[0].uri });
    assert.match(resource.contents[0].text, /Codex × Claude Control Plane/);
    const legacyResource = await client.readResource({ uri: "ui://codex-claude-orchestrator/dashboard-v1.html" });
    assert.equal(legacyResource.contents[0].uri, "ui://codex-claude-orchestrator/dashboard-v1.html");
    assert.match(legacyResource.contents[0].text, /Codex × Claude Control Plane/);
    const dashboard = await client.callTool({ name: "orchestrator_open_dashboard", arguments: {} });
    assert.equal(dashboard._meta["ui.resourceUri"], "ui://codex-claude-orchestrator/dashboard-v2.html");
  } finally {
    await client.close();
  }
});
