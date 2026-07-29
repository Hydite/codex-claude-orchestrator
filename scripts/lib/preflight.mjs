import { spawnSync } from "node:child_process";
import { resolveClaudeEnvironment } from "../../src/claude-environment.js";

function probe(command, args, environment = process.env) {
  const result = spawnSync(command, args, { encoding: "utf8", env: environment });
  if (result.error || result.status !== 0) return { available: false, error: (result.error?.message || result.stderr || result.stdout || `${command} exited ${result.status}`).trim() };
  return { available: true, output: `${result.stdout || ""}${result.stderr || ""}`.trim() };
}

export async function installationPreflight({ codexBin = "codex", claudeBin = "claude" } = {}) {
  const resolved = await resolveClaudeEnvironment({ claudeEnvironmentSource: "auto", claudeSettingsPath: "~/.claude/settings.json" });
  const node = { available: Number(process.versions.node.split(".")[0]) >= 20, version: process.versions.node };
  const git = probe("git", ["--version"]);
  const codex = probe(codexBin, ["--version"]);
  const claude = probe(claudeBin, ["--version"], resolved.environment);
  let claudeAuth = { loggedIn: false };
  if (claude.available) {
    const auth = probe(claudeBin, ["auth", "status", "--json"], resolved.environment);
    if (auth.available) {
      try { claudeAuth = JSON.parse(auth.output); }
      catch { claudeAuth = { loggedIn: false, error: "Claude auth status 返回了无效 JSON" }; }
    } else claudeAuth = { loggedIn: false, error: auth.error };
  }
  const effectiveProvider = resolved.info.gatewayReady ? "gateway" : claudeAuth.loggedIn === true ? "oauth" : "none";
  return { node, git, codex, claude: { ...claude, auth: claudeAuth, gateway: resolved.info, effectiveProvider }, ready: node.available && git.available && codex.available && claude.available && (resolved.info.gatewayReady || claudeAuth.loggedIn === true) };
}
