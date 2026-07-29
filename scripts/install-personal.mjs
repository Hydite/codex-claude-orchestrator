import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { installPersonal, personalStatus, uninstallPersonal } from "./lib/personal-marketplace.mjs";

const action = process.argv[2] || "install";
const homeIndex = process.argv.indexOf("--home");
const home = homeIndex >= 0 ? path.resolve(process.argv[homeIndex + 1]) : os.homedir();
const register = !process.argv.includes("--skip-codex");
const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
let result;
if (action === "install") result = await installPersonal({ repoRoot, home, register });
else if (action === "update") result = await installPersonal({ repoRoot, home, register, update: true });
else if (action === "uninstall") result = await uninstallPersonal({ home, register });
else if (action === "status") result = await personalStatus({ home });
else throw new Error("操作只能是 install、update、uninstall 或 status");
console.log(JSON.stringify(result, null, 2));
