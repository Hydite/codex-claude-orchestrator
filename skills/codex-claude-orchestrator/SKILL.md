---
name: codex-claude-orchestrator
description: Coordinate Codex and Claude CLI on software tasks using isolated Git worktrees, explicit task goals, node inputs, progress events, regression checks, and reviewed merges.
---

# Codex × Claude Orchestrator

Use the bundled MCP tools whenever the user asks Codex and Claude to collaborate, parallelize implementation, review each other's work, or display the orchestration dashboard.

## Mandatory startup

1. Call `orchestrator_set_workspace` with the absolute active repository root.
2. Call `claude_status`. If Claude is unavailable, report the exact detection error and continue with Codex-only work when useful.
3. Read `orchestrator_get_state` before creating or dispatching work so existing reservations and tasks are preserved.

## Responsibility allocation

Codex is always the coordinator and integrator. Keep architecture decisions, cross-cutting edits, security-sensitive changes, and final merge review with Codex. Delegate bounded implementation, tests, documentation, independent research, or isolated modules to Claude when their file scopes do not overlap active work.

Create one task goal and explicit nodes. Every node needs:

- a measurable goal;
- structured `input` with constraints and acceptance criteria;
- an `agent` (`codex` or `claude`);
- dependencies when ordering matters;
- the narrowest practical `files` allowlist.

Do not dispatch two nodes that can modify the same file. If boundaries are unclear, run them sequentially.

## Live synchronization and conflict prevention

Claude nodes run in isolated Git worktrees. While any node is running, call `orchestrator_get_state` at useful milestones and before changing the same subsystem. Record Codex-owned node progress with `orchestrator_record_codex_progress` so the dashboard remains authoritative.

Never merge a node merely because the Claude process exited successfully. A node must reach `review`, have passing scope/overlap/regression checks, and receive a Codex diff review. Use `orchestrator_validate_node` again after relevant base-branch changes. Use `orchestrator_merge_node` only after review.

If a node fails, inspect its `result`, `validation`, and recent `node.output` events. Refine the node input or create a corrective node rather than hiding the failure.

## Dashboard

Call `orchestrator_get_state` to render the bundled interactive MCP App. The view polls live state and shows task counts, node statuses, file scopes, recent events, Claude availability, failures, and review queues.

