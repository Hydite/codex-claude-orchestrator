import fs from "node:fs/promises";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { loadConfig } from "../src/config.js";
import { resolveClaudeEnvironment } from "../src/claude-environment.js";
const exec = promisify(execFile);

const root = process.cwd();
const target = path.join(root, ".codex-claude.json");
try {
  await fs.access(target);
  console.log(`保留现有配置: ${target}`);
} catch {
  await fs.copyFile(path.join(root, ".codex-claude.example.json"), target);
  console.log(`已创建配置: ${target}`);
}

try {
  const config = await loadConfig(root);
  const resolved = await resolveClaudeEnvironment(config);
  const result = await exec("claude", ["--version"], { timeout: 10000, env: resolved.environment });
  const auth = await exec("claude", ["auth", "status", "--json"], { timeout: 10000, env: resolved.environment });
  const status = JSON.parse(auth.stdout);
  console.log(`Claude CLI 已安装: ${`${result.stdout}${result.stderr}`.trim()}`);
  if (resolved.info.gatewayReady) console.log(`Claude Gateway 已就绪: ${resolved.info.baseUrlOrigin}（来源: ${resolved.info.source}）`);
  else console.log(status.loggedIn ? `Claude OAuth 登录已就绪: ${status.authMethod || "unknown"}` : "Claude CLI 尚未连接");
} catch (error) {
  console.warn(`Claude CLI 尚不可用: ${error.message}`);
  console.warn("安装或修复 PATH 后重新执行 npm run setup。");
}

try {
  const result = await exec("git", ["rev-parse", "--show-toplevel"], { cwd: root, timeout: 10000 });
  console.log(`Git 工作区: ${result.stdout.trim()}`);
} catch {
  console.warn("当前目录不是 Git 仓库；Claude 隔离 worktree 功能需要 Git。");
}
