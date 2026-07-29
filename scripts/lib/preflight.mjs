import { spawnSync } from "node:child_process";

function probe(command, args) {
  const result = spawnSync(command, args, { encoding: "utf8" });
  if (result.error || result.status !== 0) return { available: false, error: (result.error?.message || result.stderr || result.stdout || `${command} exited ${result.status}`).trim() };
  return { available: true, output: `${result.stdout || ""}${result.stderr || ""}`.trim() };
}

export function installationPreflight({ codexBin = "codex", claudeBin = "claude" } = {}) {
  const node = { available: Number(process.versions.node.split(".")[0]) >= 20, version: process.versions.node };
  const git = probe("git", ["--version"]);
  const codex = probe(codexBin, ["--version"]);
  const claude = probe(claudeBin, ["--version"]);
  let claudeAuth = { loggedIn: false };
  if (claude.available) {
    const auth = probe(claudeBin, ["auth", "status", "--json"]);
    if (auth.available) {
      try { claudeAuth = JSON.parse(auth.output); }
      catch { claudeAuth = { loggedIn: false, error: "Claude auth status 返回了无效 JSON" }; }
    } else claudeAuth = { loggedIn: false, error: auth.error };
  }
  return { node, git, codex, claude: { ...claude, auth: claudeAuth }, ready: node.available && git.available && codex.available && claude.available && claudeAuth.loggedIn === true };
}

