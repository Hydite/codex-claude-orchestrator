import { execFile } from "node:child_process";
import { promisify } from "node:util";
const exec = promisify(execFile);

export async function git(cwd, args, options = {}) {
  try {
    const result = await exec("git", args, { cwd, maxBuffer: 10 * 1024 * 1024, timeout: options.timeout || 120000 });
    return { code: 0, stdout: result.stdout, stderr: result.stderr };
  } catch (error) {
    return { code: error.code || 1, stdout: error.stdout || "", stderr: error.stderr || error.message };
  }
}

export async function gitOrThrow(cwd, args, options) {
  const result = await git(cwd, args, options);
  if (result.code !== 0) throw new Error(`git ${args.join(" ")} 失败: ${result.stderr.trim()}`);
  return result;
}

export function lines(text) {
  return text.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
}

export async function currentCommit(cwd) {
  return (await gitOrThrow(cwd, ["rev-parse", "HEAD"])).stdout.trim();
}

export async function changedFiles(cwd, base = null) {
  const args = base ? ["diff", "--name-only", `${base}...HEAD`] : ["status", "--short"];
  return lines((await gitOrThrow(cwd, args)).stdout).map((line) => line.replace(/^\s*[MADRCU?]+\s+/, "").trim());
}

