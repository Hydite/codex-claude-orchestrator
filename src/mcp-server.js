import fs from "node:fs/promises";
import path from "node:path";
import { loadConfig } from "./config.js";
import { Orchestrator } from "./orchestrator.js";
import { tools, WIDGET_URI } from "./tool-definitions.js";

const pluginRoot = process.cwd();
const widgetPath = path.resolve(pluginRoot, "src/ui/widget.html");
let config = await loadConfig(process.env.CODEX_WORKSPACE_ROOT || pluginRoot);
let orchestrator = new Orchestrator(config);

async function callTool(name, args = {}) {
  if (name === "orchestrator_set_workspace") {
    if (!path.isAbsolute(args.workspaceRoot)) throw new Error("workspaceRoot 必须是绝对路径");
    const workspaceRoot = path.resolve(args.workspaceRoot);
    const stat = await fs.stat(workspaceRoot);
    if (!stat.isDirectory()) throw new Error("workspaceRoot 必须是目录");
    config = await loadConfig(workspaceRoot);
    orchestrator = new Orchestrator(config);
    return { configured: true, workspaceRoot: config.cwd };
  }
  if (name === "claude_status") return orchestrator.status(args);
  if (name === "orchestrator_get_state") return orchestrator.snapshot();
  if (name === "orchestrator_open_dashboard") return orchestrator.snapshot();
  if (name === "orchestrator_create_task") return orchestrator.createTask(args);
  if (name === "orchestrator_set_constraints") return orchestrator.setConstraints(args);
  if (name === "orchestrator_add_node") return orchestrator.addNode(args);
  if (name === "orchestrator_assign_node") return orchestrator.assignNode(args);
  if (name === "orchestrator_start_codex_node") return orchestrator.startCodexNode(args);
  if (name === "orchestrator_dispatch_node") return orchestrator.dispatchNode(args);
  if (name === "orchestrator_checkpoint_node") return orchestrator.checkpointNode(args);
  if (name === "orchestrator_request_handoff") return orchestrator.requestHandoff(args);
  if (name === "orchestrator_reassign_node") return orchestrator.reassignNode(args);
  if (name === "orchestrator_finish_codex_node") return orchestrator.finishCodexNode(args);
  if (name === "orchestrator_review_codex_node") return orchestrator.reviewCodexNode(args);
  if (name === "orchestrator_get_next_actions") return orchestrator.getNextActions();
  if (name === "orchestrator_validate_node") return orchestrator.validateNode(args);
  if (name === "orchestrator_merge_node") return orchestrator.mergeNode(args);
  if (name === "orchestrator_record_codex_progress") return orchestrator.recordCodexProgress(args);
  if (name === "orchestrator_stop_node") return orchestrator.stopNode(args.nodeId);
  if (name === "orchestrator_discard_node") return orchestrator.cleanupAttempt({ ...args, reset: true });
  throw new Error(`未知工具 ${name}`);
}

async function handleRequest(request) {
  if (request.method === "initialize") {
    return {
      protocolVersion: request.params?.protocolVersion || "2025-06-18",
      capabilities: { tools: { listChanged: false }, resources: { subscribe: false, listChanged: false } },
      serverInfo: { name: "codex-claude-orchestrator", version: "0.3.0" }
    };
  }
  if (request.method === "ping") return {};
  if (request.method === "tools/list") return { tools };
  if (request.method === "resources/list") {
    return { resources: [{ uri: WIDGET_URI, name: "Hybrid Team Control Plane", description: "React control plane for the live Codex × Claude team", mimeType: "text/html;profile=mcp-app" }] };
  }
  if (request.method === "resources/read") {
    if (request.params?.uri !== WIDGET_URI) throw Object.assign(new Error("Unknown resource"), { code: -32002 });
    return {
      contents: [{
        uri: WIDGET_URI,
        mimeType: "text/html;profile=mcp-app",
        text: await fs.readFile(widgetPath, "utf8"),
        _meta: {
          ui: { prefersBorder: true, csp: { connectDomains: [], resourceDomains: [] } },
          "openai/widgetDescription": "Codex、原生 subagent 与 Claude CLI 的动态团队控制面"
        }
      }]
    };
  }
  if (request.method === "tools/call") {
    try {
      const result = await callTool(request.params?.name, request.params?.arguments || {});
      return {
        content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
        structuredContent: result,
        ...(request.params?.name === "orchestrator_open_dashboard" ? { _meta: { "ui.resourceUri": WIDGET_URI, "openai/outputTemplate": WIDGET_URI } } : {})
      };
    } catch (error) {
      return { isError: true, content: [{ type: "text", text: error.message }] };
    }
  }
  throw Object.assign(new Error(`Method not found: ${request.method}`), { code: -32601 });
}

function send(message) {
  process.stdout.write(`${JSON.stringify(message)}\n`);
}

let buffer = "";
process.stdin.setEncoding("utf8");
process.stdin.on("data", (chunk) => {
  buffer += chunk;
  let newline;
  while ((newline = buffer.indexOf("\n")) >= 0) {
    const line = buffer.slice(0, newline).replace(/\r$/, "");
    buffer = buffer.slice(newline + 1);
    if (!line.trim()) continue;
    let request;
    try {
      request = JSON.parse(line);
    } catch (error) {
      send({ jsonrpc: "2.0", id: null, error: { code: -32700, message: error.message } });
      continue;
    }
    if (request.id === undefined) continue;
    handleRequest(request)
      .then((result) => send({ jsonrpc: "2.0", id: request.id, result }))
      .catch((error) => send({ jsonrpc: "2.0", id: request.id, error: { code: error.code || -32000, message: error.message } }));
  }
});
