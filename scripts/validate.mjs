import fs from "node:fs/promises";
import path from "node:path";
import { spawnSync } from "node:child_process";

const root = process.cwd();
const required = [
  ".codex-plugin/plugin.json", ".mcp.json", "package.json",
  "skills/codex-claude-orchestrator/SKILL.md", "src/mcp-server.js",
  "src/orchestrator.js", "src/ui/widget.html", "assets/logo.svg", "README.md", "docs/DEVELOPMENT.md"
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

for (const file of ["src/mcp-server.js", "src/orchestrator.js", "src/claude-runtime.js", "src/state-store.js"]) {
  const check = spawnSync(process.execPath, ["--check", path.join(root, file)], { encoding: "utf8" });
  if (check.status !== 0) errors.push(`${file} 语法检查失败: ${check.stderr}`);
}

if (errors.length) {
  console.error(errors.map((error) => `✗ ${error}`).join("\n"));
  process.exit(1);
}
console.log(`✓ 插件结构、JSON、版本和 JavaScript 语法检查通过（${required.length} 个必需文件）`);
