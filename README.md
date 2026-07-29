# Codex × Claude Orchestrator

一个原生 Codex 插件，把 Codex 主线程、原生 Codex subagent 与 Claude CLI 组织成动态软件团队。Codex 既是技术负责人也是开发者：它根据能力、风险、依赖与文件边界决定分工，必要时创建契约对齐 Agent，并在越界或能力不匹配时安全移交任务。

![运行时面板](./assets/dashboard-preview.png)

## 当前能力

- 自动检测 Claude CLI 及版本；首次配置可自动生成项目配置。
- 可选拉起用户配置的 Claude 后台服务；默认直接按节点拉起 Claude CLI 进程。
- 开发前约束采集，可分别设置共享、Codex、Claude 与契约对齐约束，也可明确跳过。
- Codex 主线程、Codex 原生 subagent、Claude CLI 与契约对齐节点的统一任务图。
- 动态分配理由、能力依据、执行模式、依赖、结构化输入和文件范围建模。
- 节点级工具编排：可为 Claude 限制 `Read`、`Edit`、`Bash(...)` 等允许工具，并可指定模型。
- Claude 节点后台执行后调用立即返回；Codex 随即继续自己的开发节点，而非进入监督等待。
- 可恢复的团队循环：检查点、下次检查时间、确定性下一步动作、阻塞与审查队列。
- 越界自动移交，以及能力缺口、验证失败、契约变更、安全升级、运行时故障、超时和负载平衡等显式移交原因。
- 每个节点独立分支/worktree，运行前文件占用检查，运行后越界和重叠检测。
- 可配置回归命令，只有进程与回归同时通过才进入 Codex 审查队列。
- 显式合并工具；Codex 保持最终集成权。
- React MCP App 控制面，采用 Devin 风格的 Board/List、Running/Blocked/Ready 看板、筛选、约束向导、移交与审查操作。

## 要求

- Node.js 20+
- Git
- 已安装并登录的 Claude CLI：`claude --version`
- 支持本地 MCP 插件的 Codex 客户端

## 安装

个人市场安装：

```bash
npm run install:personal
```

Hydite Git 市场安装：

```bash
npm run install:marketplace
```

OpenAI 官方市场提交包：

```bash
npm run build:official
```

OpenAI 官方市场真正收录需要 OpenAI 审核；收录后可运行 `npm run install:official`。完整的安装、更新、卸载与发布说明见 [`docs/INSTALLATION.md`](./docs/INSTALLATION.md)。

## 本地开发

```bash
npm install
npm run build:ui
npm run setup
npm run check
npm test
```

插件由 `.codex-plugin/plugin.json`、技能目录与 `.mcp.json` 组成。安装或更新后请新建 Codex 任务，以加载最新技能和工具。

## 使用流程

1. Codex 调用 `orchestrator_set_workspace` 绑定当前 Git 仓库。
2. 调用 `claude_status` 自动检查连接。
3. 开发前由 Codex 询问约束；用户回答后调用 `orchestrator_set_constraints`，也可以明确跳过。
4. Codex 根据能力创建开发、subagent、Claude 和必要的契约对齐节点，并记录分配理由。
5. Claude 节点通过 `orchestrator_dispatch_node` 后台执行；Codex 节点通过 `orchestrator_start_codex_node` 开始并行开发。
6. 在里程碑调用 `orchestrator_checkpoint_node`，并用 `orchestrator_get_next_actions` 驱动客户端团队循环。
7. 越界或能力不匹配时调用 handoff/reassign 工具；成果分别经过独立审查和回归门禁。
8. 仅在用户要求可视化控制面时调用 `orchestrator_open_dashboard`，避免每个数据工具都产生消息流内嵌面板。

配置示例见 `.codex-claude.example.json`。架构和严格开发规范分别见 `docs/ARCHITECTURE.md` 与 `docs/DEVELOPMENT.md`。

## 配置 Claude 服务

Claude Code 通常按任务启动，不要求常驻服务。如果本机包装了长期运行服务，可以设置：

```json
{
  "autoStartService": true,
  "serviceCommand": ["claude-service", "start"]
}
```

编排器会在首次派发节点前启动它。命令来自本地配置，视为用户信任的本地代码。

## Claude Gateway

默认的 `claudeEnvironmentSource: "auto"` 会读取 `~/.claude/settings.json` 中经过白名单限制的 Gateway 环境变量。如果其中同时存在 `ANTHROPIC_BASE_URL` 和凭证，编排器会清除插件进程继承的竞争性 Anthropic 凭证，并让检测、API 探测、服务启动和所有 Claude 节点统一走 Gateway。

插件只在内存中向 Claude 子进程传递这些值，不会把 Token 写入项目状态、事件或日志。`claude_status` 会返回脱敏后的 `effectiveProvider`、配置来源、变量名和 Gateway Origin。

如需强制来源，可在 `.codex-claude.json` 中设置：

```json
{
  "claudeEnvironmentSource": "settings",
  "claudeSettingsPath": "~/.claude/settings.json"
}
```

设为 `process` 则只使用 Codex 插件进程继承的环境变量。

## License

MIT
