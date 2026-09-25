# AgenticSEO development guidance

This repository is an independent, agent-first adaptation of OpenSEO's SEO capabilities: a local CLI plus ten agent skills. Read [docs/DESIGN.md](docs/DESIGN.md) for the architecture and local-first boundary, and [docs/openseo-parity.md](docs/openseo-parity.md) for the capability inventory against upstream.

- Documentation is user-facing first. `README.md` stays short: what it does, install, accounts, getting started. Command details go in [docs/commands.md](docs/commands.md), Google setup in [docs/google.md](docs/google.md), skills in [docs/skills.md](docs/skills.md). Update the matching page when a command's behavior changes, and the parity row when upstream coverage changes.

- Keep SEO operations usable without a required server or MCP connection. Do not import Cloudflare Worker, hosted billing, or Web UI dependencies into the local CLI.
- Validate external provider data before using it. Missing metrics remain unknown, not zero. Report provider errors and costs when known; do not require product-level approval or budgets.
- Keep agent-facing results concise with provenance and a path to detailed local evidence. Never store credentials in project files or Git.
- Preserve OpenSEO's copyright and license notices in any source ported from it. Do not claim this project is an official OpenSEO release.
- Before opening a PR, run `npm run check`. Keep tests fixture-backed; live paid calls are optional manual checks. Follow [CONTRIBUTING.md](CONTRIBUTING.md) for the PR workflow. Do not push directly to protected `main`.
