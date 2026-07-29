# Security model

Claude CLI inherits the local user's permissions and the configured workspace. The orchestrator reduces accidental conflicts but is not a security sandbox.

- Commands are spawned without a shell; model text is passed as one argument.
- Validation commands come only from the user's local configuration and therefore are trusted local code.
- Worktrees isolate filesystem edits, while explicit file allowlists detect out-of-scope changes.
- Merge is a separate destructive tool and requires `review` state.
- Logs and state may contain prompts, filenames, and tool output; they remain under `.codex-claude/` and are gitignored.
- No telemetry or remote service is included. Network access is determined by Codex and Claude CLI configuration.
- Gateway credentials are read from the configured Claude settings file only through an explicit allowlist and are passed directly to child processes in memory. Credential values are never returned by MCP tools, persisted in orchestration state, or written to logs.
- When a complete settings-based Gateway configuration is selected, competing inherited Anthropic credential variables are removed before the Claude process starts. Status output includes only the source, configured variable names, readiness flags, and sanitized URL origin.
- Handoff never silently copies or merges a worker's changes. Restart requires an explicit discard for an existing worktree; successor handoffs preserve lineage and require the previous attempt's independent scope and regression review.
- Codex and native subagent nodes share the Codex client workspace, so non-overlapping reservations are mandatory. Claude nodes remain in isolated Git worktrees. Scope evidence is recorded at every checkpoint and an out-of-scope report automatically requests handoff.

Report vulnerabilities privately to the repository owner before public disclosure.
