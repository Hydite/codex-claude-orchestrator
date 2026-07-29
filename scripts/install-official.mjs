import os from "node:os";
import path from "node:path";
import { PLUGIN_NAME } from "./lib/distribution.mjs";
import { runCodexJson } from "./lib/codex-cli.mjs";
import { installationPreflight } from "./lib/preflight.mjs";

const action = process.argv[2] || "install";
const homeIndex = process.argv.indexOf("--home");
const home = homeIndex >= 0 ? path.resolve(process.argv[homeIndex + 1]) : os.homedir();
const marketplaceIndex = process.argv.indexOf("--marketplace");
const requestedMarketplace = marketplaceIndex >= 0 ? process.argv[marketplaceIndex + 1] : null;
const options = { home };
const preflight = installationPreflight();
const inventory = await runCodexJson(["plugin", "list", "--available"], options);
const all = [...(inventory.installed || []), ...(inventory.available || [])];
const candidate = all.find((item) => item.name === PLUGIN_NAME && (!requestedMarketplace || item.marketplaceName === requestedMarketplace) && /openai.*curated|curated.*openai/i.test(item.marketplaceName || ""));
if (!candidate) {
  throw new Error("该插件尚未被 OpenAI 官方市场收录。已生成官方提交包；收录后此命令会自动发现并安装。当前可使用 npm run install:personal 或 npm run install:marketplace。");
}
let result;
if (action === "install" || action === "update") result = await runCodexJson(["plugin", "add", `${PLUGIN_NAME}@${candidate.marketplaceName}`], options);
else if (action === "uninstall") result = await runCodexJson(["plugin", "remove", `${PLUGIN_NAME}@${candidate.marketplaceName}`], options);
else if (action === "status") result = candidate;
else throw new Error("操作只能是 install、update、uninstall 或 status");
console.log(JSON.stringify({ action, marketplace: candidate.marketplaceName, preflight, result }, null, 2));
