# AgenticSEO

Open-source, local-first SEO for agents. AgenticSEO aims to bring OpenSEO's SEO capabilities to a portable core, local commands, and agent skills, without requiring an OpenSEO account, MCP server, browser UI, or always-on application server. Pi is the first development client, not the only intended user.

**Status:** early prototype. Project setup, project context, local reports and a DataForSEO keyword-metrics snapshot are implemented; the full [OpenSEO capability inventory](docs/PRODUCT.md) remains the goal.

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
agenticseo keywords "seo audit" "seo tool"
agenticseo reports
```

`2840/en` is the US/English market; use your own DataForSEO location and language codes. `init` creates `.agenticseo/project.json` in the current directory. `context` validates and prints `.agenticseo/context.json`, the project's shared memory: business overview, current goal, positioning, writing preferences, custom sections, competitors and key pages. People and agents edit that file directly; a missing file is an empty context, and an invalid one fails with the exact field. `reports` indexes `.agenticseo/reports/*.md` and `.agenticseo/templates/*.md`: a report's first line is its `# Title` and the text before its first section is its summary. An optional self-contained `.html` file with the same name is its HTML export. Reports and context are meant to be versioned with the site; evidence is not. `keywords` finds the project from the current directory or an ancestor, returns a short JSON snapshot, and saves full evidence under `.agenticseo/evidence/` (ignored by Git there). Pass `--project DIR` to use a different root. This first slice uses DataForSEO Labs keyword overview, not SERP rankings or keyword discovery; it may be unavailable in markets served only by Google Ads. If the key is missing, the command fails without a lookup.

Every command prints one JSON document on stdout when it succeeds. Failures print a message on stderr and exit with a code an agent can branch on:

| Exit | Meaning |
| --- | --- |
| 0 | Success |
| 1 | Unexpected failure (a bug); stderr has the stack |
| 2 | Invalid input: arguments, missing project, or an invalid `.agenticseo` file |
| 3 | Missing or rejected credentials |
| 4 | Provider failure: network, HTTP error, provider status or unexpected payload; charged failures include the cost |

The [project setup skill](.agents/skills/seo-project-setup/SKILL.md) interviews the user and fills the project context. The [report skill](.agents/skills/seo-report/SKILL.md) saves a finding as a report. The [keyword snapshot skill](.agents/skills/keyword-snapshot/SKILL.md) guides a coding agent through using these results. Run Pi in this repository to discover the skill, or install it into your own agent using its skill manager. Run `npm run check` for the fixture-backed tests. No live DataForSEO call is part of the test suite.

A local invocation may still call paid external services, including DataForSEO. Google Search Console and Analytics require authorization. Remote execution is optional for long or unattended jobs, not a prerequisite for normal CLI use.

## Origin and license

AgenticSEO is an independent project based on the product and source design of [OpenSEO](https://github.com/every-app/open-seo). It is not an official OpenSEO release or affiliated with its maintainers. OpenSEO is MIT-licensed; source ported from OpenSEO must retain its original copyright and license notices. New code in this repository is licensed under [MIT](LICENSE). The names AgenticSEO and OpenSEO refer to separate projects.
