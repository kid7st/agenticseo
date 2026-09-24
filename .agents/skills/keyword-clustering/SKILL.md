---
name: keyword-clustering
description: Cluster keywords by intent and map each cluster to an existing or proposed page, including cannibalization checks. Use when the user has a keyword list, saved keywords, Search Console queries or a domain to map to pages.
---

<!-- Adapted from OpenSEO plugins/openseo/skills/keyword-clustering/SKILL.md (https://github.com/every-app/open-seo, MIT, Copyright (c) 2026 Ben Senescu) for the AgenticSEO CLI. -->

# Keyword clustering

## Goal

Group keywords into page-level clusters and decide which existing or new page should target each cluster. This is a keyword mapping workflow, not just a semantic grouping exercise.

Use the installed `agenticseo` command. Search Console and saved keywords are free; research lookups are billed by DataForSEO and need `DATAFORSEO_API_KEY`.

## Required inputs

- A keyword list, saved keyword tag, seed topic or target domain
- Optional existing URLs/pages to map against

If keywords are not provided, use `agenticseo saved list` for saved sets, `agenticseo research` for seed discovery, or `agenticseo ranked` when the user starts from a target domain.

## Project context

1. Run `agenticseo context` first and ground the mapping in it: the saved `keyPages` are the existing pages clusters should map to, and the business and goal decide which clusters are worth targeting. If there is no project, set one up as `seo-project-setup` step 1 describes.
2. This skill needs key pages. If none are saved, run a minimal inline setup: ask the user for the pages that matter, or propose a shortlist from the site, an audit (`agenticseo audit pages`) or Search Console and confirm it, write it to `keyPages` in `.agenticseo/context.json` (`{ "url", "role"?: "hub" | "spoke" | "money" | "other", "topic"?, "notes"? }`), then continue. Never front-load the full interview; suggest `seo-project-setup` at the end for the rest.
3. Before paying, check `researchLog`. If the same research ran within the last 30 days, reuse its evidence and say so instead of buying it again.
4. On finish, write back what is durable: new or corrected `keyPages` entries with the topic each page now targets, and append `{ "entryDate": "<today from agenticseo context>", "summary": "Keyword clustering: <keyword set>. Verdict: <conclusion>. Evidence: <paths>" }` to `researchLog`. Run `agenticseo context` to validate.

## Deliver as a report

Deliver through the `seo-report` skill. If that skill is not available, say so and stop before writing the report.

## Commands

- `agenticseo saved list [--tags TAG,...]`: fetch an existing keyword set, optionally filtered by tags, with its latest metrics.
- `agenticseo research "SEED"`: expand a seed when the user starts from a topic.
- `agenticseo ranked DOMAIN`: exact ranking keywords and URLs when the user starts from a domain or page.
- `agenticseo gsc performance --dimensions query,page`: when Search Console is connected, real queries mapped to the pages already earning impressions, and cannibalization (one query splitting impressions across several URLs). Free; it exits 2 when not connected.
- `agenticseo keywords TERM...`: volume, difficulty and intent for the final candidates.
- `agenticseo serp "QUERY"`: validate whether keywords belong on the same page by checking SERP overlap and intent, one query per call.
- `agenticseo local serp "QUERY" --near LAT,LNG`: for local SEO clusters, when Maps or local-pack intent should affect page mapping.
- `agenticseo saved add KEYWORD... --tags TAG,...`: optionally tag the final clusters after the user confirms.

## Workflow

1. Gather the candidate keyword set.
   - When Search Console is connected, start from real queries and the pages already ranking for them: `agenticseo gsc performance --dimensions query,page --limit 1000`.
   - Use `agenticseo ranked` for domain- or page-driven clustering.
   - Use `agenticseo local businesses` and `agenticseo local serp` when proximity, local packs or Google Business results decide whether terms belong on location pages.
2. Remove duplicates, irrelevant terms and terms that clearly require a different product or audience.
3. Build clusters around intent and page type:
   - Same SERP intent and similar ranking pages belong together.
   - Different intent, buyer stage or SERP format should be split.
   - Similar words do not guarantee the same cluster.
4. For important borderline terms, run a small batch of `agenticseo serp` checks to compare the ranking URLs.
5. Assign each cluster to:
   - An existing URL, if supplied and appropriate
   - A new page recommendation, if no existing page fits
   - A do-not-target / later bucket, if weak or off-strategy
6. Identify cannibalization risk when several pages would target the same intent. When Search Console is connected, confirm it from real data: the same query sending impressions to several URLs in `agenticseo gsc performance --dimensions query,page`.
7. Ask before applying cluster tags with `agenticseo saved add ... --tags`.

## Output format

Title: `Keyword Clustering: <site or keyword set> — <date>` (see `seo-report`; omit the site when it is the project's domain).

If a report template applies (see `seo-report`), its sections and tone replace this list.

Sections in this order:

1. **The map**: one or two opening sentences: how many clusters, how many pages to create, how many to update, and any cannibalization found.
2. **Clusters**: a table of cluster, primary keyword, intent, target page and priority. Keep secondary keywords in the per-cluster briefs, not in this table.
3. **Page briefs**: one finding per cluster: the page type and the searcher's problem, then the page to create or update. List required sections and internal links underneath.
4. **Cannibalization**: a table of the query, the competing URLs and which one to keep, only when there is real evidence for it.
5. **What to do next**: an ordered list, including the tag suggestions and the explicit ask before applying them.
6. **How this report was made**: opens with the skill link line from `seo-report`, pointing at `https://github.com/kid7st/agenticseo/blob/main/.agents/skills/keyword-clustering/SKILL.md` ("AgenticSEO Keyword Clustering skill"), then where the keywords came from (with costs and evidence paths for paid lookups), and a note labelling target pages as proposed when no URL data was supplied.

## Guardrails

- Do not over-cluster tiny keyword sets. If there are fewer than 10 usable terms, produce a simple map.
- Do not rely on lexical similarity alone. SERP intent wins.
- Do not replace tags broadly without explicit confirmation (`--replace-tags` replaces a keyword's tags).
- If existing URL data is missing, label target pages as proposed.
- Search Console positions are averages over the date range, and its clicks are not GA4 sessions; compare them, do not add them.
