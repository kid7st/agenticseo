---
name: competitive-landscape
description: Map SEO market leaders, winning content themes, keyword coverage, backlinks and strategic gaps across several competitors. Use when the user asks who is winning a search market or where the openings are.
---

<!-- Adapted from OpenSEO plugins/openseo/skills/competitive-landscape/SKILL.md (https://github.com/every-app/open-seo, MIT, Copyright (c) 2026 Ben Senescu) for the AgenticSEO CLI. -->

# Competitive landscape

## Goal

Answer: "Who is winning this SEO market, what content is working for them, and where are the openings?"

Use this when the user wants a market-level view across several competitors. For a deep dive on one domain, use `competitor-analysis`.

Use the installed `agenticseo` command. Research lookups are billed by DataForSEO and need `DATAFORSEO_API_KEY`; each result states its cost and points to an evidence file.

## Required inputs

- Topic, seed keywords, market/category or the user's domain
- Optional known competitors
- Optional location/language

## Project context

1. Run `agenticseo context` first and ground the market read in it: the saved competitors are the starting roster, and the business and positioning decide who counts as a competitor. If there is no project, set one up as `seo-project-setup` step 1 describes.
2. This skill needs competitors. If none are saved, run a minimal inline setup: ask the user who they compete with, or infer a shortlist from `agenticseo competitors` and the site and confirm it, write it to `competitors` in `.agenticseo/context.json`, then continue. Never front-load the full interview; suggest `seo-project-setup` at the end for the rest.
3. Before paying, check `researchLog`. If the same research ran within the last 30 days, reuse its evidence and say so instead of buying it again.
4. On finish, write back what is durable: every confirmed competitor in `competitors` with a short note on why it matters, and remove entries you added that turned out irrelevant (leave entries the user added alone). Append `{ "entryDate": "<today from agenticseo context>", "summary": "Competitive landscape: <market/query set>. Verdict: <conclusion>. Evidence: <paths>" }` to `researchLog`. Run `agenticseo context` to validate.

## Deliver as a report

Deliver through the `seo-report` skill. If that skill is not available, say so and stop before writing the report.

## Commands

- `agenticseo research "SEED"...`: discover representative market queries, up to 5 seeds per call.
- `agenticseo keywords TERM...`: validate a known query set with volume, difficulty, intent and trends.
- `agenticseo serp "QUERY"...`: live SERP composition and ranking URLs, up to 10 queries per call.
- `agenticseo competitors KEYWORD...`: the domains competing across a keyword set (up to 100 keywords); use this before counting SERPs by hand.
- `agenticseo domain DOMAIN`: size the organic footprint of candidate leaders.
- `agenticseo gsc performance`: when the user's own domain is in the comparison and Search Console is connected, anchor their position with first-party clicks, impressions and CTR rather than third-party estimates.
- `agenticseo ranked DOMAIN`: exact ranking keywords, URLs, ranks, intents and SERP result types for leaders.
- `agenticseo backlinks overview DOMAIN`: compare backlink and referring-domain strength where relevant.
- `agenticseo local businesses`, `agenticseo local serp` and `agenticseo local questions`: for local markets where proximity, Maps rankings, business categories, reviews or Google Q&A affect who is winning.
- `agenticseo ai brand DOMAIN --competitors A,B`: when the user asks who AI answers recommend, share of voice in ChatGPT and Google AI Overview. It is the most expensive lookup (about $0.84 with competitors); say so before running it.

## Workflow

1. Define the market query set:
   - Use the provided keywords, or run `agenticseo research` to build 5–10 representative queries.
   - Include mixed intent: informational, commercial, comparison and tool/software terms when applicable.
   - For local SEO, include neighborhood, city and service-area queries, and identify the priority locations or coordinates.
2. If the query set is already known, use `agenticseo keywords` to validate relative demand and difficulty, and `agenticseo competitors` to identify recurring domains at scale.
3. For local SEO, run `agenticseo local businesses` and `agenticseo local serp` for the highest-priority location(s) before naming winners. Use `agenticseo serp` as a complement for organic pages, not as the only local evidence.
4. Run `agenticseo serp` for representative queries when live SERP composition, ranking URLs or SERP features need inspection. Keep it to about 10 queries; each is billed.
5. Identify recurring domains and group them by type:
   - Direct product competitors
   - Publishers/media
   - Marketplaces/directories
   - Communities/forums
   - Documentation/resources
6. For the strongest recurring domains, run `agenticseo domain`; default to the top 3–5 domains before expanding.
7. For direct competitors and relevant publishers, run `agenticseo ranked`.
8. Use `agenticseo backlinks overview` when backlink authority appears important or the user asks why a domain is winning. Continue with SERP and domain evidence if it fails.
9. Synthesize patterns: content types, themes, SERP formats, local-pack signals, authority advantages and underserved angles.

## Output format

Title: `Competitive Landscape: <market or category> — <date>` (see `seo-report`).

If a report template applies (see `seo-report`), its sections and tone replace this list.

Sections in this order:

1. **The market read**: one or two opening sentences naming the leaders, the most winnable area and the biggest barrier.
2. **Who is winning**: a table of domain, type, organic footprint, winning themes and the gap. Label domain types explicitly.
3. **Why they win**: one finding per pattern, the change pointing at what the user should do instead.
4. **Gaps and openings**: a table of theme, demand and who currently owns it, plus a bar chart when a handful of themes carry the demand.
5. **What to do next**: an ordered list ending in the next workflow to run: `competitor-analysis`, `keyword-clustering` or a content brief.
6. **How this report was made**: opens with the skill link line from `seo-report`, pointing at `https://github.com/kid7st/agenticseo/blob/main/.agents/skills/competitive-landscape/SKILL.md` ("AgenticSEO Competitive Landscape skill"), then the query set used, the costs and evidence paths, and a note calling the read directional when the query set was small.

## Guardrails

- Distinguish SEO competitors from business competitors.
- Do not overstate exact traffic; provider traffic figures are estimates.
- If using a small query set, call the result directional.
- Do not assume a publisher is a product competitor; label domain types clearly.
- For local markets, distinguish organic-page winners from Maps/local-pack winners.
- Missing metrics are `unknown`, never 0. On exit code 3, ask the user to fix the key; on exit code 4, report the error and any charged cost, and do not retry in a loop.
