# Codex × Claude Orchestrator

Turn the Codex main thread, native Codex subagents, and Claude CLI into a parallel software team with regression gates, bounded worktrees, and safe handoffs. Codex acts as both commander and contributor: it assigns work from capability, risk, dependencies, and file boundaries, and creates a contract-alignment agent when needed.

[简体中文](README.zh-CN.md) · [日本語](README.ja.md) · [한국어](README.ko.md) · [Releases](https://github.com/Hydite/codex-claude-orchestrator/releases)

## Index

- [Overview](#overview)
- [Latest control plane](#latest-control-plane)
- [Capabilities](#capabilities)
- [Installation](#installation)
- [Typical workflow](#typical-workflow)
- [Gateway](#gateway)
- [Development and docs](#development-and-docs)
- [License](#license)

## Overview

The plugin puts Codex, native Codex subagents, Claude CLI, and contract-alignment nodes in one task graph. Every node has isolated worktrees, file reservations, constraints, checkpoints, and regression gates. Claude runs in the background in its own worktree while Codex continues its own node.

## Latest control plane

The React MCP App opens in Codex's right-side preview area. The current task starts directly at `Board / List`; the simulated `Agent / Editor` application chrome has been removed.

![Full Board](./docs/images/dashboard-board.jpg)

### Views and states

![List view](./docs/images/dashboard-list.jpg)

![Running state](./docs/images/dashboard-running.jpg)

![Blocked state](./docs/images/dashboard-blocked.jpg)

![Ready state](./docs/images/dashboard-ready.jpg)

## Capabilities

- Intake shared, Codex, Claude, and contract-alignment constraints before development, with an explicit skip option.
- Dynamic assignment with rationale, capability evidence, execution mode, dependencies, structured input, and file scope.
- True parallel execution: Claude works in the background while Codex and native subagents handle their own responsibilities.
- Checkpoints, next actions, blocked/review queues, and configurable regression commands.
- Safe handoffs for boundary violations, capability gaps, validation failures, contract changes, security escalation, runtime failures, timeouts, and workload balancing.
- Isolated branches/worktrees, pre-run reservations, post-run overlap checks, independent validation, and explicit merge gates.
- React controls for Board/List, Running/Blocked/Ready, filters, constraints, checkpoints, handoffs, reassignment, and review.

## Installation

Requirements: Node.js 20+, Git, an authenticated Claude CLI, and a Codex client with local MCP plugin support.

```bash
npm run install:personal       # Personal marketplace
npm run install:marketplace    # Hydite Git marketplace
```

Build the OpenAI marketplace submission artifact:

```bash
npm run build:official
```

See [`docs/INSTALLATION.md`](./docs/INSTALLATION.md) for update, uninstall, and release instructions. Start a new Codex task after installing or updating so the latest tools and skills are loaded.

## Typical workflow

1. Bind the repository with `orchestrator_set_workspace`.
2. Check Claude CLI and its Gateway with `claude_status`.
3. Ask for constraints and persist them with `orchestrator_set_constraints`, or record an explicit skip.
4. Create Codex, subagent, Claude, and contract-alignment nodes based on capability.
5. Dispatch Claude with `orchestrator_dispatch_node` and start Codex work with `orchestrator_start_codex_node`.
6. Record milestones with `orchestrator_checkpoint_node` and drive the loop with `orchestrator_get_next_actions`.
7. Handoff safely when boundaries or capabilities change; validate, regress, review, and merge explicitly.

## Gateway

`claudeEnvironmentSource: "auto"` reads allowlisted Gateway variables from `~/.claude/settings.json`. When `ANTHROPIC_BASE_URL` and credentials are present, detection, probing, service startup, and Claude nodes use the same Gateway.

```json
{
  "claudeEnvironmentSource": "settings",
  "claudeSettingsPath": "~/.claude/settings.json"
}
```

Tokens are passed to Claude children in memory only. State, events, and logs contain only redacted provider and Gateway-origin information.

## Development and docs

```bash
npm install
npm run build:ui
npm run setup
npm run check
npm test
```

- [Architecture](./docs/ARCHITECTURE.md)
- [Development rules](./docs/DEVELOPMENT.md)
- [Security](./docs/SECURITY.md)
- [Installation and releases](./docs/INSTALLATION.md)
- [Latest release](https://github.com/Hydite/codex-claude-orchestrator/releases/latest)

## License

MIT
