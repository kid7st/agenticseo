# AgenticSEO development guidance

This repository is an early, independent, agent-first adaptation of OpenSEO's SEO capabilities. Read [docs/PRODUCT.md](docs/PRODUCT.md) for the full capability target and [docs/DESIGN.md](docs/DESIGN.md) for the local-first boundary. The existing CLI and keyword skill are only the first vertical slice.

- Keep SEO operations usable without a required server or MCP connection. Do not import Cloudflare Worker, hosted billing, or Web UI dependencies into the local CLI.
- Validate external provider data before using it. Missing metrics remain unknown, not zero. Report provider errors and costs when known; do not require product-level approval or budgets.
- Keep agent-facing results concise with provenance and a path to detailed local evidence. Never store credentials in project files or Git.
- Preserve OpenSEO's copyright and license notices in any source ported from it. Do not claim this project is an official OpenSEO release.
- Before opening a PR, run `npm run check`. Keep tests fixture-backed; live paid calls are optional manual checks. Follow [CONTRIBUTING.md](CONTRIBUTING.md) for the PR workflow. Do not push directly to protected `main`.
