import fs from "node:fs/promises";
import path from "node:path";

export const DEFAULT_CONFIG = {
  claudeCommand: "claude",
  claudeArgs: ["-p", "{prompt}", "--output-format", "stream-json"],
  autoStartClaude: true,
  autoStartService: false,
  serviceCommand: null,
  worktreeRoot: ".codex-claude/worktrees",
  stateFile: ".codex-claude/state.json",
  validationCommands: ["git diff --check"],
  maxConcurrentNodes: 2,
  taskTimeoutMs: 3600000
};

export async function loadConfig(cwd = process.cwd()) {
  const configured = process.env.CODEX_CLAUDE_CONFIG || path.join(cwd, ".codex-claude.json");
  try {
    const value = JSON.parse(await fs.readFile(configured, "utf8"));
    return { ...DEFAULT_CONFIG, ...value, cwd, configPath: configured };
  } catch (error) {
    if (error.code !== "ENOENT") throw new Error(`配置文件无效 ${configured}: ${error.message}`);
    return { ...DEFAULT_CONFIG, cwd, configPath: configured };
  }
}

