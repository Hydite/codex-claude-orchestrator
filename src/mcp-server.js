import fs from "node:fs/promises";
import path from "node:path";
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { CallToolRequestSchema, ListToolsRequestSchema, ListResourcesRequestSchema, ReadResourceRequestSchema } from "@modelcontextprotocol/sdk/types.js";
import { loadConfig } from "./config.js";
import { Orchestrator } from "./orchestrator.js";

const pluginRoot = process.cwd();
let config = await loadConfig(process.env.CODEX_WORKSPACE_ROOT || pluginRoot);
let orchestrator = new Orchestrator(config);
const widgetPath = path.resolve(pluginRoot, "src/ui/widget.html");
const widgetUri = "ui://codex-claude-orchestrator/dashboard-v1.html";

const tools = [
  { name: "orchestrator_set_workspace", description: "Use this first in every Codex task to bind the orchestrator to the active repository root.", inputSchema: { type: "object", required: ["workspaceRoot"], properties: { workspaceRoot: { type: "string", description: "Absolute path to the active Git repository" } } }, annotations: { destructiveHint: false } },
  { name: "claude_status", description: "Use this when you need to detect whether Claude CLI is installed and available.", inputSchema: { type: "object", properties: {} }, annotations: { readOnlyHint: true } },
  { name: "orchestrator_get_state", description: "Use this when you need the live tasks, nodes, agents, events, conflicts, and validation state for the visual dashboard.", inputSchema: { type: "object", properties: {} }, _meta: { "ui.resourceUri": widgetUri, "openai/outputTemplate": widgetUri }, annotations: { readOnlyHint: true } },
  { name: "orchestrator_create_task", description: "Use this to create a goal and its parallelizable node inputs. Each node must have a clear goal, agent, dependencies, and optional file scope.", inputSchema: { type: "object", required: ["goal"], properties: { title: { type: "string" }, goal: { type: "string" }, metadata: { type: "object" }, nodes: { type: "array", items: { type: "object", required: ["title", "goal"], properties: { id: { type: "string" }, title: { type: "string" }, goal: { type: "string" }, input: { type: "object" }, files: { type: "array", items: { type: "string" } }, agent: { type: "string", enum: ["claude", "codex"] }, dependencies: { type: "array", items: { type: "string" } } } } } } }, annotations: { destructiveHint: false } },
  { name: "orchestrator_add_node", description: "Use this to add a node-level input and goal to an existing task.", inputSchema: { type: "object", required: ["taskId", "title", "goal"], properties: { taskId: { type: "string" }, id: { type: "string" }, title: { type: "string" }, goal: { type: "string" }, input: { type: "object" }, files: { type: "array", items: { type: "string" } }, agent: { type: "string", enum: ["claude", "codex"] }, dependencies: { type: "array", items: { type: "string" } } } }, annotations: { destructiveHint: false } },
  { name: "orchestrator_dispatch_node", description: "Use this to dispatch a Claude node into an isolated Git worktree. The call returns immediately; poll orchestrator_get_state for live progress.", inputSchema: { type: "object", required: ["taskId", "nodeId"], properties: { taskId: { type: "string" }, nodeId: { type: "string" }, prompt: { type: "string" } } }, _meta: { "ui.resourceUri": widgetUri }, annotations: { destructiveHint: false } },
  { name: "orchestrator_validate_node", description: "Use this to run diff, scope, overlap, and configured regression checks for a Claude node before review or merge.", inputSchema: { type: "object", required: ["taskId", "nodeId"], properties: { taskId: { type: "string" }, nodeId: { type: "string" } } }, annotations: { readOnlyHint: true } },
  { name: "orchestrator_merge_node", description: "Use this only after reviewing a node in review status; it merges the isolated branch into the current Codex branch.", inputSchema: { type: "object", required: ["taskId", "nodeId"], properties: { taskId: { type: "string" }, nodeId: { type: "string" } } }, annotations: { destructiveHint: true, idempotentHint: false } },
  { name: "orchestrator_record_codex_progress", description: "Use this to record Codex-owned work and keep the shared task graph synchronized.", inputSchema: { type: "object", required: ["taskId"], properties: { taskId: { type: "string" }, nodeId: { type: "string" }, status: { type: "string", enum: ["planned", "running", "review", "passed", "blocked", "failed", "merged"] }, note: { type: "string" } } }, annotations: { destructiveHint: false } },
  { name: "orchestrator_stop_node", description: "Use this to stop a running Claude node.", inputSchema: { type: "object", required: ["nodeId"], properties: { nodeId: { type: "string" } } }, annotations: { destructiveHint: true } }
];

const server = new Server({ name: "codex-claude-orchestrator", version: "0.1.0" }, { capabilities: { tools: {}, resources: {} } });
server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools }));
server.setRequestHandler(ListResourcesRequestSchema, async () => ({ resources: [{ uri: widgetUri, name: "Orchestrator Dashboard", description: "Live Codex × Claude task graph", mimeType: "text/html;profile=mcp-app" }] }));
server.setRequestHandler(ReadResourceRequestSchema, async ({ params }) => { if (params.uri !== widgetUri) throw new Error("Unknown resource"); return { contents: [{ uri: widgetUri, mimeType: "text/html;profile=mcp-app", text: await fs.readFile(widgetPath, "utf8") }] }; });
server.setRequestHandler(CallToolRequestSchema, async ({ params }) => {
  try {
    const a = params.arguments || {}; let result;
    if (params.name === "orchestrator_set_workspace") { config = await loadConfig(path.resolve(a.workspaceRoot)); orchestrator = new Orchestrator(config); result = { configured: true, workspaceRoot: config.cwd, claude: await orchestrator.claude.detect() }; }
    else if (params.name === "claude_status") result = await orchestrator.status();
    else if (params.name === "orchestrator_get_state") result = await orchestrator.snapshot();
    else if (params.name === "orchestrator_create_task") result = await orchestrator.createTask(a);
    else if (params.name === "orchestrator_add_node") result = await orchestrator.addNode(a);
    else if (params.name === "orchestrator_dispatch_node") result = await orchestrator.dispatchNode(a);
    else if (params.name === "orchestrator_validate_node") { await orchestrator.snapshot(); result = await orchestrator.validateNode(a); }
    else if (params.name === "orchestrator_merge_node") result = await orchestrator.mergeNode(a);
    else if (params.name === "orchestrator_record_codex_progress") result = await orchestrator.recordCodexProgress(a);
    else if (params.name === "orchestrator_stop_node") result = await orchestrator.stopNode(a.nodeId);
    else throw new Error(`未知工具 ${params.name}`);
    return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }], structuredContent: result, _meta: { "ui.resourceUri": widgetUri } };
  } catch (error) { return { isError: true, content: [{ type: "text", text: error.message }] }; }
});

await server.connect(new StdioServerTransport());
