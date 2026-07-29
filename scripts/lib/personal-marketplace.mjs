import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { copyPluginBundle, localCachebuster, marketplaceEntry, PLUGIN_NAME, readJson, writeJsonAtomic } from "./distribution.mjs";
import { installationPreflight } from "./preflight.mjs";

export function personalPaths(home = os.homedir()) {
  return {
    home: path.resolve(home),
    marketplaceFile: path.resolve(home, ".agents/plugins/marketplace.json"),
    pluginRoot: path.resolve(home, "plugins", PLUGIN_NAME)
  };
}

async function loadMarketplace(file) {
  try {
    const value = await readJson(file);
    if (!value.name || !Array.isArray(value.plugins)) throw new Error("缺少 name 或 plugins");
    value.interface ||= { displayName: "Personal" };
    return value;
  } catch (error) {
    if (error.code !== "ENOENT") throw new Error(`个人市场文件无效 ${file}: ${error.message}`);
    return { name: "personal", interface: { displayName: "Personal" }, plugins: [] };
  }
}

function runCodex(args, { home, codexBin = "codex" }) {
  const codexHome = path.join(home, ".codex");
  const result = spawnSync(codexBin, args, {
    encoding: "utf8",
    env: { ...process.env, HOME: home, CODEX_HOME: codexHome }
  });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`${codexBin} ${args.join(" ")} 失败: ${(result.stderr || result.stdout).trim()}`);
  return (result.stdout || "").trim();
}

export async function installPersonal({ repoRoot, home = os.homedir(), register = true, update = false, codexBin = "codex" }) {
  const preflight = installationPreflight({ codexBin });
  const paths = personalPaths(home);
  await fs.mkdir(path.dirname(paths.pluginRoot), { recursive: true });
  await fs.mkdir(path.join(paths.home, ".codex"), { recursive: true });
  const stage = `${paths.pluginRoot}.stage-${process.pid}-${Date.now()}`;
  const backup = `${paths.pluginRoot}.backup-${process.pid}-${Date.now()}`;
  const cachebuster = update ? localCachebuster() : null;
  await copyPluginBundle(repoRoot, stage, { cachebuster });
  await writeJsonAtomic(path.join(stage, ".codex-claude-install.json"), { managedBy: PLUGIN_NAME, source: path.resolve(repoRoot), installedAt: new Date().toISOString() });
  let hadExisting = false;
  try {
    await fs.rename(paths.pluginRoot, backup);
    hadExisting = true;
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }
  try {
    await fs.rename(stage, paths.pluginRoot);
  } catch (error) {
    if (hadExisting) await fs.rename(backup, paths.pluginRoot);
    throw error;
  }
  if (hadExisting) await fs.rm(backup, { recursive: true, force: true });

  const marketplace = await loadMarketplace(paths.marketplaceFile);
  const entry = marketplaceEntry();
  const existingIndex = marketplace.plugins.findIndex((plugin) => plugin.name === PLUGIN_NAME);
  if (existingIndex >= 0) marketplace.plugins[existingIndex] = entry;
  else marketplace.plugins.push(entry);
  await writeJsonAtomic(paths.marketplaceFile, marketplace);

  let codexOutput = null;
  if (register) codexOutput = runCodex(["plugin", "add", `${PLUGIN_NAME}@${marketplace.name}`, "--json"], { home: paths.home, codexBin });
  return { ...paths, marketplaceName: marketplace.name, cachebuster, registered: register, preflight, codexOutput };
}

export async function uninstallPersonal({ home = os.homedir(), register = true, codexBin = "codex" }) {
  const paths = personalPaths(home);
  const marketplace = await loadMarketplace(paths.marketplaceFile);
  let codexOutput = null;
  if (register) {
    try { codexOutput = runCodex(["plugin", "remove", `${PLUGIN_NAME}@${marketplace.name}`, "--json"], { home: paths.home, codexBin }); }
    catch (error) { if (!/not installed|not found/i.test(error.message)) throw error; }
  }
  marketplace.plugins = marketplace.plugins.filter((plugin) => plugin.name !== PLUGIN_NAME);
  await writeJsonAtomic(paths.marketplaceFile, marketplace);
  try {
    const marker = await readJson(path.join(paths.pluginRoot, ".codex-claude-install.json"));
    if (marker.managedBy !== PLUGIN_NAME) throw new Error("安装目录不是本安装器管理的目录");
    await fs.rm(paths.pluginRoot, { recursive: true, force: true });
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }
  return { ...paths, marketplaceName: marketplace.name, removed: true, codexOutput };
}

export async function personalStatus({ home = os.homedir() } = {}) {
  const paths = personalPaths(home);
  let manifest = null, marketplace = null;
  try { manifest = await readJson(path.join(paths.pluginRoot, ".codex-plugin/plugin.json")); } catch {}
  try { marketplace = await loadMarketplace(paths.marketplaceFile); } catch {}
  return { ...paths, installed: Boolean(manifest), version: manifest?.version || null, marketplaceName: marketplace?.name || null, listed: Boolean(marketplace?.plugins.some((plugin) => plugin.name === PLUGIN_NAME)) };
}
