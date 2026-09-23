# AgenticSEO

Open-source, local-first SEO for agents. AgenticSEO aims to bring OpenSEO's SEO capabilities to a portable core, local commands, and agent skills, without requiring an OpenSEO account, MCP server, browser UI, or always-on application server. Pi is the first development client, not the only intended user.

**Status:** early prototype. Only a local DataForSEO keyword-metrics snapshot is implemented; the full [OpenSEO capability inventory](docs/PRODUCT.md) remains the goal.

- [Product and capability inventory](docs/PRODUCT.md)
- [Technical design](docs/DESIGN.md)
- [Execution plan and acceptance criteria](docs/PLAN.md)
- [Contributing](CONTRIBUTING.md) · [Security reporting](SECURITY.md)

## Try the first local workflow

Requires Node.js 22+, a DataForSEO account, and a base64-encoded DataForSEO `login:password` in `DATAFORSEO_API_KEY`. DataForSEO charges for live lookups. No OpenSEO server or account is needed.

```sh
npm install
npm run build
npm link
cd /path/to/your-website
agenticseo init --domain example.com --location 2840 --language en
agenticseo keywords "seo audit" "seo tool"
```

`2840/en` is the US/English market; use your own DataForSEO location and language codes. `init` creates `.agenticseo/project.json` in the current directory. `keywords` finds the project from the current directory or an ancestor, returns a short JSON snapshot, and saves full evidence under `.agenticseo/evidence/` (ignored by Git there). Pass `--project DIR` to use a different root. This first slice uses DataForSEO Labs keyword overview, not SERP rankings or keyword discovery; it may be unavailable in markets served only by Google Ads. If the key is missing, the command fails without a lookup.

[Keyword snapshot skill](.agents/skills/keyword-snapshot/SKILL.md) guides a coding agent through using these results. Run Pi in this repository to discover the skill, or install it into your own agent using its skill manager. Run `npm run check` for the fixture-backed tests. No live DataForSEO call is part of the test suite.

A local invocation may still call paid external services, including DataForSEO. Google Search Console and Analytics require authorization. Remote execution is optional for long or unattended jobs, not a prerequisite for normal CLI use.

## Origin and license

AgenticSEO is an independent project based on the product and source design of [OpenSEO](https://github.com/every-app/open-seo). It is not an official OpenSEO release or affiliated with its maintainers. OpenSEO is MIT-licensed; source ported from OpenSEO must retain its original copyright and license notices. New code in this repository is licensed under [MIT](LICENSE). The names AgenticSEO and OpenSEO refer to separate projects.
