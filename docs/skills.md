# Skills

AgenticSEO's skills are written instructions that teach your agent a complete SEO workflow: what to ask you, which commands to run, how to read the results, and how to write them up. They are adapted from [OpenSEO's skills](https://github.com/every-app/open-seo/tree/main/plugins/openseo/skills) and follow the [Agent Skills](https://agentskills.io) format, plain Markdown any compatible agent can read.

## Install

The skills are included in the AgenticSEO package, so they always match the installed CLI. Add them with the [skills](https://github.com/vercel-labs/skills) installer, which asks which agents to add them to:

```sh
npx skills add "$(npm root -g)/agenticseo" -g
```

`-g` installs them for your user; leave it out to add them to the current project only. `-a pi -a claude-code -y` picks agents without prompting. The installer copies the skills, so run it again after updating the CLI.

Without the installer, link the skills into your agent's skills folder. Links follow CLI updates automatically:

```sh
mkdir -p ~/.agents/skills
ln -s "$(npm root -g)"/agenticseo/.agents/skills/* ~/.agents/skills/
```

`~/.agents/skills` works for Pi and most Agent Skills clients; Claude Code reads `~/.claude/skills`.

So far AgenticSEO has only been tested with Pi. Please [report](https://github.com/kid7st/agenticseo/issues) how it works with other agents.

## Using them

Describe what you want in your own words. The agent picks the matching skill. In Pi you can also name one directly, for example `/skill:seo-audit`.

Run your agent in your website's folder. The first time, it sets up the project with `seo-project-setup`: your business, goals, competitors and key pages go into `.agenticseo/context.json`. Every later skill reads that file, so you are not asked the same questions twice. Skills also keep a research log there, and reuse research from the last 30 days instead of paying for it again.

## The workflows

| Skill | Use it when you want to… | Cost in our tests |
| --- | --- | --- |
| `seo-coach` | Get oriented: where your site stands, what to do next, SEO concepts explained | Free |
| `seo-project-setup` | Record your business, goals, competitors and key pages, and connect Google | Free |
| `seo-audit` | Find the few changes most likely to grow organic traffic that converts | $0.17 (the crawl is free) |
| `keyword-research` | Find keywords worth targeting from seed topics | under $0.30 |
| `keyword-clustering` | Group keywords by intent and map them to existing or new pages | $0.05 |
| `competitor-analysis` | Study one competitor: keywords, content, backlinks, gaps | $0.20 |
| `competitive-landscape` | See who wins a search market and where the openings are | $0.65 |
| `local-seo` | Check your Google Business Profile and Maps visibility against local competitors | $0.13 |
| `link-prospecting` | Find sites that might link to a page, and draft outreach | $0.19 |
| `seo-report` | Used by the other skills to write reports; you do not run it on its own | Free |

Costs are what DataForSEO charged in one test run each; yours depend on how much the agent looks up. You can give a budget in your request ("keep it under $0.50"), and the skills report what they spent.

## Reports

Each workflow ends by saving a report in `.agenticseo/reports/`:

- a Markdown file (`<name>.md`) that you and your agent can read and edit;
- an HTML page (`<name>.html`) with the same content, built from one template, that opens offline and prints cleanly.

Reports open with the conclusion, give the evidence behind each recommendation, and end with how the report was made: which data was used, when, and what it cost. `agenticseo reports` lists them.

To give reports your own structure, for example a monthly client check-in, save a template in `.agenticseo/templates/<name>.md` describing the audience, sections and tone, and ask for a report "using the <name> template".
