import fs from "node:fs/promises";
import path from "node:path";

export const DEFAULT_CONFIG = {
  claudeCommand: "claude",
  claudeArgs: ["-p", "{prompt}", "--output-format", "stream-json", "--verbose", "--include-partial-messages", "--permission-mode", "auto", "--no-session-persistence"],
  claudeEnvironmentSource: "auto",
  claudeSettingsPath: "~/.claude/settings.json",
  autoStartClaude: true,
  autoStartService: false,
  serviceCommand: null,
  worktreeRoot: ".codex-claude/worktrees",
  stateFile: ".codex-claude/state.json",
  validationCommands: ["git diff --check"],
  maxConcurrentNodes: 2,
  cleanupWorktreeOnMerge: true,
  taskTimeoutMs: 3600000
};

export function validateConfig(config) {
  const errors = [];
  if (typeof config.claudeCommand !== "string" || !config.claudeCommand.trim()) errors.push("claudeCommand 必须是非空字符串");
  if (!Array.isArray(config.claudeArgs) || !config.claudeArgs.every((arg) => typeof arg === "string") || !config.claudeArgs.some((arg) => arg.includes("{prompt}"))) errors.push("claudeArgs 必须是字符串数组且包含 {prompt}");
  if (!["auto", "settings", "process"].includes(config.claudeEnvironmentSource)) errors.push("claudeEnvironmentSource 必须是 auto、settings 或 process");
  if (typeof config.claudeSettingsPath !== "string" || !config.claudeSettingsPath.trim()) errors.push("claudeSettingsPath 必须是非空字符串");
  if (!Array.isArray(config.validationCommands) || !config.validationCommands.every((command) => typeof command === "string" && command.trim())) errors.push("validationCommands 必须是非空字符串数组");
  if (!Number.isInteger(config.maxConcurrentNodes) || config.maxConcurrentNodes < 1 || config.maxConcurrentNodes > 16) errors.push("maxConcurrentNodes 必须是 1-16 的整数");
  if (!Number.isInteger(config.taskTimeoutMs) || config.taskTimeoutMs < 1000) errors.push("taskTimeoutMs 必须是不小于 1000 的整数");
  if (config.serviceCommand !== null && (!Array.isArray(config.serviceCommand) || config.serviceCommand.length === 0 || !config.serviceCommand.every((arg) => typeof arg === "string" && arg.trim()))) errors.push("serviceCommand 必须是 null 或非空字符串数组");
  for (const key of ["worktreeRoot", "stateFile"]) {
    if (typeof config[key] !== "string" || !config[key].trim() || path.isAbsolute(config[key]) || config[key].split(/[\\/]/).includes("..")) errors.push(`${key} 必须是工作区内的相对路径`);
  }
  if (errors.length) throw new Error(`编排器配置无效: ${errors.join("；")}`);
  return config;
}

export async function loadConfig(cwd = process.cwd()) {
  const configured = process.env.CODEX_CLAUDE_CONFIG || path.join(cwd, ".codex-claude.json");
  try {
    const value = JSON.parse(await fs.readFile(configured, "utf8"));
    return validateConfig({ ...DEFAULT_CONFIG, ...value, cwd, configPath: configured });
  } catch (error) {
    if (error.code !== "ENOENT") throw new Error(`配置文件无效 ${configured}: ${error.message}`);
    return validateConfig({ ...DEFAULT_CONFIG, cwd, configPath: configured });
  }
}
