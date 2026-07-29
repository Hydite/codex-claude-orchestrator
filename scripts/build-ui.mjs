import fs from "node:fs/promises";
import path from "node:path";
import { build } from "esbuild";

const root = path.resolve(new URL("..", import.meta.url).pathname);
const result = await build({
  absWorkingDir: root,
  entryPoints: ["ui/app.jsx"],
  outfile: "widget.js",
  bundle: true,
  write: false,
  format: "iife",
  platform: "browser",
  target: ["es2022"],
  jsx: "automatic",
  minify: true,
  legalComments: "none",
  loader: { ".css": "css" }
});

const script = result.outputFiles.find((file) => file.path.endsWith(".js"));
const style = result.outputFiles.find((file) => file.path.endsWith(".css"));
if (!script) throw new Error("React UI build did not emit JavaScript");
const html = `<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <title>Codex × Claude Control Plane</title>
  <style>${style?.text || ""}</style>
</head>
<body>
  <div id="root"></div>
  <script>${script.text.replaceAll("</script", "<\\/script")}</script>
</body>
</html>\n`;
await fs.writeFile(path.join(root, "src/ui/widget.html"), html);
console.log(`Built React MCP App (${Buffer.byteLength(html)} bytes)`);
