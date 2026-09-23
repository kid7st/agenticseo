# Contributing

AgenticSEO is an early prototype. The [product scope](docs/PRODUCT.md) sets the long-term goal; the [execution plan](docs/PLAN.md) shows which capabilities are still missing. Please check existing issues before starting a large change.

## Development

Use Node.js 22.19 or newer. Clone the repository and run:

```sh
npm ci
npm run check
```

`npm run check` builds the TypeScript CLI and runs fixture-backed tests. Tests must not depend on paid API calls, credentials, or a running OpenSEO service. For manual DataForSEO testing, set `DATAFORSEO_API_KEY` locally and never commit it, its decoded value, or customer research data.

Keep changes focused, add the smallest relevant regression check, and update the README or agent skill when a command's behavior changes. Preserve OpenSEO's copyright and license notices when porting its source. Write code, documentation, and PR descriptions in English.

## Pull requests

`main` is the only long-lived branch. Make a branch (`feature/`, `fix/`, `docs/`, `chore/`, or `ci/`), run `npm run check` locally, then open a PR against `main`. Explain final behavior, the reason for it, and the verification performed. If a live provider call was not possible, state that plainly.

CI runs the same checks across supported Node versions, installs a packed CLI, and runs CodeQL. A green PR is ready for maintainer review; it is not permission to merge. Maintainers make the final merge decision. Security issues should be reported privately using [SECURITY.md](SECURITY.md), not filed as public issues.
