# Privacy policy

Codex × Claude Orchestrator runs locally and does not include analytics, telemetry, advertising, or a Hydite-operated data service.

The plugin stores task goals, node inputs, filenames, process output, validation results, and lifecycle events under `.codex-claude/` in the active workspace. These files are excluded from Git by the recommended configuration but remain accessible to the local user and any process with equivalent filesystem permissions.

When the plugin launches Claude CLI, prompts and any data accessed by Claude are handled according to the user's Anthropic account, Claude configuration, organization policy, and Anthropic terms. Codex and installed apps remain governed by the user's OpenAI account and workspace settings.

The plugin does not transmit data to Hydite. Users are responsible for reviewing local logs, repository permissions, configured validation commands, Claude tool permissions, and third-party service policies before use with sensitive information.

