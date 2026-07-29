# Contributing

Start from the `dev` branch and keep each change focused. Open a pull request with the problem, design choice, user-visible behavior, security impact, and validation evidence.

Required local checks:

```bash
npm ci
npm run check
npm test
git diff --check
```

Changes affecting node dispatch, Git operations, command execution, MCP schemas, or merge behavior require a regression test. Dashboard changes require a refreshed `assets/dashboard-preview.png` and visual inspection.

The full engineering contract is in `docs/DEVELOPMENT.md`; security expectations are in `docs/SECURITY.md`.

