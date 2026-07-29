# Architecture

## Product boundary

Codex is technical lead, developer, reviewer, and final integrator. It may implement in the main thread or delegate to native Codex subagents. Claude CLI is an isolated execution runtime for bounded nodes. The MCP server stores authoritative team state but never pretends it can spawn a native Codex subagent; the client skill owns that behavior.

## Components

1. **Codex native plugin manifest** discovers the skill and local MCP server.
2. **Client skill** performs constraint intake, capability-based assignment, native subagent delegation, periodic team-loop decisions, handoffs, and reviewed integration.
3. **MCP server** exposes recoverable state transitions for constraints, assignment, Codex start/finish/review, Claude dispatch, checkpoints, handoffs, validation, and merge.
4. **Orchestrator core** owns task goals, agents, dependencies, reservations, lifecycle rules, next-action derivation, lineage, and event persistence.
5. **Claude runtime** resolves the effective Gateway environment, detects the CLI, optionally starts a configured service, creates a branch/worktree, streams process output, and records completion.
6. **Regression gate** executes configured validation commands, compares changed files with the node allowlist, and checks overlap with active/review nodes.
7. **React MCP App** renders a Devin-style status board, constraint intake, team operations, handoffs, and review queues. It calls the same tools and is never the scheduler.
8. **Distribution layer** builds dependency-free plugin bundles for the personal marketplace, Hydite Git marketplace, and OpenAI curated submission layout.

## State and data flow

State is scoped to the active workspace and persisted in `.codex-claude/state.json`. A serialized mutation queue prevents concurrent stdout/stderr events from losing updates. The store retains the latest 500 events.

Team execution follows this sequence:

1. collect or explicitly skip shared and per-agent constraints;
2. let Codex assess capabilities and create non-overlapping nodes, adding alignment dependencies where contracts cross boundaries;
3. reserve scopes and start every dependency-ready Codex and Claude node without waiting for independent work;
4. run Claude in isolated worktrees while Codex works directly or through native subagents;
5. record milestone checkpoints and derive overdue checks, handoffs, reviews, and dispatchable work through `get_next_actions`;
6. stop and hand off boundary or capability failures with evidence and lineage;
7. require separate completion and review transitions for Codex work;
8. run regression, scope, overlap, and base checks for isolated work;
9. require explicit Codex review and merge.

## Host UI compatibility

The React dashboard is built into a self-contained MCP Apps resource using `text/html;profile=mcp-app`. Only `orchestrator_open_dashboard` attaches `_meta.ui.resourceUri`; data and mutation calls stay headless so repeated lifecycle operations do not create duplicate inline panels. Host placement remains controlled by the Codex client.

## Distribution boundary

Source, tests, and release automation live in the development repository. Installers copy only the manifest, MCP definition, runtime source, skills, assets, user documentation, configuration example, and license. The installable runtime therefore has no third-party package requirement. Personal marketplace writes are atomic and preserve unrelated entries. Git marketplace releases are generated into the standard `.agents/plugins/marketplace.json` plus `plugins/<name>/` layout.
