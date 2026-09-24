---
name: local-seo
description: Audit a Google Business Profile, compare it to local competitors, and map Maps visibility around a location. Use when rankings depend on a physical location or service area.
---

<!-- Adapted from OpenSEO plugins/openseo/skills/local-seo/SKILL.md (https://github.com/every-app/open-seo, MIT, Copyright (c) 2026 Ben Senescu) for the AgenticSEO CLI. -->

# Local SEO

## Goal

Work out why a business does or does not show up in Google Maps and the local pack near its customers, and what to fix first.

Use this when rankings depend on a physical location or service area. For national organic work, use `competitor-analysis` or `keyword-research`.

Use the installed `agenticseo` command. Local lookups are billed by DataForSEO and need `DATAFORSEO_API_KEY`; each result states its cost and points to an evidence file. `agenticseo local categories` is free.

## Required inputs

- The business: its name, or a `cid`/`place_id` (most reliable)
- Its coordinate (latitude,longitude): derive it from an `agenticseo local businesses` or `agenticseo local serp` row; only ask the user when derivation is ambiguous
- One to three keywords customers actually search (for example "emergency plumber", not the brand name)

## Project context

1. Run `agenticseo context` first and ground the work in it: what the business does and where it operates decide which keywords and radius matter. If there is no project, set one up as `seo-project-setup` step 1 describes.
2. This skill needs `sections.business_overview`. If it is empty, run a minimal inline setup: infer what the business does and its location from the site and confirm it with the user in one question, write it to `.agenticseo/context.json`, then continue. Never front-load the full interview; suggest `seo-project-setup` at the end for the rest.
3. Before paying, check `researchLog`. If the same research ran within the last 30 days, reuse its evidence and say so instead of buying it again.
4. On finish, write back what is durable: local competitors that have a website in `competitors` (entries are keyed by domain, so skip listings without one) and a corrected `business_overview`. Append `{ "entryDate": "<today from agenticseo context>", "summary": "Local SEO: <business> near <area>. Verdict: <conclusion>. Evidence: <paths>" }` to `researchLog`. Run `agenticseo context` to validate.

## Deliver as a report

Deliver through the `seo-report` skill. If that skill is not available, say so and stop before writing the report.

## Commands

- `agenticseo local businesses --near LAT,LNG --radius KM [--query TEXT]`: nearby listings, filterable with `--min-rating`, `--min-reviews` and `--claimed`/`--unclaimed` (use `--unclaimed` to find unclaimed listings when prospecting). One call with the brand name as `--query` and a wide radius returns category, rating, review count, claimed status, coordinates and `cid` for every location of a chain, usually enough that per-location profile calls are unnecessary.
- `agenticseo local serp "QUERY" --near LAT,LNG`: the Maps (or `--type local_finder`) result set near a coordinate. The rows carry `cid` and `place_id`; collect them once and reuse them everywhere below.
- `agenticseo local profile --cid ID`: the full profile for one business (hours, rating breakdown) when the listing row is not enough.
- `agenticseo local reviews --cid ID`: reviews with ratings, text and whether the owner replied. Billed when the task is posted, collected for free: a `processing` result returns a `taskId`; run `agenticseo local reviews --task-id ID` after 30–60 seconds, at no extra cost.
- `agenticseo local grid "QUERY" --center LAT,LNG --cid ID`: the rank at every point of a grid around a coordinate, with each point's result count and #1 business. `--size 3` (the default) is nine searches; only use `--size 5` (25 searches) when the service area is genuinely wide.
- `agenticseo local questions --cid ID --near LAT,LNG --radius KM`: Q&A on the profile.
- `agenticseo local posts --cid ID`: posts published on the profile, with dates; queued like reviews.
- `agenticseo local categories [TEXT]`: valid category slugs for `--categories` in `local businesses`.

## Workflow

1. Find the business. Given only a name or website, `agenticseo local businesses --query NAME` centered on the business's city with a wide radius locates the listing and yields its `cid` and exact coordinate. If it returns several locations, the business is a chain; see multi-location below.
2. Run `agenticseo local serp` for the main keyword near the business coordinate. Record the top 3–5 competitors' `cid`/`place_id` and the user's own row.
3. Compare the user's listing against the top two competitors: primary category, additional categories, review count, hours completeness, photo count and claimed status. `local businesses` rows usually carry all of this; use `agenticseo local profile` for what they lack.
4. Sanity-check each listing's website link (`url` in the rows): it should deep-link to that location's page on the project domain, not a homepage or a stale domain. For broader on-page work, hand off to `agenticseo audit start` (see `seo-audit`).
5. Run `agenticseo local reviews` for the user and the strongest competitor. Look at review volume, recency, average rating and how many reviews got an owner reply.
6. Run `agenticseo local grid` for the main keyword. Use the grid to separate "ranks at the storefront only" from "ranks across the service area", and each point's top result to name who wins where the target does not.
7. Add `agenticseo local questions` and `agenticseo local posts` when the profile basics are already competitive and the gap is engagement rather than setup.
8. Turn the evidence into a prioritized list. Category and claim problems outrank posting cadence every time.

### Multi-location businesses

Always build the profile snapshot table for the whole chain; one `agenticseo local businesses` call covers it. The per-location deep-dives (reviews, grid, posts, Q&A) are where cost scales:

- 5 locations or fewer: deep-dive them all.
- More than 5: present the snapshot table, then ask the user which 1–3 locations to deep-dive. Recommend sensible defaults, for example the weakest profile in the densest market.

## Output format

Title: `Local SEO: <business name> — <date>` (see `seo-report`).

If a report template applies (see `seo-report`), its sections and tone replace this list.

Sections in this order:

1. **Snapshot**: one or two opening sentences, then a table of category, rating, review count and claimed status. One row per location for a chain.
2. **The one fix**: one finding. Category and claim problems outrank posting cadence every time.
3. **Head to head**: a table of signal, this business, the best competitor and the gap. Cover categories, reviews (count, recency, owner replies), hours and profile completeness, and the listing's website link.
4. **Maps coverage**: what the grid shows, where visibility drops off, and who wins there. A bar chart of ranks by direction reads faster than a paragraph; label every value.
5. **Q&A and posting**: only when the basics are already competitive.
6. **What to do next**: an ordered list.
7. **How this report was made**: opens with the skill link line from `seo-report`, pointing at `https://github.com/kid7st/agenticseo/blob/main/.agents/skills/local-seo/SKILL.md` ("AgenticSEO Local SEO skill"), then which commands returned what (with costs and evidence paths), plus a note reading each missing grid rank against that point's result count rather than calling it invisibility.

## Guardrails

- Do not run a 5×5 grid, or grids for several keywords, without telling the user the cost first: every point is a paid Maps search.
- Match businesses by `cid` or `place_id` when you have one. Name matching collides with chains and similarly named businesses.
- A missing rank at a grid point means the business was not among the results returned there. Read it with that point's result count: a full result set means outranked; a near-empty one means a sparse SERP, not proof of invisibility.
- Do not infer local-pack strength from national organic metrics.
- Never recommend review gating, fake reviews or keyword-stuffed business names.
- A grid centered on the wrong place is worse than no grid: confirm the coordinate matches the storefront before paying for the grid.
- On exit code 3, ask the user to fix the key; on exit code 4, report the error and any charged cost, and do not retry in a loop.
