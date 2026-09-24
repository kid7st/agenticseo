---
name: competitor-analysis
description: Analyze one competitor's organic footprint, ranking keywords, content themes, backlinks and gaps, and decide what to learn from, counter or outrank. Use when the user names a competitor to study.
---

<!-- Adapted from OpenSEO plugins/openseo/skills/competitor-analysis/SKILL.md (https://github.com/every-app/open-seo, MIT, Copyright (c) 2026 Ben Senescu) for the AgenticSEO CLI. -->

# Competitor analysis

## Goal

Analyze one competitor deeply enough to decide what to learn from, avoid, counter-position against or outrank.

Use this for a named competitor. To identify the market leaders first, use `competitive-landscape`.

Use the installed `agenticseo` command. Research lookups are billed by DataForSEO and need `DATAFORSEO_API_KEY`; each result states its cost and points to an evidence file.

## Required inputs

- The competitor domain
- The user's domain when a comparison is requested (the project domain by default)
- Optional topic, category, location or language

## Project context

1. Run `agenticseo context` first and ground the analysis in it: the saved competitors say whether this domain is already known and what was concluded about it before. If there is no project, set one up as `seo-project-setup` step 1 describes.
2. This skill needs competitors. If none are saved, run a minimal inline setup: add the competitor being analyzed to `competitors` in `.agenticseo/context.json`, and ask the user (or infer from `agenticseo competitors` and confirm) whether there are others. Then continue. Never front-load the full interview; suggest `seo-project-setup` at the end for the rest.
3. Before paying, check `researchLog`. If the same research ran within the last 30 days, reuse its evidence and say so instead of buying it again.
4. On finish, write back what is durable: upsert this domain in `competitors` with a short `notes` line on its strengths and where it is vulnerable, and append `{ "entryDate": "<today from agenticseo context>", "summary": "Competitor analysis: <domain>. Verdict: <conclusion>. Evidence: <paths>" }` to `researchLog`. Run `agenticseo context` to validate.

## Deliver as a report

Deliver through the `seo-report` skill. If that skill is not available, say so and stop before writing the report.

## Commands

- `agenticseo domain DOMAIN`: baseline organic traffic and keyword count.
- `agenticseo gsc performance`: when comparing to the user's own domain and Search Console is connected, the first-party baseline (real clicks, impressions, CTR, position) instead of estimating the user's own performance from third-party data. It exits 2 when not connected.
- `agenticseo ranked DOMAIN`: exact keyword, URL, rank, intent, traffic, CPC and SERP-type rows for the competitor domain or page. Use `--max-rank`, `--min-volume`, `--exclude BRAND,...` and `--types organic` to keep rows relevant; `--scope exact_url` with an absolute URL for one page.
- `agenticseo backlinks overview DOMAIN`: backlink and referring-domain profile.
- `agenticseo competitors KEYWORD...`: validate whether the named competitor is a real search competitor across the target keyword set.
- `agenticseo local businesses`, `agenticseo local serp` and `agenticseo local questions`: for local SEO competitors, when Maps or local-pack visibility, nearby businesses, categories or Google Q&A matter.
- `agenticseo serp "QUERY"`: validate head-to-head SERPs for important keywords, one query per call.
- `agenticseo research "SEED"`: expand gaps or category terms when needed.

## Workflow

1. Run `agenticseo domain` for the competitor, passing `--location`/`--language` when the user gave a market.
2. If comparing to the user, run `agenticseo domain` for the user's domain too, and if Search Console is connected, `agenticseo gsc report` or `agenticseo gsc performance` for the user's real baseline.
3. Run `agenticseo ranked` for the competitor, filtered to relevant rows.
4. If comparing to the user, run `agenticseo ranked` for the user's domain or page too, or `agenticseo serp` for the shared terms when a lighter check is enough.
5. For local SEO, run `agenticseo local businesses` and `agenticseo local serp` around the relevant business location(s) before drawing local-pack conclusions. Add `agenticseo local questions` only when Q&A evidence matters.
6. Run `agenticseo competitors` when the competitor was supplied by the user but its search overlap is unclear.
7. Group the competitor's keywords into themes:
   - Product/category terms
   - Alternatives/comparisons
   - Templates/tools/calculators
   - Educational guides
   - Branded demand
   - Local/neighborhood terms when relevant
8. Run `agenticseo backlinks overview` for the competitor, especially if authority appears to explain rankings. Continue without backlink evidence if it fails.
9. Use `agenticseo serp` for important shared or target keywords to compare positioning, with the market the user gave.
10. Produce an actionable plan:
    - What they are doing well
    - Where they are vulnerable
    - Which pages and keywords to pursue
    - What to avoid copying

## Output format

Title: `Competitor Analysis: <competitor domain> — <date>` (see `seo-report`).

If a report template applies (see `seo-report`), its sections and tone replace this list.

Sections in this order:

1. **Snapshot**: one or two opening sentences, then a table of the competitor's organic footprint (traffic estimate, keyword count, referring domains). Add the user's domain as a second row when comparing.
2. **The biggest lesson**: one finding.
3. **Where they are vulnerable**: one finding per opening, ordered by how winnable it is.
4. **Keyword themes**: a table of theme, example keywords, volume and whether the user competes there. A bar chart when a few themes dominate the footprint.
5. **Content patterns and authority**: prose, with a note for anything inferred from keyword rows rather than seen on a page.
6. **What to do next**: an ordered list, shortest useful.
7. **How this report was made**: opens with the skill link line from `seo-report`, pointing at `https://github.com/kid7st/agenticseo/blob/main/.agents/skills/competitor-analysis/SKILL.md` ("AgenticSEO Competitor Analysis skill"), then which commands reported what (with costs and evidence paths), and what you checked yourself.

## Guardrails

- Do not treat all competitor keywords as desirable. Filter for business fit.
- Separate evidence from inference.
- Do not infer competitor page or content-type patterns from keyword rows alone; use SERP or web evidence for page-level claims.
- For local SEO, do not infer Maps or local-pack strength from national organic domain metrics alone; use the local commands when the location is known or reasonably discoverable.
- Do not recommend copying content; recommend a stronger angle or a better answer to the same intent.
- If the user's domain is unavailable, frame the analysis as competitor-only.
- Missing metrics are `unknown`, never 0. On exit code 3, ask the user to fix the key; on exit code 4, report the error and any charged cost, and do not retry in a loop.
