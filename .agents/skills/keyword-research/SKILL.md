---
name: keyword-research
description: Discover keyword opportunities for a website, evaluate their metrics and SERPs, and recommend what to target. Use when a user asks which search terms fit a product, page or topic, or wants keyword ideas with evidence.
---

<!-- Adapted from OpenSEO plugins/openseo/skills/keyword-research/SKILL.md (https://github.com/every-app/open-seo, MIT, Copyright (c) 2026 Ben Senescu) for the AgenticSEO CLI. -->

# Keyword research

## Goal

Turn seed topics into a prioritized keyword opportunity set. The output should help the user decide what to target and what to research next.

Use the installed `agenticseo` command. If it is not on PATH, tell the user how to install it from the AgenticSEO repository; do not invent metrics. Paid commands need `DATAFORSEO_API_KEY` (base64 of DataForSEO login:password).

## Project context

1. Run `agenticseo context` first and ground the research in it: the business, the goal, the market in `project.json`, and the competitors and key pages already recorded. If it exits with code 2 because no project exists, ask for the site and market and run `agenticseo init --domain DOMAIN --location COUNTRY` (a two-letter country code such as `US`, or a DataForSEO location code; add `--language` only when the user targets a non-default language). Never guess the market.
2. This skill needs `sections.business_overview` and `sections.current_goal`. If either is empty, ask the user (or infer from the site and confirm) just enough to fill them in `.agenticseo/context.json`, then continue. Suggest `seo-project-setup` at the end for the rest.
3. Before paying, check `researchLog`. If the same research ran within the last 30 days, reuse its evidence file and say so instead of buying it again.
4. On finish, write back what is durable: a sharpened `current_goal`, competitors that kept appearing in the SERPs in `competitors`, pages the keywords should land on in `keyPages` (`{ "url", "role"?: "hub" | "spoke" | "money" | "other", "topic"?, "notes"? }`), and one `researchLog` entry: `{ "entryDate": "<today from agenticseo context>", "summary": "Keyword research: <seeds>, <market>. Verdict: <conclusion>. Evidence: <paths>" }`. Run `agenticseo context` to validate.

## Commands

- `agenticseo research "SEED" [--limit 150|300|500]`: primary discovery. One seed per call; run a few distinct seeds rather than many near-duplicates. It returns the first 25 rows and saves all rows with monthly trends as evidence. A repeat within 24 hours is served from the project cache at no cost (`cached: true`).
- `agenticseo keywords TERM...`: volume, difficulty, intent, CPC and competition for up to 700 known terms in one call. Use it to score a fixed candidate list. Terms with no data are listed in `missingKeywords`.
- `agenticseo serp "QUERY" [--depth 10-100]`: live Google results for a query. Use it when intent is ambiguous or you need to see who ranks; keep checks few, since each is billed.
- Add `--clickstream` to `research` or `keywords` only when the user wants refined volumes; it doubles the cost.
- Add `--location COUNTRY [--language CODE]` to run one call in another country than the project's, for example to compare markets. Report which market each number comes from.

Every result states `source`, date, market and `costUsd`, and points to an `evidence` file; read rows from that file (for example with `jq`) instead of rerunning a paid command. When `source` is `google_ads`, the market is not covered by DataForSEO Labs, so difficulty and intent are unavailable.

- `agenticseo ranked TARGET [--scope ...] [--max-rank N] [--min-volume N] [--exclude BRAND,...]`: the keywords a domain or page already ranks for, when a target site or competitor is part of the brief. Use it for near-miss terms (for example `--max-rank 20` on the user's own site) and competitor-owned terms.
- `agenticseo competitors KEYWORD...`: which domains compete across the candidate terms' SERPs.

- `agenticseo saved list [--tags TAG,...]`: keywords the project already saved, with their latest metrics and tags. Check it first to avoid redoing work, and use existing tags as context.
- `agenticseo saved add KEYWORD... --tags TAG,...`: save chosen keywords only after the user explicitly confirms. Suggest short tags such as `topic:<topic>`, `intent:<intent>` or `page:<slug>`, and confirm new tag names. Researched keywords keep their metrics; `agenticseo saved refresh` re-fetches all saved keywords and is billed, so ask first.
- `agenticseo rank create`, then `agenticseo rank add TRACKER_ID KEYWORD...`: track the chosen keywords' Google positions for the project domain, when the user wants to follow them over time. Run `agenticseo rank estimate TRACKER_ID` and show the cost before `agenticseo rank run` or before setting `--schedule daily|weekly|monthly`. A schedule only runs once the user adds the line from `agenticseo rank schedule` to their system scheduler. Read results with `agenticseo rank show TRACKER_ID`.
- `agenticseo query "SELECT ..."`: read-only SQL over saved keywords and stored metrics when a question needs a join or aggregate, for example the highest-volume saved keywords per tag. Select only the columns and rows you need.

- `agenticseo gsc performance --dimensions query,page --min-position 5 --max-position 20 --min-impressions 50`: when Search Console is connected for the project, start from its real first-party demand: queries already earning impressions whose best page sits in "striking distance". Then run `agenticseo keywords` on those queries to attach difficulty and intent; that ranked list is the fastest opportunity set, so work it before broad discovery. Exit code 2 means it is not connected (skip it and say so); 3 means the Google grant needs reconnecting.

## Workflow

1. Normalize seeds into a small set of distinct research angles.
2. Run `agenticseo research` for each exploratory seed.
3. Run `agenticseo keywords` to hydrate a fixed list of candidates with volume, difficulty and intent before prioritizing.
4. Remove irrelevant, duplicate, branded-only and off-intent terms.
5. Prioritize by practical opportunity, not volume alone: fit with the product, page or topic; clear intent; reasonable difficulty; useful volume or CPC; a SERP the site can plausibly compete in.
6. Run `agenticseo serp` for high-potential or ambiguous keywords when the SERP would change the recommendation.
7. Present a shortlist and a longer opportunity table.
8. Ask before saving keywords. When the user agrees, save them with tags and say which tags you used.

## Output

Deliver through the `seo-report` skill. If a report template applies, its sections and tone replace this list. Otherwise, after the `# <site or topic> — <date>` title and the summary:

1. **The opportunity**: the best theme and why the site can win it now.
2. **Target these now**: a table of keyword, intent, volume, difficulty, CPC and the page to make.
3. **Why these**: one finding per keyword that needs justifying, with the SERP or metric evidence and the page to build.
4. **The longer opportunity list**: a second table with the same columns.
5. **Risks and caveats**: SERP intent that would change the recommendation, missing metrics written as `unknown`, close-variant volumes that are one bucket rather than several.
6. **What to do next**: an ordered list.
7. **How this report was made**: the commands run, the market, the dates, the costs and the evidence paths.

## Guardrails

- Do not invent metrics. If a value is missing, write `unknown`; never write 0 for it.
- Search volume is a provider estimate, not visits, and does not show Google rankings.
- Prefer business fit and intent fit over the largest volume term.
- On exit code 3, ask the user to fix the key. On exit code 4, report the error and any charged cost, and do not retry in a loop.
