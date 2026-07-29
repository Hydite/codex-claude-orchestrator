import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

export const PLUGIN_NAME = "codex-claude-orchestrator";
export const COMMUNITY_MARKETPLACE_NAME = "hydite-codex-plugins";
export const COMMUNITY_MARKETPLACE_SOURCE = "Hydite/codex-claude-orchestrator";
export const COMMUNITY_MARKETPLACE_REF = "marketplace";

const COPY_ENTRIES = [
  ".codex-plugin",
  ".mcp.json",
  ".codex-claude.example.json",
  "assets",
  "docs",
  "skills",
  "src",
  "LICENSE",
  "README.md",
  "README.en.md",
  "README.ja.md",
  "README.ko.md"
];

export async function readJson(file) {
  return JSON.parse(await fs.readFile(file, "utf8"));
}

export async function writeJsonAtomic(file, value) {
  await fs.mkdir(path.dirname(file), { recursive: true });
  const temporary = `${file}.tmp-${process.pid}-${Date.now()}`;
  await fs.writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`);
  await fs.rename(temporary, file);
}

export function marketplaceEntry() {
  return {
    name: PLUGIN_NAME,
    source: { source: "local", path: `./plugins/${PLUGIN_NAME}` },
    policy: { installation: "AVAILABLE", authentication: "ON_INSTALL" },
    category: "Developer Tools"
  };
}

export async function copyPluginBundle(repoRoot, destination, { cachebuster = null } = {}) {
  const manifest = await readJson(path.join(repoRoot, ".codex-plugin/plugin.json"));
  if (manifest.name !== PLUGIN_NAME) throw new Error(`插件清单名称不匹配: ${manifest.name}`);
  await fs.mkdir(destination, { recursive: true });
  for (const entry of COPY_ENTRIES) {
    const source = path.join(repoRoot, entry);
    await fs.cp(source, path.join(destination, entry), { recursive: true, force: true });
  }
  if (cachebuster) {
    const installedManifest = await readJson(path.join(destination, ".codex-plugin/plugin.json"));
    const baseVersion = installedManifest.version.split("+")[0];
    installedManifest.version = `${baseVersion}+codex.${cachebuster}`;
    await writeJsonAtomic(path.join(destination, ".codex-plugin/plugin.json"), installedManifest);
  }
  await writeJsonAtomic(path.join(destination, "package.json"), {
    name: PLUGIN_NAME,
    version: manifest.version.split("+")[0],
    private: true,
    type: "module",
    description: manifest.description,
    license: manifest.license,
    engines: { node: ">=20" },
    scripts: { start: "node src/mcp-server.js" }
  });
  return manifest;
}

export async function buildMarketplace({ repoRoot, outputRoot, mode = "community" }) {
  const resolvedRepo = path.resolve(repoRoot);
  const resolvedOutput = path.resolve(outputRoot);
  const repoDist = path.join(resolvedRepo, "dist");
  const within = (parent, child) => { const relative = path.relative(parent, child); return relative === "" || relative && !relative.startsWith("..") && !path.isAbsolute(relative); };
  if (resolvedOutput === resolvedRepo || !within(repoDist, resolvedOutput) && !within(path.resolve(os.tmpdir()), resolvedOutput)) {
    throw new Error("输出目录必须位于仓库 dist/ 或系统临时目录中");
  }
  await fs.rm(resolvedOutput, { recursive: true, force: true });
  const pluginRoot = path.join(resolvedOutput, "plugins", PLUGIN_NAME);
  const manifest = await copyPluginBundle(resolvedRepo, pluginRoot);
  const marketplaceName = mode === "official" ? "openai-curated-submission" : COMMUNITY_MARKETPLACE_NAME;
  const marketplaceDocument = {
    name: marketplaceName,
    interface: { displayName: mode === "official" ? "OpenAI Curated Submission" : "Hydite Codex Plugins" },
    plugins: [marketplaceEntry()]
  };
  await writeJsonAtomic(path.join(resolvedOutput, ".agents/plugins/marketplace.json"), marketplaceDocument);
  const heading = mode === "official" ? "OpenAI official marketplace submission" : "Hydite Codex plugin marketplace";
  await fs.writeFile(path.join(resolvedOutput, "README.md"), `# ${heading}\n\nGenerated from ${PLUGIN_NAME} ${manifest.version}. Do not edit generated files directly.\n`);
  if (mode === "official") {
    await writeJsonAtomic(path.join(resolvedOutput, ".agents/plugins/api_marketplace.json"), { ...marketplaceDocument, name: "openai-api-curated-submission" });
    await writeJsonAtomic(path.join(resolvedOutput, "marketplace-entry.json"), marketplaceEntry());
    await writeJsonAtomic(path.join(resolvedOutput, "api-marketplace-entry.json"), marketplaceEntry());
    await fs.writeFile(path.join(resolvedOutput, "SUBMISSION.md"), `# Submission notes\n\nCopy \`plugins/${PLUGIN_NAME}\` into the OpenAI curated plugins repository. Append \`marketplace-entry.json\` to the default marketplace and \`api-marketplace-entry.json\` to the API-key-login marketplace. Inclusion requires OpenAI review.\n`);
  }
  return { outputRoot: resolvedOutput, pluginRoot, marketplaceName, version: manifest.version };
}

export function localCachebuster(date = new Date()) {
  return `local-${date.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z").replace("T", "-")}`;
}
