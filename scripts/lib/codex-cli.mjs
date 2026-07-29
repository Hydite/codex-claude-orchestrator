import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";

export async function runCodex(args, { home = os.homedir(), codexBin = "codex" } = {}) {
  const resolvedHome = path.resolve(home);
  const codexHome = path.join(resolvedHome, ".codex");
  await fs.mkdir(codexHome, { recursive: true });
  const result = spawnSync(codexBin, args, { encoding: "utf8", env: { ...process.env, HOME: resolvedHome, CODEX_HOME: codexHome } });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`${codexBin} ${args.join(" ")} 失败: ${(result.stderr || result.stdout).trim()}`);
  return (result.stdout || "").trim();
}

export async function runCodexJson(args, options) {
  const output = await runCodex([...args, "--json"], options);
  return output ? JSON.parse(output) : null;
}

