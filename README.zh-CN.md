# Codex × Claude Orchestrator

把 Codex 主线程、原生 Codex subagent 与 Claude CLI 组成一个可回归、可移交、可审查的并行开发团队。Codex 是总指挥，也是团队中的开发者：它根据能力、风险、依赖与文件边界动态分工，必要时创建契约对齐 Agent。

[English](README.md) · [日本語](README.ja.md) · [한국어](README.ko.md) · [发布版本](https://github.com/Hydite/codex-claude-orchestrator/releases)

## 索引

- [概览](#概览)
- [最新控制面](#最新控制面)
- [核心能力](#核心能力)
- [安装](#安装)
- [典型流程](#典型流程)
- [Gateway 配置](#gateway-配置)
- [开发与文档](#开发与文档)
- [许可证](#许可证)

## 概览

插件将 Codex、Codex 原生 subagent、Claude CLI 和契约对齐节点放入同一任务图。各节点拥有独立 worktree、文件预约、约束、检查点和回归门禁；Claude 在隔离 worktree 后台执行，Codex 可以继续自己的节点，不会退化为监督等待。

## 最新控制面

React MCP 控制面通过 Board 和 List 两种视图展示实时团队状态，提供 Running、Blocked、Ready 分栏、搜索与 Agent 筛选、Gateway 连接状态、任务与约束设置、检查点进度、越界移交、重新分配、验证、审查和合并操作。

![完整 Board 看板](./docs/images/dashboard-board.jpg)

### 视图与状态

![List 视图](./docs/images/dashboard-list.jpg)

![Running 状态](./docs/images/dashboard-running.jpg)

![Blocked 状态](./docs/images/dashboard-blocked.jpg)

![Ready 状态](./docs/images/dashboard-ready.jpg)

## 核心能力

- 开发前约束采集：共享、Codex、Claude、契约对齐约束可分别设置，也可以明确跳过。
- Codex 动态分工：记录分配理由、能力依据、执行模式、依赖、结构化输入和文件范围。
- 真正并行执行：Claude 节点后台运行，Codex 与 Codex subagent 同时推进各自职责。
- 契约对齐与实时回归：检查点、下一步动作、阻塞/审查队列和可配置回归命令。
- 安全移交：越界、能力缺口、验证失败、契约变更、安全升级、运行时故障、超时和负载平衡都可以触发 handoff/reassign。
- 集成门禁：节点独立分支/worktree，运行前文件占用检查，运行后越界与重叠检测；Codex 保持最终审查和合并权。
- React 控制面：Board/List、Running/Blocked/Ready、筛选、约束向导、检查点、移交、重分配和审查操作。

## 安装

要求 Node.js 20+、Git、已登录的 Claude CLI，以及支持本地 MCP 插件的 Codex 客户端。

```bash
npm run install:personal       # 个人市场
npm run install:marketplace    # Hydite Git 市场
```

OpenAI 官方市场提交包：

```bash
npm run build:official
```

完整的安装、更新、卸载和发布说明见 [`docs/INSTALLATION.md`](./docs/INSTALLATION.md)。安装或更新后请新建 Codex 任务，以加载最新技能和 MCP 工具。

## 典型流程

1. Codex 调用 `orchestrator_set_workspace` 绑定当前仓库。
2. Codex 调用 `claude_status` 检查 Claude CLI 和 Gateway。
3. Codex 询问开发约束，写入 `orchestrator_set_constraints`，或记录明确跳过。
4. Codex 按能力创建 Codex、subagent、Claude 和契约对齐节点。
5. Claude 通过 `orchestrator_dispatch_node` 后台开发，Codex 通过 `orchestrator_start_codex_node` 并行开发。
6. 团队在检查点调用 `orchestrator_checkpoint_node`，并用 `orchestrator_get_next_actions` 驱动循环。
7. 越界或能力不匹配时安全移交；通过独立验证、回归和显式合并门禁后集成。

## Gateway 配置

默认 `claudeEnvironmentSource: "auto"` 会读取 `~/.claude/settings.json` 中白名单 Gateway 环境变量。存在 `ANTHROPIC_BASE_URL` 和凭证时，检测、API 探测、服务启动和 Claude 节点统一走 Gateway。

```json
{
  "claudeEnvironmentSource": "settings",
  "claudeSettingsPath": "~/.claude/settings.json"
}
```

Token 只在内存中传给 Claude 子进程，不写入状态、事件或日志；`claude_status` 只返回脱敏后的来源和 Gateway Origin。

## 开发与文档

```bash
npm install
npm run build:ui
npm run setup
npm run check
npm test
```

- [架构](./docs/ARCHITECTURE.md)
- [开发规范](./docs/DEVELOPMENT.md)
- [安全策略](./docs/SECURITY.md)
- [安装与发布](./docs/INSTALLATION.md)
- [最新 Release](https://github.com/Hydite/codex-claude-orchestrator/releases/latest)

## 许可证

MIT
