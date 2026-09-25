# AgenticSEO

SEO research and site audits for your coding agent. AgenticSEO gives an agent such as Pi or Claude Code a command-line toolkit and ten ready-made SEO workflows. Ask your agent to audit your site, find keywords worth targeting, study a competitor or check your Google Maps visibility. It gathers the data, explains what matters, and saves a report in your project.

It runs on your machine. There is no account to create and no server to keep running. You pay the data providers directly, per lookup, and everything the agent finds stays in your website's folder.

AgenticSEO is based on [OpenSEO](https://github.com/every-app/open-seo) and brings its SEO features to local commands and agent skills. It is an independent project, not an official OpenSEO release.

## What you can do

| Ask your agent to… | What it uses |
| --- | --- |
| Audit my site and tell me what to fix first | A local crawler (free), optional Lighthouse checks, live rankings |
| Find keywords worth targeting for these topics | Keyword research, search volume, difficulty, intent and live Google results |
| Group my keywords and map them to pages | Search Console queries, SERP overlap, your key pages |
| Analyze a competitor, or who wins in my market | Ranked keywords, top pages, backlinks, SERP competitors, AI answer mentions |
| Check how I show up on Google Maps | Business profiles, reviews, local results and a rank grid around your location |
| Find sites that might link to my guide | SERPs and competitors' backlinks, plus your agent's web search for contacts |
| Track my rankings every week | Rank trackers, run on demand or by your system scheduler |
| Show what already ranks and what visitors do | Your own Google Search Console and Google Analytics data (free) |

Each workflow ends with a report: a Markdown file your agent can read later and an HTML page you can open, share or print.

## Install

Requires [Node.js](https://nodejs.org) 24.14 or newer.

```sh
npm install -g https://github.com/kid7st/agenticseo/releases/latest/download/agenticseo.tgz
```

Run the same command again to update.

Then give your agent the skills. They are included in the package:

```sh
mkdir -p ~/.agents/skills
ln -s "$(npm root -g)"/agenticseo/.agents/skills/* ~/.agents/skills/
```

`~/.agents/skills` works for Pi and other [Agent Skills](https://agentskills.io) clients. For Claude Code, link them into `~/.claude/skills` instead. So far AgenticSEO has only been tested with Pi. See [skills](docs/skills.md) for what each skill does.

## Accounts you need

| Service | Needed for | Cost |
| --- | --- | --- |
| [DataForSEO](https://dataforseo.com) | Keywords, SERPs, competitors, backlinks, local SEO, AI visibility, rank tracking, Lighthouse | Pay per lookup, usually $0.001–$0.08; an AI brand lookup is about $0.60–$0.85 |
| Google Search Console and Analytics | Your site's own clicks, queries and visitor behavior | Free; needs a one-time [Google setup](docs/google.md) |
| [Ahrefs](https://ahrefs.com) (optional) | Ahrefs Domain Rating | Free API key |

Site audits run on your machine and cost nothing. To give an idea of scale, one complete workflow, such as clustering a site's keywords or mapping a competitive landscape, cost between $0.05 and $0.65 in our tests. Every paid result reports what it cost.

Set your DataForSEO credentials in your shell. The key is your DataForSEO `login:password` encoded in base64:

```sh
export DATAFORSEO_API_KEY="$(printf 'you@example.com:your-api-password' | base64)"
```

Keys live in your environment and never go into project files.

## Get started

Open your agent in your website's folder and ask:

> Set up SEO for this site.

The `seo-project-setup` skill asks about your business, goals and competitors, and connects Google if you want. Not sure where to start? Ask for the `seo-coach` instead.

You can also run the commands yourself:

```sh
cd path/to/your-website
agenticseo init --domain example.com --location US
agenticseo keywords "seo audit" "seo audit tool"
agenticseo audit start --wait
agenticseo audit issues
agenticseo overview
```

Every command prints JSON. For example, `keywords` returns:

```json
{
  "provider": "DataForSEO",
  "market": { "locationCode": 2840, "languageCode": "en" },
  "rows": [
    { "keyword": "seo audit", "searchVolume": 4400, "cpc": 16.06, "keywordDifficulty": 77, "intent": "commercial" },
    { "keyword": "seo audit tool", "searchVolume": 2400, "cpc": 23.77, "keywordDifficulty": 77, "intent": "commercial" }
  ],
  "costUsd": 0.01224,
  "evidence": ".agenticseo/evidence/2026-09-25T03-30-58.479Z-….json"
}
```

A metric the provider does not have is `null`, never 0. The [command reference](docs/commands.md) covers every command and option.

## Where your data lives

AgenticSEO keeps everything for a site in a `.agenticseo/` folder inside it:

| Path | What it holds | In Git? |
| --- | --- | --- |
| `project.json` | Domain, market, and which Search Console and Analytics property to use | Your choice |
| `context.json` | What your agent knows about the business: goals, positioning, competitors, key pages and a research log | Your choice |
| `reports/` | Finished reports (Markdown and HTML) | Your choice |
| `exports/` | CSV and JSON exports | Your choice |
| `evidence/` | The raw provider response behind every paid result | Ignored |
| `data/` | A SQLite database of saved keywords, audits and ranking history | Ignored |
| `cache/` | Cached lookups, so repeating a question is free | Ignored |

Google access tokens are stored per user in `~/.config/agenticseo/`, never in a project. Behind a proxy, set `HTTPS_PROXY` as you would for curl; every request uses it.

## Documentation

- [Skills](docs/skills.md): the ten workflows and when to use each
- [Command reference](docs/commands.md): every command, option and exit code
- [Google Search Console and Analytics setup](docs/google.md)
- [Contributing](CONTRIBUTING.md), [design](docs/DESIGN.md), [OpenSEO parity](docs/openseo-parity.md) and [security](SECURITY.md)

## License

MIT. AgenticSEO includes source adapted from OpenSEO (MIT, Copyright (c) 2026 Ben Senescu). Each adapted file names its origin, and OpenSEO's notice is kept in [LICENSES/OpenSEO.txt](LICENSES/OpenSEO.txt). AgenticSEO is not affiliated with OpenSEO's maintainers.
