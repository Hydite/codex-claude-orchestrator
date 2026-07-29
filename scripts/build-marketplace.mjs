import path from "node:path";
import { fileURLToPath } from "node:url";
import { buildMarketplace } from "./lib/distribution.mjs";

function option(name, fallback = null) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : fallback;
}

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const mode = option("--mode", "community");
if (!['community', 'official'].includes(mode)) throw new Error("--mode 只能是 community 或 official");
const output = path.resolve(option("--output", path.join(repoRoot, mode === "official" ? "dist/openai-submission" : "dist/marketplace")));
const result = await buildMarketplace({ repoRoot, outputRoot: output, mode });
console.log(JSON.stringify(result, null, 2));
