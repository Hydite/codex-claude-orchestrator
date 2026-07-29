# Development standard

## Branching and scope

- `dev` is the integration branch during development; release branches/tags are cut from reviewed `dev` commits.
- Claude changes must use `codex-claude/<node-id>` branches and isolated worktrees.
- A node must declare its file scope. Overlapping scopes run sequentially.
- Do not edit generated state, logs, worktrees, lock files, or `node_modules` into source control.

## Code rules

- Node.js 20+ and ESM only.
- MCP tool inputs must use explicit JSON Schema. Mutating tools must have accurate annotations.
- Never build a shell command from model-provided input. Claude is invoked with `spawn(command, args)`.
- Never log, persist, or return Claude Gateway credential values. Environment-source changes require redaction and precedence tests.
- The client skill owns native Codex subagent delegation and the team loop; the MCP server must expose recoverable atomic transitions rather than a long-running scheduler.
- Every assignment must record agent, execution mode, rationale, capability evidence, constraints, dependencies, and file scope. Every handoff must preserve evidence and lineage.
- The React control plane is built from development-only dependencies into a self-contained `src/ui/widget.html`; the distributed MCP runtime must not require React or a bundler to start.
- Persist mutations through `StateStore.update`; do not write the state file from other modules.
- Every lifecycle transition must emit a structured event.
- A successful process exit is not acceptance. Scope, overlap, regression, and human/Codex review are all required.

## Adding tools

Each tool must have one intent, a behavior-oriented description, a bounded schema, correct read/destructive/idempotent hints, orchestration tests, and documentation. New UI-producing tools must attach the versioned dashboard resource URI.

## Tests and gates

Before commit:

```bash
npm run check
npm test
```

Changes to MCP wiring require a stdio handshake smoke test. Changes to the dashboard require a rendered screenshot or browser inspection. Changes to Claude invocation require tests with a fake executable before being used against a real account.

## Release discipline

Keep `.codex-plugin/plugin.json` and `package.json` versions identical. Use semantic versioning, document breaking configuration changes, validate the plugin scaffold, and install into a new Codex task when testing updated plugin tools.

Before a release, build both distribution channels and validate the generated marketplace with Codex CLI:

```bash
npm run build:marketplace
npm run build:official
```

Never hand-edit generated `dist/` files or the `marketplace` branch. Change source files or distribution scripts, run the tests, and regenerate.
