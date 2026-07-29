import fs from "node:fs/promises";
import path from "node:path";
import { spawnSync } from "node:child_process";

const root = process.cwd();
const required = [
  ".codex-plugin/plugin.json", ".mcp.json", "package.json",
  "skills/codex-claude-orchestrator/SKILL.md", "ui/app.jsx", "src/ui/widget.html", "src/mcp-server.js",
  "src/orchestrator.js", "assets/logo.svg", "README.md", "docs/DEVELOPMENT.md",
  "docs/INSTALLATION.md", "scripts/install-personal.mjs", "scripts/install-marketplace.mjs",
  "scripts/install-official.mjs", "scripts/build-marketplace.mjs", "scripts/build-ui.mjs"
];
const errors = [];
for (const file of required) {
  try { await fs.access(path.join(root, file)); } catch { errors.push(`缺少文件: ${file}`); }
}

for (const file of [".codex-plugin/plugin.json", ".mcp.json", "package.json", ".codex-claude.example.json"]) {
  try { JSON.parse(await fs.readFile(path.join(root, file), "utf8")); } catch (error) { errors.push(`${file} JSON 无效: ${error.message}`); }
}

const plugin = JSON.parse(await fs.readFile(path.join(root, ".codex-plugin/plugin.json"), "utf8"));
const pkg = JSON.parse(await fs.readFile(path.join(root, "package.json"), "utf8"));
if (plugin.name !== "codex-claude-orchestrator") errors.push("插件名必须为 codex-claude-orchestrator");
if (plugin.version !== pkg.version) errors.push("plugin.json 与 package.json 版本不一致");
if (!/^\d+\.\d+\.\d+/.test(plugin.version)) errors.push("插件版本不是 semver");
const serverSource = await fs.readFile(path.join(root, "src/mcp-server.js"), "utf8");
if (!serverSource.includes(`version: "${plugin.version}"`)) errors.push("MCP serverInfo 版本与 plugin.json 不一致");

async function collectScripts(directory) {
  const files = [];
  for (const entry of await fs.readdir(directory, { withFileTypes: true })) {
    const absolute = path.join(directory, entry.name);
    if (entry.isDirectory()) files.push(...await collectScripts(absolute));
    else if (entry.name.endsWith(".mjs")) files.push(path.relative(root, absolute));
  }
  return files;
}

const syntaxFiles = ["src/mcp-server.js", "src/orchestrator.js", "src/schema.js", "src/tool-definitions.js", "src/claude-runtime.js", "src/state-store.js", ...await collectScripts(path.join(root, "scripts"))];
for (const file of syntaxFiles) {
  const check = spawnSync(process.execPath, ["--check", path.join(root, file)], { encoding: "utf8" });
  if (check.status !== 0) errors.push(`${file} 语法检查失败: ${check.stderr}`);
}

const widget = await fs.readFile(path.join(root, "src/ui/widget.html"), "utf8");
if (!widget.includes("Codex × Claude Control Plane") || !widget.includes("Running") || !widget.includes("Blocked") || !widget.includes("Ready")) errors.push("React MCP App 产物缺少看板标记；请先运行 npm run build:ui");
const runtimeFiles = ["src/mcp-server.js", "src/orchestrator.js", "src/schema.js", "src/tool-definitions.js", "src/claude-runtime.js", "src/config.js", "src/git.js", "src/state-store.js"];
for (const file of runtimeFiles) {
  const source = await fs.readFile(path.join(root, file), "utf8");
  for (const match of source.matchAll(/from\s+["']([^"']+)["']/g)) {
    if (!match[1].startsWith("node:") && !match[1].startsWith(".")) errors.push(`${file} 引入了非 Node 内置/本地运行时依赖: ${match[1]}`);
  }
}

if (errors.length) {
  console.error(errors.map((error) => `✗ ${error}`).join("\n"));
  process.exit(1);
}
console.log(`✓ 插件结构、JSON、版本和 JavaScript 语法检查通过（${required.length} 个必需文件）`);
