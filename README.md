# AgenticSEO

Open-source, local-first SEO for agents. AgenticSEO aims to bring OpenSEO's SEO capabilities to a portable core, local commands, and agent skills, without requiring an OpenSEO account, MCP server, browser UI, or always-on application server. Pi is the first development client, not the only intended user.

**Status:** early prototype. Project setup, project context, local reports, keyword metrics, keyword research and live SERPs are implemented; the full [OpenSEO capability inventory](docs/PRODUCT.md) remains the goal.

- [Product and capability inventory](docs/PRODUCT.md)
- [Technical design](docs/DESIGN.md)
- [Execution plan and acceptance criteria](docs/PLAN.md)
- [Contributing](CONTRIBUTING.md) · [Security reporting](SECURITY.md)

## Try the first local workflow

Requires Node.js 24+, a DataForSEO account, and a base64-encoded DataForSEO `login:password` in `DATAFORSEO_API_KEY`. DataForSEO charges for live lookups. No OpenSEO server or account is needed.

```sh
npm install
npm run build
npm link
cd /path/to/your-website
agenticseo init --domain example.com --location 2840 --language en
agenticseo context
agenticseo research "seo audit"
agenticseo keywords "seo audit" "seo audit tool"
agenticseo serp "seo audit"
agenticseo reports
```

`2840/en` is the US/English market; use your own DataForSEO location and language codes. Commands find the project from the current directory or an ancestor; pass `--project DIR` to use another root.

- `init` creates `.agenticseo/project.json` with the bare domain (`www`, scheme and path removed) and the market.
- `context` validates and prints `.agenticseo/context.json`, the project's shared memory in OpenSEO's vocabulary: `sections` (`business_overview`, `current_goal`, `positioning`, `writing_preferences`), `customSections`, `competitors`, `keyPages` and a `researchLog` of dated findings, plus report templates. People and agents edit that file directly. A missing file is an empty context; an invalid one fails with the exact field. Competitor domains and page URLs are shown in canonical form, the log shows the newest 20 entries from the last 90 days, and `today` (local date) is given for new entries; a later date is rejected.
- `reports` indexes `.agenticseo/reports/*.md`. A report's first line is its `# Title` and the text before its first section is its summary; an optional self-contained `.html` file with the same name is its HTML export. Templates live in `.agenticseo/templates/*.md` in the same shape.
- `research "SEED" [--limit 150|300|500] [--clickstream]` runs OpenSEO's keyword research for one seed: DataForSEO Labs related keywords, falling back to suggestions and then ideas until at least five non-seed keywords are found, or Google Ads keyword ideas where Labs does not cover the market. It returns the first 25 rows; a repeat within 24 hours comes from `.agenticseo/cache/` at no cost (`cached: true`).
- `keywords TERM... [--clickstream]` returns volume, CPC, competition, keyword difficulty and intent for up to 700 terms, from Labs keyword overview or, outside Labs markets, Google Ads search volume. Terms with no metric at all are listed in `missingKeywords`.
- `serp "QUERY" [--depth 10-100]` returns live Google results of every type (default depth 20), trimmed to type, rank, title, URL, domain and description.

Paid commands report `source` (which DataForSEO API answered), date, market and `costUsd`, and save an evidence file under `.agenticseo/evidence/` with all rows, monthly trends and the raw provider items of each call. Evidence and cache are ignored by Git; context and reports are meant to be versioned with the site. Missing metrics stay `null`, never 0. Google Ads markets have no keyword difficulty or intent. `--clickstream` asks Labs for clickstream-refined volume at twice the cost and is refused for Google Ads markets. If the key is missing, a paid command fails without a lookup.

Every command prints one JSON document on stdout when it succeeds. Failures print a message on stderr and exit with a code an agent can branch on:

| Exit | Meaning |
| --- | --- |
| 0 | Success |
| 1 | Unexpected failure (a bug); stderr has the stack |
| 2 | Invalid input: arguments, missing project, or an invalid `.agenticseo` file |
| 3 | Missing or rejected credentials |
| 4 | Provider failure: network, HTTP error, provider status or unexpected payload; charged failures include the cost |

The [project setup skill](.agents/skills/seo-project-setup/SKILL.md) interviews the user and fills the project context. The [report skill](.agents/skills/seo-report/SKILL.md) saves a finding as a report. The [keyword research skill](.agents/skills/keyword-research/SKILL.md), adapted from OpenSEO's, turns seeds into a prioritized opportunity set. Run Pi in this repository to discover the skills, or install it into your own agent using its skill manager. Run `npm run check` for the fixture-backed tests. No live DataForSEO call is part of the test suite.

A local invocation may still call paid external services, including DataForSEO. Google Search Console and Analytics require authorization. Remote execution is optional for long or unattended jobs, not a prerequisite for normal CLI use.

## Origin and license

AgenticSEO is an independent project based on the product and source design of [OpenSEO](https://github.com/every-app/open-seo). It is not an official OpenSEO release or affiliated with its maintainers. OpenSEO is MIT-licensed; source ported from OpenSEO lives in `src/openseo/`, names its upstream file and commit, and keeps OpenSEO's notice in [LICENSES/OpenSEO.txt](LICENSES/OpenSEO.txt). New code in this repository is licensed under [MIT](LICENSE). The names AgenticSEO and OpenSEO refer to separate projects.
