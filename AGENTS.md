# Repository agent rules

These rules apply to every automated agent working in this repository.

## Required workflow

1. Work on `dev` or an isolated feature branch; never push directly to `main`.
2. Read `docs/ARCHITECTURE.md`, `docs/DEVELOPMENT.md`, and `docs/SECURITY.md` before changing orchestration behavior.
3. Declare the files you intend to change. Do not edit a file reserved by another active node.
4. Preserve Codex as coordinator/integrator and Claude as a bounded worktree executor.
5. Do not bypass worktree isolation, validation, review state, or explicit merge gates.
6. Run `npm run check`, `npm test`, and `git diff --check` before handing off.

## Invariants

- Runtime code under `src/` must use Node.js built-ins only; third-party packages may be development dependencies but cannot be required to start the MCP server.
- Model-provided input must never be interpolated into a shell command.
- State writes go only through `StateStore` and must remain serialized.
- Process success alone never marks work accepted.
- A Claude node cannot merge while the Codex worktree is dirty or when file scope, base overlap, or regression checks fail.
- MCP tool annotations and schemas must match their real side effects.
- Every new lifecycle transition emits a structured event and has test coverage.
- Personal marketplace updates must preserve unrelated entries and use atomic writes.
- Generated marketplace trees must use `.agents/plugins/marketplace.json` and `plugins/<name>/`; never edit the generated `marketplace` branch directly.
