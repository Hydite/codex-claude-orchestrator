import os from "node:os";
import path from "node:path";
import { COMMUNITY_MARKETPLACE_NAME, COMMUNITY_MARKETPLACE_REF, COMMUNITY_MARKETPLACE_SOURCE, PLUGIN_NAME } from "./lib/distribution.mjs";
import { runCodexJson } from "./lib/codex-cli.mjs";
import { installationPreflight } from "./lib/preflight.mjs";

const action = process.argv[2] || "install";
const homeIndex = process.argv.indexOf("--home");
const home = homeIndex >= 0 ? path.resolve(process.argv[homeIndex + 1]) : os.homedir();
const options = { home };
const preflight = installationPreflight();
let result;

if (action === "install") {
  const marketplace = await runCodexJson(["plugin", "marketplace", "add", COMMUNITY_MARKETPLACE_SOURCE, "--ref", COMMUNITY_MARKETPLACE_REF], options);
  const plugin = await runCodexJson(["plugin", "add", `${PLUGIN_NAME}@${COMMUNITY_MARKETPLACE_NAME}`], options);
  result = { action, preflight, marketplace, plugin };
} else if (action === "update") {
  const marketplace = await runCodexJson(["plugin", "marketplace", "upgrade", COMMUNITY_MARKETPLACE_NAME], options);
  const plugin = await runCodexJson(["plugin", "add", `${PLUGIN_NAME}@${COMMUNITY_MARKETPLACE_NAME}`], options);
  result = { action, preflight, marketplace, plugin };
} else if (action === "uninstall") {
  const plugin = await runCodexJson(["plugin", "remove", `${PLUGIN_NAME}@${COMMUNITY_MARKETPLACE_NAME}`], options);
  const marketplace = await runCodexJson(["plugin", "marketplace", "remove", COMMUNITY_MARKETPLACE_NAME], options);
  result = { action, plugin, marketplace };
} else if (action === "status") {
  const marketplaces = await runCodexJson(["plugin", "marketplace", "list"], options);
  const plugins = await runCodexJson(["plugin", "list", "--available"], options);
  result = {
    action,
    marketplace: marketplaces.marketplaces?.find((item) => item.name === COMMUNITY_MARKETPLACE_NAME) || null,
    plugin: [...(plugins.installed || []), ...(plugins.available || [])].find((item) => item.name === PLUGIN_NAME && item.marketplaceName === COMMUNITY_MARKETPLACE_NAME) || null
  };
} else {
  throw new Error("操作只能是 install、update、uninstall 或 status");
}
console.log(JSON.stringify(result, null, 2));
