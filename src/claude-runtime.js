import fs from "node:fs/promises";
import path from "node:path";
import { spawn, execFile } from "node:child_process";
import { promisify } from "node:util";
import { git, gitOrThrow, currentCommit } from "./git.js";
import { now } from "./schema.js";
const exec = promisify(execFile);

export class ClaudeRuntime {
  constructor(config, store) {
    this.config = config;
    this.store = store;
    this.processes = new Map();
  }

  async detect() {
    const command = this.config.claudeCommand;
    try {
      const result = await exec(command, ["--version"], { cwd: this.config.cwd, timeout: 10000 });
      return { installed: true, command, version: `${result.stdout}${result.stderr}`.trim(), mode: "cli" };
    } catch (error) {
      return { installed: false, command, version: null, error: error.message, mode: "cli" };
    }
  }

  async ensureAvailable() {
    const status = await this.detect();
    if (!status.installed) throw new Error(`未检测到 Claude CLI（${status.command}）。请先安装并确保它在 PATH 中。`);
    if (this.config.autoStartService && this.config.serviceCommand) await this.startService();
    return status;
  }

  async startService() {
    if (!Array.isArray(this.config.serviceCommand) || !this.config.serviceCommand.length) return { started: false, reason: "未配置 serviceCommand" };
    const [command, ...args] = this.config.serviceCommand;
    const child = spawn(command, args, { cwd: this.config.cwd, detached: true, stdio: "ignore" });
    child.unref();
    await this.store.event("claude.service.started", { command, args });
    return { started: true, command, args };
  }

  async createWorktree(node) {
    const root = path.resolve(this.config.cwd, this.config.worktreeRoot);
    const safe = `${node.id}`.replace(/[^a-zA-Z0-9_-]/g, "-");
    const worktree = path.join(root, safe);
    const branch = `codex-claude/${safe}`;
    await fs.mkdir(root, { recursive: true });
    const existing = await git(this.config.cwd, ["worktree", "list", "--porcelain"]);
    if (existing.code !== 0) throw new Error(`当前目录不是可用的 Git 仓库: ${existing.stderr.trim()}`);
    const baseCommit = await currentCommit(this.config.cwd);
    const result = await git(this.config.cwd, ["worktree", "add", "-b", branch, worktree, baseCommit]);
    if (result.code !== 0) throw new Error(`创建 Claude worktree 失败: ${result.stderr.trim()}`);
    return { worktree, branch, baseCommit };
  }

  buildArgs(prompt) {
    return this.config.claudeArgs.map((arg) => arg === "{prompt}" ? prompt : String(arg).replaceAll("{prompt}", prompt));
  }

  async runNode(node, task, extraPrompt = null) {
    const status = await this.ensureAvailable();
    const work = await this.createWorktree(node);
    const logDir = path.resolve(this.config.cwd, ".codex-claude/logs");
    await fs.mkdir(logDir, { recursive: true });
    const logFile = path.join(logDir, `${node.id}.log`);
    const prompt = [
      `你是 Claude 执行 Agent。任务目标：${task.goal}`,
      `节点目标：${node.goal}`,
      `节点结构化输入：${JSON.stringify(node.input)}`,
      `允许修改的文件范围：${node.files.length ? node.files.join(", ") : "由你判断，但必须在完成事件中列出变更"}`,
      extraPrompt ? `Codex 补充指令：${extraPrompt}` : null,
      "请在当前 worktree 完成实现，运行相关验证。不要修改任务范围外的文件。完成后输出简洁总结和测试结果。"
    ].filter(Boolean).join("\n");
    const args = this.buildArgs(prompt);
    const child = spawn(this.config.claudeCommand, args, { cwd: work.worktree, stdio: ["ignore", "pipe", "pipe"] });
    this.processes.set(node.id, child);
    await this.store.event("node.started", { taskId: task.id, nodeId: node.id, worktree: work.worktree, branch: work.branch, baseCommit: work.baseCommit, command: this.config.claudeCommand, args: ["...", "{prompt}"], claude: status });
    let output = "";
    const consume = async (chunk, stream) => {
      const text = chunk.toString(); output += text;
      await fs.appendFile(logFile, `[${now()}][${stream}] ${text}`);
      for (const line of text.split(/\r?\n/).filter(Boolean)) await this.store.event("node.output", { taskId: task.id, nodeId: node.id, stream, line: line.slice(0, 4000) });
    };
    child.stdout.on("data", (chunk) => { consume(chunk, "stdout").catch(() => {}); });
    child.stderr.on("data", (chunk) => { consume(chunk, "stderr").catch(() => {}); });
    const result = await new Promise((resolve) => {
      const timer = setTimeout(() => { child.kill("SIGTERM"); resolve({ code: 124, signal: "SIGTERM", timedOut: true }); }, this.config.taskTimeoutMs);
      child.on("error", (error) => { clearTimeout(timer); resolve({ code: 1, error: error.message }); });
      child.on("close", (code, signal) => { clearTimeout(timer); resolve({ code: code ?? 1, signal }); });
    });
    this.processes.delete(node.id);
    return { ...work, ...result, output: output.slice(-12000), logFile };
  }

  stopNode(nodeId) {
    const child = this.processes.get(nodeId);
    if (!child) return false;
    child.kill("SIGTERM");
    return true;
  }
}
