# SEO Audit — Sep 26, 2026

Verdict: fastagent.sh has no technical blocker, but it does not reach page 1 of Google for its own name. In a live US check, "fastagent" (about 260 searches a month) showed fastagent.sh at #13 (page 2), behind three unrelated projects with the same name: the Python fast-agent (fast-agent.ai and its GitHub repo), HKUDS/FastAgent and fastagent.co.uk. A re-check three minutes later gave the same #13. For "fast agent" (also about 260) it was not in the first 27 organic results. The site has 2 referring domains in DataForSEO's index, which likely explains much of the gap. First action: connect Google Search Console (free), then change the homepage title and description to say "TypeScript" and earn a few developer links, starting with the site's own tutorials. Expected benefit is modest: brand demand is about 260 a month and most of it probably wants the Python project, so a page-1 spot is worth tens of visits a month (hypothetical), not hundreds. Non-brand head terms ("slack ai agent" 320, "telegram ai bot" 390, "bedrock agentcore" 2,400) are held by Slack, AWS and consumer chatbots; the realistic non-brand target is the small developer long tail (10 to 50 searches a month per query). Evidence: crawl 795dd6ff-7fb9-4116-9ded-40763b60a0b0 (81 URLs, no errors), DataForSEO SERP, keyword and backlink lookups on Sep 25, 2026 20:10 to 20:13 UTC, US English, total about $0.19.

## Your next SEO move

- Verify fastagent.sh in Google Search Console, then run `agenticseo gsc use`. Free; it shows real brand clicks and indexing.
- Change the homepage title and description to say "TypeScript" so brand searchers can tell FastAgent apart.
- Earn a handful of developer links: cross-post the tutorials, add fastagent.sh to relevant awesome-lists and directories.
- Already working: clean crawl, self-canonicals (each page names itself as the preferred URL), structured data, long practical docs.

## Recommendations

### 1. Get fastagent.sh onto page 1 for its own name

**Do this**

- Change the [homepage](https://fastagent.sh/) title to "FastAgent: serve a TypeScript AI agent on Slack, Telegram, GitHub".
- Rewrite the meta description (the snippet under the title in Google) to open with "Open-source TypeScript library and CLI". It is 172 characters now; keep it under 160.
- Earn links from developer sites: cross-post the 5 tutorials to dev.to or Hashnode with a canonical link back, submit to TypeScript and AI-agent awesome-lists, and post a Show HN.
- Add one line to [Overview](https://fastagent.sh/docs/overview/): "FastAgent (TypeScript) is unrelated to the Python fast-agent project."

**Why**

- fastagent.sh was #13 (page 2) for "fastagent"; four other projects use the name and fill page 1.
- Even "fastagent typescript" puts it at #13 (page 2); a separate fast-agent-typescript repo is #1.
- The domain has 2 referring domains (diedong.com, capuz.github.io), both first seen Aug to Sep 2026. Page-1 rivals are GitHub and Medium pages with far more links.
- Brand searchers already heard of the project, so they are the likeliest to install. Uncertainty: many "fastagent" searchers want the Python project, so the realistic gain is small.

| Query | Estimated monthly volume (US) | fastagent.sh position (US, Sep 25, 2026 UTC) |
|---|---|---|
| fastagent | 260 | #13 (page 2), same on re-check |
| fast agent | 260 | not in the first 27 organic results (DataForSEO ranked data: #28, date unknown) |
| fastagent typescript | unknown (no data) | #13 (page 2) |
| fastagent sh | unknown (no data) | #2 (page 1), behind HKUDS/FastAgent |

| Hypothetical scenario for "fastagent" (260/month) | Assumed click share | Visits/month |
|---|---|---|
| Page 2 (today) | about 1% | about 3 |
| Mid page 1 (#5 to #8) | about 5% | about 13 |

"fastagent" and "fast agent" are largely the same people; the figures are not added.

### 2. Retitle the channel and deploy docs for developer searches

**Do this**

- [Telegram channel](https://fastagent.sh/docs/telegram/) → "Build a Telegram AI agent in TypeScript | FastAgent".
- [Slack channel](https://fastagent.sh/docs/slack/) → "Build a Slack AI agent bot in TypeScript | FastAgent".
- [GitHub channel](https://fastagent.sh/docs/github/) → "AI code review agent for GitHub PRs | FastAgent"; link the [PR review tutorial](https://fastagent.sh/blog/self-hosted-github-pull-request-review-agent/) in the first paragraph.
- [Deploy](https://fastagent.sh/docs/deploy/) → "Deploy a TypeScript AI agent to Fly.io, Railway, Docker or AgentCore | FastAgent".

**Why**

- Current titles name the feature ("Telegram channel | FastAgent"), not the job a developer types.
- The pages already answer the job (Telegram 2,544 words, Slack 3,286, Deploy 3,474); only the label is missing.
- Each title also repeats "TypeScript", which supports recommendation 1.
- Benefit is small: target queries get 10 to 50 searches a month each. Head terms are held by Slack, AWS and consumer bots.

| Page | Developer query (estimated monthly volume, US) | Head term it does not realistically win (volume, who holds page 1) |
|---|---|---|
| /docs/telegram/ | telegram ai agent (50), telegram bot typescript (10) | telegram ai bot (390; consumer bots such as @GPT4Telegrambot) |
| /docs/slack/ | claude code slack bot (40), slack bot typescript (10) | slack ai agent (320; slack.com, docs.slack.dev) |
| /docs/github/ | ai code review github (50), open source ai code review (20) | ai pr review (110; mixed tools and blogs) |
| /docs/deploy/ | agentcore typescript (20), bedrock agentcore typescript (10) | bedrock agentcore (2,400; aws.amazon.com) |

## What else we checked

| Opportunity | What we found | Decision |
|---|---|---|
| Runner-up: AgentCore TypeScript guide | "agentcore runtime" 880/month, but page 1 for "agentcore typescript" (20/month) is AWS docs, AWS SDK repos and Strands. Brand wins because searchers already want FastAgent. | Revisit once the site has more links. |
| "pr agent" (880/month) | Brand name of Qodo's PR-Agent; not FastAgent's searchers. | Skip. |
| Markdown copies (`/…/index.md`, 34 URLs) | 200, `text/markdown`, no canonical header. No evidence Google indexes them. | Add HTTP `Link: <html-url>; rel="canonical"` to each .md. |
| http:// to https:// | `http://fastagent.sh/` returns 200 instead of a 301 (permanent redirect); canonical points to https. | Turn on Cloudflare "Always Use HTTPS". |
| "FastAgent vs fast-agent" page | Would repeat the other project's name. | Skip; the Overview line covers it. |
| Crawl maintenance | 14 thin tag pages, Feishu reuses the homepage description, 24 descriptions and 5 titles outside length guides; no broken links. | Fix while editing; noindex one-post tags. |

## How this report was made

Generated by the [AgenticSEO SEO Audit skill](https://github.com/kid7st/agenticseo/blob/main/.agents/skills/seo-audit/SKILL.md), run by Claude Code on September 26, 2026.

Coverage and limits: DataForSEO data for the US, English. Search Console and Analytics are not connected, so real clicks, indexing and conversions are unknown. One SERP snapshot per query is not a baseline.

- Crawl: `agenticseo audit start --max-pages 200`, audit `795dd6ff-7fb9-4116-9ded-40763b60a0b0`, completed Sep 25, 2026 20:11 UTC. 81 URLs (47 sitemap HTML pages, 34 markdown, llms.txt and RSS files). 45 issues: 16 warnings (14 thin content, 2 duplicate descriptions), 29 info. Same result as the earlier crawl edcf796e-1f32-47b3-900c-20d59a897faf.
- Verified by hand (curl, Sep 26, 2026): homepage title, description and canonical; `http://` returns 200; `www` 301s to the apex; `index.md` has no canonical header; robots.txt allows all and lists the sitemap. Earlier the same day: status, canonical, robots meta and H1 for all 47 sitemap URLs.
- Pages read: homepage, blog index, docs Telegram, GitHub, Slack, Deploy, Feishu, and the PR review tutorial.
- Live SERP checks (DataForSEO Google organic, US, English, Sep 25, 2026 UTC). Positions count organic listings only:

| Query | Volume | fastagent.sh | Organic listings returned | Time (UTC) |
|---|---|---|---|---|
| fastagent | 260 | #13 (page 2) | 16 | 20:10 |
| fastagent (re-check, depth 30) | 260 | #13 (page 2), also #23 | 26 | 20:13 |
| fast agent (depth 30) | 260 | not in the first 27 organic results | 27 | 20:13 |
| fastagent typescript | unknown | #13 (page 2) | 18 | 20:11 (first try at 20:10 failed with a provider error) |
| fastagent sh | unknown | #2 (page 1), also #15 | 19 | 20:11 |
| slack ai agent | 320 | not in the first 20 results | 16 | 20:10 |
| telegram ai bot | 390 | not in the first 20 results | 17 | 20:10 |
| ai pr review | 110 | not in the first 20 results | 15 | 20:10 |
| bedrock agentcore | 2,400 | not in the first 20 results | 18 | 20:10 |
| self hosted github pr review agent | unknown | not in the first 20 results | 17 | 20:11 |
| agentcore typescript | 20 | not in the first 20 results | 19 | 20:12 |
| open source ai code review | 20 | not in the first 20 results | 16 | 20:12 |

- Keyword volumes (DataForSEO Labs, US, English, Sep 25, 2026): 31 terms; no data for "fastagent typescript", "deploy ai agent", "self hosted ai code review", "deploy agent to agentcore", "github app typescript", "self hosted code review".
- Ranked keywords (DataForSEO, fastagent.sh): 2 rows, "fast agent" #28 and "fast agents" #103, both the homepage; observation date not given.
- Backlinks (DataForSEO, Sep 25, 2026): 4 backlinks from 2 referring domains, diedong.com (first seen Aug 26, 2026) and capuz.github.io (Sep 21, 2026).
- Scenario math: 260 × 1% ≈ 3; 260 × 5% ≈ 13. Click shares are assumptions, not measurements.
- Earlier the same day (free sources): Google autocomplete for "fastagent" suggested the Python project; GitHub API showed evalstate/fast-agent 3,919 stars (created Jan 2025) against 63 for fastagent-sh/fastagent (created Jun 2026).
- Evidence files: `.agenticseo/evidence/2026-09-25T20-10-29.966Z-…`, `20-10-45.123Z-…`, `20-10-52.380Z-…`, `20-10-59.929Z-…`, `20-11-28.174Z-…`, `20-11-31.830Z-…`, `20-11-45.644Z-…`, `20-12-32.343Z-…`, `20-12-33.840Z-…`, `20-13-06.042Z-…`. Total cost about $0.19.
