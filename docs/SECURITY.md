# Security model

Claude CLI inherits the local user's permissions and the configured workspace. The orchestrator reduces accidental conflicts but is not a security sandbox.

- Commands are spawned without a shell; model text is passed as one argument.
- Validation commands come only from the user's local configuration and therefore are trusted local code.
- Worktrees isolate filesystem edits, while explicit file allowlists detect out-of-scope changes.
- Merge is a separate destructive tool and requires `review` state.
- Logs and state may contain prompts, filenames, and tool output; they remain under `.codex-claude/` and are gitignored.
- No telemetry or remote service is included. Network access is determined by Codex and Claude CLI configuration.

Report vulnerabilities privately to the repository owner before public disclosure.

