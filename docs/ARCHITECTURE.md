# Architecture

## Product boundary

Codex is the coordinator, reviewer, and final integrator. Claude CLI is an execution runtime for bounded nodes. The orchestrator does not let two agents directly share a mutable checkout.

## Components

1. **Codex native plugin manifest** discovers the skill and local MCP server.
2. **MCP server** exposes status, workspace binding, task graph, node dispatch, validation, progress, stop, and merge tools.
3. **Orchestrator core** owns task goals, agents, dependencies, file reservations, lifecycle rules, and event persistence.
4. **Claude runtime** detects the CLI, optionally starts a configured service, creates a branch/worktree, streams process output, and records completion.
5. **Regression gate** executes configured validation commands, compares changed files with the node allowlist, and checks overlap with active/review nodes.
6. **MCP App dashboard** polls the authoritative state and renders tasks, nodes, events, availability, failures, and review queues.

## State and data flow

State is scoped to the active workspace and persisted in `.codex-claude/state.json`. A serialized mutation queue prevents concurrent stdout/stderr events from losing updates. The store retains the latest 500 events.

Dispatch follows this sequence:

1. verify node dependencies and concurrency limit;
2. reserve its file allowlist;
3. detect Claude CLI and optionally launch the configured service command;
4. create a branch and isolated Git worktree at the current commit;
5. spawn Claude with a goal, structured node input, constraints, and file scope;
6. stream events and logs;
7. run regression, scope, and overlap checks;
8. place the node in `review` only when the process and checks pass;
9. require an explicit Codex merge call.

## Host UI compatibility

The dashboard is registered as an MCP Apps resource using `text/html;profile=mcp-app` and attached to state/render tools through `_meta.ui.resourceUri`. Codex clients that support MCP App rendering can show it in the interactive visualization surface. The same tool surface remains usable without the widget.

