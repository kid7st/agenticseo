# Contributing

The [design](docs/DESIGN.md) explains how AgenticSEO is built and why; the [OpenSEO parity](docs/openseo-parity.md) page lists every capability with its upstream source and local differences. Please check existing issues before starting a large change.

## Development

Use Node.js 24.14 or newer. Clone the repository and run:

```sh
npm ci
npm run check
npm link    # optional: put your checkout's `agenticseo` on the PATH
```

`npm run check` builds the TypeScript CLI and runs fixture-backed tests. Tests must not depend on paid API calls, credentials, or a running OpenSEO service. For manual DataForSEO testing, set `DATAFORSEO_API_KEY` locally and never commit it, its decoded value, or customer research data.

Keep changes focused, add the smallest relevant regression check, and update [docs/commands.md](docs/commands.md) or the affected skill when a command's behavior changes. Preserve OpenSEO's copyright and license notices when porting its source. Write code, documentation, and PR descriptions in English.

`scripts/live-check.mjs` runs every command against real providers in a temporary project, reads back each mutation and checks each export. It spends about $1.20 and needs real accounts, so run it by hand before a release; its header lists the settings.

## Pull requests

`main` is the only long-lived branch. Make a branch (`feature/`, `fix/`, `docs/`, `chore/`, or `ci/`), run `npm run check` locally, then open a PR against `main`. Explain final behavior, the reason for it, and the verification performed. If a live provider call was not possible, state that plainly.

CI runs the same checks across supported Node versions, installs a packed CLI, and runs CodeQL. A green PR is ready for maintainer review; it is not permission to merge. Maintainers make the final merge decision. Security issues should be reported privately using [SECURITY.md](SECURITY.md), not filed as public issues.

## Releases

Set the new `version` in `package.json` through a PR, then push a matching tag (`v0.2.0`) on `main`. The release workflow runs the checks, packs the CLI and publishes a GitHub release with `agenticseo-<version>.tgz` and `agenticseo.tgz`; the second name is what the install command's `releases/latest` link resolves. The package is not published to the npm registry.
