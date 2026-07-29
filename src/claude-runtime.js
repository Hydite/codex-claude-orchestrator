import fs from "node:fs/promises";
import path from "node:path";
import { spawn, execFile } from "node:child_process";
import { promisify } from "node:util";
import { git, gitOrThrow, currentCommit } from "./git.js";
import { now } from "./schema.js";
import { resolveClaudeEnvironment } from "./claude-environment.js";
const exec = promisify(execFile);

export function findClaudeProcessError(output) {
  for (const line of output.split(/\r?\n/)) {
    try {
      const payload = JSON.parse(line);
      if (payload?.is_error === true || payload?.type === "result" && payload?.is_error === true) return payload.result || `Claude API error ${payload.api_error_status || "unknown"}`;
    } catch {}
  }
  return null;
}

export class ClaudeRuntime {
  constructor(config, store) {
    this.config = config;
    this.store = store;
    this.processes = new Map();
    this.serviceStarted = false;
  }

  async detect() {
    const command = this.config.claudeCommand;
    const resolved = await resolveClaudeEnvironment(this.config);
    try {
      const result = await exec(command, ["--version"], { cwd: this.config.cwd, timeout: 10000, env: resolved.environment });
      let auth = { loggedIn: null };
      try {
        const authResult = await exec(command, ["auth", "status", "--json"], { cwd: this.config.cwd, timeout: 10000, env: resolved.environment });
        auth = JSON.parse(authResult.stdout);
      } catch (error) {
        auth = { loggedIn: false, error: `${error.stderr || error.message}`.trim() };
      }
      const effectiveProvider = resolved.info.gatewayReady ? "gateway" : auth.loggedIn === true ? "oauth" : "none";
      return { installed: true, connected: resolved.info.gatewayReady || auth.loggedIn === true, command, version: `${result.stdout}${result.stderr}`.trim(), auth, gateway: resolved.info, effectiveProvider, mode: "cli" };
    } catch (error) {
      return { installed: false, connected: false, command, version: null, gateway: resolved.info, error: error.message, mode: "cli" };
    }
  }

  async ensureAvailable() {
    const status = await this.detect();
    if (!status.installed) throw new Error(`未检测到 Claude CLI（${status.command}）。请先安装并确保它在 PATH 中。`);
    if (!status.connected) throw new Error(`Claude CLI 已安装但没有可用登录连接: ${status.auth?.error || "请运行 claude auth login"}`);
    if (this.config.autoStartService && this.config.serviceCommand) await this.startService();
    return status;
  }

  async probe() {
    const status = await this.detect();
    if (!status.installed || !status.connected) return { ...status, probe: { ok: false, error: "Claude CLI 未安装或未登录" } };
    try {
      const resolved = await resolveClaudeEnvironment(this.config);
      const child = spawn(this.config.claudeCommand, ["-p", "Reply with exactly OK", "--output-format", "json", "--tools", "", "--max-budget-usd", "0.02", "--no-session-persistence"], { cwd: this.config.cwd, env: resolved.environment, stdio: ["ignore", "pipe", "pipe"] });
      let stdout = "", stderr = "";
      child.stdout.on("data", (chunk) => { stdout += chunk; }); child.stderr.on("data", (chunk) => { stderr += chunk; });
      const code = await new Promise((resolve, reject) => { const timer = setTimeout(() => { child.kill("SIGTERM"); reject(new Error("Claude 探测超时")); }, 60000); child.on("error", reject); child.on("close", (value) => { clearTimeout(timer); resolve(value ?? 1); }); });
      let payload;
      try { payload = JSON.parse(stdout); } catch { payload = { is_error: code !== 0, result: stdout.trim() || stderr.trim() }; }
      const ok = payload.is_error !== true && /OK/i.test(payload.result || "");
      return { ...status, connected: ok, probe: { ok, result: payload.result || null, apiErrorStatus: payload.api_error_status || null, error: ok ? null : (payload.result || stderr.trim() || `Claude exited ${code}`).slice(0, 2000) } };
    } catch (error) {
      return { ...status, connected: false, probe: { ok: false, error: `${error.stderr || error.message}`.trim().slice(0, 2000) } };
    }
  }

  async startService() {
    if (!Array.isArray(this.config.serviceCommand) || !this.config.serviceCommand.length) return { started: false, reason: "未配置 serviceCommand" };
    if (this.serviceStarted) return { started: false, reason: "服务已由当前编排器拉起" };
    const [command, ...args] = this.config.serviceCommand;
    const resolved = await resolveClaudeEnvironment(this.config);
    const child = spawn(command, args, { cwd: this.config.cwd, env: resolved.environment, detached: true, stdio: "ignore" });
    child.unref();
    this.serviceStarted = true;
    await this.store.event("claude.service.started", { command, args });
    return { started: true, command, args };
  }

  async createWorktree(node) {
    const root = path.resolve(this.config.cwd, this.config.worktreeRoot);
    const safe = `${node.id}-a${node.attempts || 1}`.replace(/[^a-zA-Z0-9_-]/g, "-");
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

  buildArgs(prompt, node) {
    const args = this.config.claudeArgs.map((arg) => arg === "{prompt}" ? prompt : String(arg).replaceAll("{prompt}", prompt));
    if (node.tools?.length) args.push("--allowedTools", node.tools.join(","));
    if (node.model) args.push("--model", node.model);
    return args;
  }

  async runNode(node, task, extraPrompt = null) {
    if (!this.config.autoStartClaude) throw new Error("autoStartClaude=false，自动拉起 Claude 节点已禁用");
    const status = await this.ensureAvailable();
    const work = await this.createWorktree(node);
    const logDir = path.resolve(this.config.cwd, ".codex-claude/logs");
    await fs.mkdir(logDir, { recursive: true });
    const logFile = path.join(logDir, `${node.id}.log`);
    const prompt = [
      `你是 Claude 执行 Agent。任务目标：${task.goal}`,
      `节点目标：${node.goal}`,
      `职责角色：${node.role}`,
      `Codex 分配理由：${node.assignment?.rationale || "未提供"}`,
      `本节点约束：${node.constraints?.length ? node.constraints.join("；") : "无额外约束"}`,
      `节点结构化输入：${JSON.stringify(node.input)}`,
      `可用工具策略：${node.tools.length ? node.tools.join(", ") : "使用 Claude 默认工具策略"}`,
      `允许修改的文件范围：${node.files.length ? node.files.join(", ") : "由你判断，但必须在完成事件中列出变更"}`,
      extraPrompt ? `Codex 补充指令：${extraPrompt}` : null,
      "请在当前 worktree 完成实现，运行相关验证。不要修改任务范围外的文件。完成后输出简洁总结和测试结果。"
      ,"不要执行 git merge、rebase 或 push；编排器会在验证通过后创建节点提交并由 Codex 合并。"
    ].filter(Boolean).join("\n");
    const args = this.buildArgs(prompt, node);
    const resolved = await resolveClaudeEnvironment(this.config);
    const child = spawn(this.config.claudeCommand, args, { cwd: work.worktree, env: resolved.environment, stdio: ["ignore", "pipe", "pipe"] });
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
    const claudeError = findClaudeProcessError(output);
    return { ...work, ...result, code: claudeError ? 1 : result.code, claudeError, output: output.slice(-12000), logFile };
  }

  stopNode(nodeId) {
    const child = this.processes.get(nodeId);
    if (!child) return false;
    child.kill("SIGTERM");
    return true;
  }
}
