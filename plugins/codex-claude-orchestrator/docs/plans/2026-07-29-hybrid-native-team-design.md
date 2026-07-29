# Hybrid native team orchestration

## Outcome

The plugin turns a Codex task into a dynamic software team rather than a
Claude supervision queue. Codex remains technical lead and final integrator,
but it also owns implementation work directly or through native Codex
subagents. Claude CLI owns bounded work selected for its capabilities. Codex
may add an alignment node when two implementation nodes share a contract.

## Product layers

The plugin skill owns client behavior: optional constraint intake, capability
assessment, team planning, native subagent delegation, periodic checkpoints,
handoff decisions, review, and final integration. The MCP server never tries to
spawn a Codex subagent. It stores authoritative state and exposes small,
recoverable lifecycle operations. Claude remains an isolated worktree executor.

The React MCP App is a control plane over the same tools. It does not become a
second scheduler. Headless Codex clients can run the complete workflow using
the skill and tools alone.

## Constraint intake

Before development, Codex asks whether the user wants to add shared, Codex,
Claude, or alignment constraints. The user can answer, provide constraints in
the original request, or explicitly skip. The resulting status is `ready` or
`skipped`; dispatch is blocked while it is `pending`. Constraints are copied
into every assignment so later handoffs retain the original intent.

## Team lifecycle

Codex creates nodes with measurable goals, file scopes, dependencies,
assignment rationale, execution mode, and acceptance criteria. A task may have:

- a Codex lead implementation node;
- one or more native Codex subagent nodes;
- one or more Claude CLI nodes;
- a Codex or Claude alignment node that owns API or contract artifacts.

Independent nodes start without waiting for each other. Alignment nodes become
dependencies only when their output is required. The client records a
checkpoint at meaningful milestones and consults deterministic next actions
instead of continuously polling.

## Handoff and recovery

Boundary violations, unavailable capabilities, repeated validation failures,
dependency or contract changes, security-sensitive integration, timeouts,
workload imbalance, and user direction can request a handoff. The request
records evidence, current progress, touched files, and a recommended assignee.
Reassignment archives the previous attempt and preserves lineage. Worktree
changes are never silently transferred or merged: useful changes must pass
scope and regression review; unsafe or out-of-scope attempts are discarded.

The next-action query identifies dispatchable nodes, overdue checkpoints,
pending handoffs, reviews, blockers, and task completion. This is the stable
primitive used by the client-side team loop.

## React control plane

React and its bundler are development dependencies. The build emits a single
self-contained MCP App HTML resource so the installed server still starts with
Node.js built-ins only. The UI provides constraint intake, topology lanes,
assignment rationale, progress and heartbeat views, handoff/reassignment
controls, validation, and merge actions. All mutations call MCP tools and the
server remains the source of truth.

## Verification

Tests cover state transitions, constraint gates, reservations, checkpoints,
handoff lineage, next-action derivation, MCP schemas, React model helpers,
generated UI, fake Claude execution, marketplace packaging, and credential
redaction. Final dogfooding uses a new Codex task with a small full-stack fixture
to prove concurrent Codex and Claude work, contract alignment, checkpointing,
review, and integration.
