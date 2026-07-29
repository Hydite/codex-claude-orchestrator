import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

const FORWARDED_KEYS = [
  "ANTHROPIC_BASE_URL",
  "ANTHROPIC_AUTH_TOKEN",
  "ANTHROPIC_API_KEY",
  "ANTHROPIC_CUSTOM_HEADERS",
  "API_TIMEOUT_MS",
  "CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC",
  "CLAUDE_CODE_DISABLE_TERMINAL_TITLE",
  "HTTP_PROXY",
  "HTTPS_PROXY",
  "NO_PROXY"
];
const AUTH_KEYS = ["ANTHROPIC_AUTH_TOKEN", "ANTHROPIC_API_KEY"];

function expandHome(file) {
  if (file === "~") return os.homedir();
  if (file.startsWith(`~${path.sep}`) || file.startsWith("~/")) return path.join(os.homedir(), file.slice(2));
  return path.resolve(file);
}

function selectEnvironment(value = {}) {
  return Object.fromEntries(FORWARDED_KEYS.filter((key) => typeof value[key] === "string" && value[key].length > 0).map((key) => [key, value[key]]));
}

function safeOrigin(value) {
  if (!value) return null;
  try { return new URL(value).origin; }
  catch { return "<configured>"; }
}

export async function resolveClaudeEnvironment(config, baseEnvironment = process.env) {
  const sourceMode = config.claudeEnvironmentSource || "auto";
  const settingsPath = expandHome(config.claudeSettingsPath || "~/.claude/settings.json");
  const processValues = selectEnvironment(baseEnvironment);
  let settingsValues = {}, settingsError = null;
  try {
    const settings = JSON.parse(await fs.readFile(settingsPath, "utf8"));
    settingsValues = selectEnvironment(settings.env);
  } catch (error) {
    if (error.code !== "ENOENT") settingsError = error.message;
  }

  const settingsGatewayReady = Boolean(settingsValues.ANTHROPIC_BASE_URL && AUTH_KEYS.some((key) => settingsValues[key]));
  const processGatewayReady = Boolean(processValues.ANTHROPIC_BASE_URL && AUTH_KEYS.some((key) => processValues[key]));
  let selected = processValues;
  let source = Object.keys(processValues).length ? "process" : "none";
  if (sourceMode === "settings" || sourceMode === "auto" && settingsGatewayReady) {
    selected = settingsValues;
    source = Object.keys(settingsValues).length ? "claude-settings" : "none";
  } else if (sourceMode === "auto" && !processGatewayReady && Object.keys(settingsValues).length) {
    selected = settingsValues;
    source = "claude-settings";
  }

  const environment = { ...baseEnvironment };
  if (source !== "process") for (const key of FORWARDED_KEYS) delete environment[key];
  Object.assign(environment, selected);
  const gatewayConfigured = Boolean(selected.ANTHROPIC_BASE_URL);
  const credentialConfigured = AUTH_KEYS.some((key) => Boolean(selected[key]));
  return {
    environment,
    info: {
      source,
      sourceMode,
      settingsPath,
      settingsError,
      configuredKeys: Object.keys(selected).sort(),
      gatewayConfigured,
      credentialConfigured,
      gatewayReady: gatewayConfigured && credentialConfigured,
      baseUrlOrigin: safeOrigin(selected.ANTHROPIC_BASE_URL)
    }
  };
}
