# Installation and distribution

The project supports three channels. Personal and Hydite Git marketplace installation are usable immediately. OpenAI official marketplace installation becomes active after the generated submission is reviewed and accepted by OpenAI.

## Requirements

- Codex CLI/Desktop with plugin support
- Node.js 20 or newer
- Git
- Claude CLI installed and authenticated

Check the local runtime first:

```bash
codex --version
claude --version
claude auth status --json
```

## Personal marketplace

The personal installer copies a minimal, dependency-free runtime bundle to `~/plugins/codex-claude-orchestrator`, creates or updates `~/.agents/plugins/marketplace.json`, preserves unrelated personal plugins and marketplace display metadata, and asks Codex to install the plugin from that marketplace.

```bash
npm run install:personal
npm run update:personal
npm run uninstall:personal
node scripts/install-personal.mjs status
```

Updates apply one Codex cachebuster suffix to the installed copy without changing the source manifest. Start a new Codex task after installing or updating so the new skill and MCP tools are loaded.

## Hydite Git marketplace

Releases publish a standard Codex marketplace tree to the repository's `marketplace` branch. The installer registers that Git source and installs the plugin:

```bash
npm run install:marketplace
npm run update:marketplace
npm run uninstall:marketplace
node scripts/install-marketplace.mjs status
```

Equivalent manual commands:

```bash
codex plugin marketplace add Hydite/codex-claude-orchestrator --ref marketplace
codex plugin add codex-claude-orchestrator@hydite-codex-plugins
```

## OpenAI official marketplace

Build a review-ready submission tree:

```bash
npm run build:official
```

The output under `dist/openai-submission` contains:

- `plugins/codex-claude-orchestrator/` — the isolated, dependency-free plugin bundle with the prebuilt React MCP App;
- `.agents/plugins/marketplace.json` — a standalone validation marketplace;
- `.agents/plugins/api_marketplace.json` — the API-key-login validation marketplace;
- `marketplace-entry.json` and `api-marketplace-entry.json` — entries for both official catalog variants;
- `SUBMISSION.md` — handoff notes.

The official OpenAI plugins repository uses `plugins/<name>/` and `.agents/plugins/marketplace.json`. Actual inclusion is controlled by OpenAI review; this repository cannot self-publish into that catalog. Once accepted, the following command discovers the official marketplace entry and installs it:

```bash
npm run install:official
```

Until acceptance, that command exits with a precise message and points users to the personal or Hydite marketplace channels.

## Release publishing

The `publish-marketplace` GitHub Actions workflow runs on version tags and manual dispatch. It validates the plugin, runs tests, uploads the official submission artifact, and atomically publishes the installable `marketplace` branch.

Recommended release sequence:

```bash
npm run check
npm test
npm run build:ui
npm run build:marketplace
npm run build:official
git tag v0.3.1
git push origin v0.3.1
```

## Security notes

Personal installation only deletes a plugin directory containing the installer's management marker. Marketplace JSON writes are atomic. Model-provided task input is never used to construct installation shell commands. The distributed MCP runtime uses Node.js built-ins and does not require `npm install` after Codex downloads it.
