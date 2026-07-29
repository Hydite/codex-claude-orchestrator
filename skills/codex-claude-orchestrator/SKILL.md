---
name: codex-claude-orchestrator
description: Run Codex, native Codex subagents, and Claude CLI as a dynamic software team with optional constraint intake, parallel responsibilities, contract alignment, checkpoints, handoffs, regression gates, and reviewed integration.
---

# Codex × Claude Hybrid Native Team

Use the bundled MCP tools whenever the user asks Codex and Claude to
collaborate, parallelize implementation, form a development team, hand work
between agents, or display the team control plane.

The MCP server is the durable task graph, not the team lead. The current Codex
client is the technical lead, scheduler, developer, and final integrator. It
uses native Codex subagents when useful and Claude CLI for bounded worktree
execution. Do not reduce this workflow to “dispatch Claude and watch it.”

## Mandatory startup

1. Call `orchestrator_set_workspace` with the absolute repository root.
2. Call `claude_status`. Report an unavailable Claude runtime precisely, but
   continue useful Codex planning when possible.
3. Call `orchestrator_get_state` and `orchestrator_get_next_actions` so active
   reservations, pending handoffs, and resumable tasks are preserved.
4. Resume relevant active work before creating a duplicate task.

## Pre-development constraint intake

Before any implementation node starts, establish constraints for the task.

- If the user already supplied clear constraints, record them directly.
- If constraints are material but missing, ask one compact client-side question
  that lets the user add shared, Codex, Claude, or contract-alignment
  constraints, or explicitly skip. Use the host's native user-input surface
  when available.
- If the user explicitly says to skip questions or proceed with defaults,
  record `skip=true` without interrupting again.
- Create pending tasks when the control plane must collect the answer later.
  The server intentionally blocks dispatch while constraint status is pending.

Call `orchestrator_set_constraints` with the answer or explicit skip. Do not
hide unasked constraints inside a prompt after development has started.

## Dynamic team planning

Inspect the goal, repository, risk, tool availability, dependencies, and file
boundaries before allocating work. Codex decides assignments; never hard-code
“Claude does backend” or “Codex does frontend.” Record the evidence in each
node's assignment rationale and capabilities.

For a non-trivial multi-component development task that can be split safely:

- give both Codex and Claude real, outcome-bearing responsibilities;
- keep architecture, security-sensitive integration, cross-cutting ownership,
  and final review with Codex unless evidence supports a narrower delegation;
- assign bounded modules, tests, implementation, or research to Claude when its
  worktree can have an explicit file scope;
- decide whether Codex should implement its node in the main thread or spawn a
  native Codex subagent;
- add an alignment node when two workers share an API, schema, event protocol,
  data model, UI contract, or acceptance fixture. The alignment node owns a
  concrete contract artifact and becomes a dependency where required.

Each node needs a measurable goal, agent, execution mode, role, narrow file
scope, constraints, assignment rationale, acceptance criteria in structured
input, and dependencies. Do not create ceremonial nodes merely to claim that
both agents participated.

Use:

- `codex-lead` when the current Codex should implement directly;
- `codex-subagent` when an independent native Codex thread reduces context
  pollution or can work safely in parallel;
- `claude-cli` for an isolated Claude worktree;
- `alignment` for an explicit contract steward, backed by either Codex or
  Claude according to the task.

## Start real parallel work

Create the task and nodes, then start every dependency-ready, non-overlapping
node without waiting for another independent node to finish.

For Claude, call `orchestrator_dispatch_node`. It returns immediately. After it
returns, do not enter a supervision-only polling loop. Start the Codex-owned
node and continue implementation.

For Codex-owned work:

1. choose main-thread or native-subagent execution;
2. if using a native subagent, spawn it with the exact goal, file scope,
   constraints, dependencies, and required completion summary;
3. call `orchestrator_start_codex_node`, including the native thread identity
   when the host exposes one;
4. implement directly or let the native subagent run while the lead continues
   other non-overlapping work.

The server reserves declared file scopes across Codex and Claude nodes. Never
edit a scope reserved by another active or review node.

## Team loop and checkpoints

The orchestration loop lives in this client skill. Do not emulate it with a
single long-running MCP request.

At meaningful milestones, after dependency changes, and when a node's
`nextCheckAt` is due:

1. collect concise progress from native subagents or the current Codex work;
2. call `orchestrator_checkpoint_node` with phase, summary, touched files,
   blockers, and the next check interval;
3. call `orchestrator_get_next_actions`;
4. execute the highest-priority safe actions while continuing independent
   implementation.

Avoid rapid polling. A useful checkpoint represents a phase transition,
contract change, new blocker, test result, scope change, or scheduled heartbeat.
The main thread should stay productive between checkpoints.

## Handoff and reassignment

Request a handoff when continuing with the current assignee is less safe or
less effective than reassignment. The client may derive additional evidence,
but common triggers include:

- a worker reports or actually touches files outside its reservation;
- a required tool, platform, credential, runtime, or domain capability is not
  available to that worker;
- the same validation failure persists after a focused correction;
- a dependency or shared contract changes enough to invalidate the plan;
- integration becomes architecture- or security-sensitive;
- execution times out, crashes, or cannot authenticate;
- a new file-scope conflict appears;
- workload is badly imbalanced while another agent can take a clean boundary;
- the user changes priority or explicitly requests a different assignee.

Call `orchestrator_request_handoff` with concrete evidence and a recommended
agent. For an out-of-scope file reported through a checkpoint, the server
requests a boundary handoff automatically.

Resolve it with `orchestrator_reassign_node`:

- use `restart` only when the old attempt is clean or when explicitly
  discarding its isolated worktree is correct;
- use `successor` when the old attempt must remain available for inspection or
  review. The successor receives lineage, prior progress, evidence, and the
  original constraints.

Never silently copy, merge, or accept changes during handoff. Useful prior work
must pass its own scope and regression review. Unsafe work is discarded through
an explicit destructive action.

## Completion and integration

When Codex work finishes, call `orchestrator_finish_codex_node` with the real
files and checks. This can only produce `review`, `failed`, or `blocked`.
Approve it separately with `orchestrator_review_codex_node` after inspection.

Claude process success is never acceptance. A Claude node must pass scope,
overlap, base-change, and configured regression checks, enter `review`, receive
a Codex diff review, and pass validation again immediately before
`orchestrator_merge_node`.

After any base-branch or shared-contract change, revalidate affected review
nodes. Finish only when `orchestrator_get_next_actions` reports task completion
and the repository's required tests pass from the integrated branch.

## React control plane

Use `orchestrator_open_dashboard` only when the user asks to open or operate the
visual control plane. Data and mutation tools intentionally do not attach a UI,
which prevents a new inline panel from appearing for every lifecycle event.

The React MCP App displays constraint intake, Codex/alignment/Claude lanes,
assignment rationale, reservations, checkpoints, handoffs, next actions,
review gates, and merge controls. The MCP state remains authoritative; the UI
is not a second scheduler. All headless clients must still be able to complete
the workflow through tools and this skill.
