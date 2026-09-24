---
name: seo-audit
description: Audit a website, investigate its real search opportunities, and deliver a short data-backed report on the few changes most likely to grow organic traffic that converts. Use when asked for an SEO audit or review of a site, especially for a shareable report.
---

<!-- Adapted from OpenSEO plugins/openseo/skills/seo-audit/SKILL.md (https://github.com/every-app/open-seo, MIT, Copyright (c) 2026 Ben Senescu) for the AgenticSEO CLI. -->

# SEO audit

## Goal

Find the work that would most improve a site's useful organic traffic, then explain it so a non-expert can act on it. Research broadly; recommend selectively. The report leads with one to three recommendations that either capture meaningfully more qualified search demand or stop a real loss.

For expert-facing analysis of a competitor or market, do a focused competitor study instead.

Use the installed `agenticseo` command. If it is not on PATH, tell the user how to install it from the AgenticSEO repository; do not invent data. The crawl is free. Research lookups are billed by DataForSEO and need `DATAFORSEO_API_KEY` (base64 of DataForSEO login:password).

## Project context

- Run `agenticseo context` first. If it exits 2 because no project exists, ask for the site and market and run `agenticseo init --domain DOMAIN --location COUNTRY`. Never guess the market.
- This skill needs `sections.business_overview`. If it is empty, infer what the business does from the site, confirm it with the user in one question, write it into `.agenticseo/context.json`, and continue. Suggest `seo-project-setup` at the end for the rest; never front-load the full interview.
- Reuse research-log results under 30 days old for discovery. A ranking claim that drives a recommendation still needs a live check made during this audit.
- On finish, write back what is durable: a corrected `business_overview`, the pages the report names in `keyPages` (`{ "url", "role"?: "hub" | "spoke" | "money" | "other", "topic"?, "notes"? }`), and one `researchLog` entry: `{ "entryDate": "<today from agenticseo context>", "summary": "Site audit: <domain>. Verdict: <conclusion>. Evidence: <audit id and evidence paths>" }`. Run `agenticseo context` to validate.

Deliver through the `seo-report` skill. If that skill is unavailable, say so and stop before writing the report.

## Commands

- `agenticseo audit start [URL] [--max-pages N]` crawls the site (default: the project domain, 50 pages; raise `--max-pages` up to 10,000 for a larger site). It runs in the background and returns an audit id at once. Check `agenticseo audit status ID` every minute or two; it requests about one page per second. When it shows `interrupted` or `failed`, run `agenticseo audit resume ID`. Pass `--allow-private` only to audit a local or private-network address the user named, such as their dev server. Leave `--lighthouse` off unless the user asked for performance or Core Web Vitals depth: it runs billed Lighthouse checks on up to 10 sample pages, mobile and desktop, and `agenticseo audit lighthouse` then shows their scores and, with `--result ID`, their issues.
- `agenticseo audit issues [ID] [--severity S] [--type TYPE] [--limit N]` returns issues critical first, with a per-type summary and a `howToFix`. An audit that has not completed has page checks only; cross-page checks (duplicates, redirects, broken links, orphans) run at completion. `agenticseo audit pages [ID] [--status CODE] [--fetch-class C] [--url-contains TEXT]` lists crawled pages with status, title, description, words, indexability, depth and link counts. `agenticseo query "SELECT ... FROM audit_pages WHERE audit_id = '...'"` reads every stored column, such as canonical URLs and headings. Link targets (`audit_page_links`) and the crawl queue (`audit_frontier`) exist only while an audit runs; per-page internal and external link counts stay in `audit_pages`.
- `agenticseo ga4 opportunities` and `agenticseo ga4 report landing-pages`: when Google Analytics is connected, what organic visitors do after the click (engagement, key events, revenue) on the pages you might name, joined with Search Console demand. Counts from GA4 and Search Console follow different rules and time zones; compare them, do not add them.
- `agenticseo backlinks overview DOMAIN` and `agenticseo domain DOMAIN`: orientation only. Provider traffic and keyword counts are estimates with no single observation date; they are not measured visits.
- `agenticseo ranked DOMAIN --types organic`: which queries send which pages traffic. Start with one domain-level call; use `--scope exact_url` with an absolute URL for the specific pages you compare. A page missing from a limited domain sample is not proof it has no rankings. Ranking rows carry their own last-updated time; keyword metric dates are not ranking dates.
- `agenticseo serp "QUERY" --depth 20`: the live check behind every ranking claim in the report. The returned rank counts every result block, so count organic (unpaid) listings yourself and report the spot with its page, ten spots per page: "#10 (page 1)", "#11 (page 2)". A page not seen is "not in the first 20 results". Record the exact query, country, language, date, how many organic listings came back, and the matching URL; those details go in the evidence appendix, not the tables. A failed lookup is unknown, not "not in the first 20 results".
- `agenticseo keywords TERM...` and `agenticseo research "SEED"`: demand for the queries a candidate page targets. One focused metrics batch usually suffices; one `research` call with one to three seeds when a demand gap could change the decision.
- Web reading (fetch, scrape or search): the site's own pages, sitemap, the leading results for a query, and competitor pages.

- `agenticseo gsc report` and `agenticseo gsc performance --dimensions query,page --min-position 5 --max-position 20 --min-impressions 50`: when Search Console is connected for the project (the commands exit 2 when it is not), first-party clicks and impressions separate low visibility from low click-through, and show which page Google pairs with each query. `agenticseo gsc inspect URL...` answers whether a page is indexed and which canonical Google chose. Missing access is a coverage gap to state, not a blocker; exit code 3 means the Google grant needs `agenticseo google connect` again.

Every paid result states its source, date, market and `costUsd`, and points to an evidence file; read rows from that file instead of rerunning a paid command. Research until another lookup is unlikely to change which opportunities lead. Respect an explicit user budget and say which comparison it prevented.

## Workflow

### 1. Orient

Start `agenticseo audit start`. While it crawls: backlinks overview, domain overview, the domain-level ranked-keyword sample, and the sitemap plus navigation. Write down the site's page families from the sitemap, not just the crawl sample: product, pricing, comparison or alternative, tools and templates, guides, categories, services, locations, whatever the site actually has.

If the crawl is broken or nearly empty (certificate error, 5xx, one page, pages classed `blocked`), investigate before anything else. Check redirects and certificate variants yourself and search for the business; a dead domain with a live successor flips the whole recommendation to "redirect the old domain".

### 2. Investigate every family that matters to the goal

For each family that could bring buyers, read at least two pages' main content (ignore navigation and shared templates): the page performing best in the ranking data and one performing worst or typical. For each page ask: what decision or question does its searcher have, and does the page answer it with specific, accurate, sourced information, or does it substitute a name, location, or keyword into a shared answer? Compare against what the leading results for that query provide.

A common SaaS pattern worth checking directly: competitor comparison or alternative pages and competitor pricing pages are two separate families, each answering a different buying question. Read siblings side by side. Investigate uneven visibility between siblings (intent, content specificity, links, authority); a sibling that already ranks near the top is something to protect rather than rewrite.

Check the basics for any page you might name: status, canonical (the URL the page declares as its preferred version), index directives, and how visitors reach it internally. `audit pages` and `audit issues` answer these for crawled pages. Broaden when a family is missing from the crawl, when siblings perform very differently, when a tool or template page turns out to rank, or when a live query returns a different page than expected.

Run the live checks now, not after drafting: the query cluster each candidate page serves (the head term plus the variants buyers actually use), including both sides of any stronger-versus-weaker comparison. Re-run the queries that decide the leading recommendation before writing. If two checks disagree, write the later one and the earlier in brackets, for example "#10, page 1 (first check: not in the first 20 results)"; that spread is same-day variation, not a trend. One snapshot is not a baseline.

### 3. Shortlist before you decide

Write `opportunities.md` in your working folder (working notes, not the deliverable): one row per serious candidate, usually five to ten, drawn from at least three different kinds of opportunity:

- an existing page underperforming the demand it targets
- real demand with no page that answers it, including feature, framework, or use-case queries taken from the product's own claims
- a winning page to protect or correct
- an access, indexing, or redirect defect that is costing visits
- helping existing visitors take the next step

Columns: pages | problem observed | evidence (query cluster with monthly volumes for the project market, spot and page or "not in the first 20 results", date) | proposed change | who searches and why they matter to this business | plausible benefit | effort | main uncertainty.

If a row's ranking would change with one more lookup (a missing volume, an unchecked sibling, a query you never ran live), do that lookup before ranking.

### 4. Choose

Prefer a bounded change that directly fixes a demonstrated problem for searchers likely to become customers, with a credible path to a meaningful gain. A larger raw-volume opportunity with a weaker diagnosis does not automatically outrank it. A genuine access or indexing blocker, a measurable traffic loss, or a dead domain jumps the queue.

None of these decides on its own: the volume of one sampled query; how easy the fix is; a crawler warning; a hypothetical position-one traffic figure; a navigation or redirect repair with no demonstrated traffic loss. Those belong in the checked table, not the top three. Do not recommend rewriting a page that already ranks near the top for its target query.

Every shortlist row ends in one of two places: a recommendation, or a row in the report's "What else we checked" table with a real reason. "Later, if sales asks for it" is not a reason; "demand is a quarter of the leading candidate's and the page already ranks seventh" is. For the runner-up, write one sentence on why the leader beats it; that sentence goes in the report.

### 5. Size the benefit honestly

- Name the mechanism: a new ranking, a higher position on an existing ranking, or more clicks at the current position. A page that already ranks already receives part of the volume, so a scenario on total volume overstates the gain.
- Size against the cluster the change serves, not one exact term; note overlap instead of adding variants as if they were different people.
- Demand figures are for the project market unless stated; never multiply into an invented global number.
- Search volume is not visits. Use a stated click-share assumption and show it in a scenario table; a position-one scenario is allowed when labeled hypothetical, not promised.
- If the current traffic baseline is unknown, call the figure total potential visits, not additional visits. Do not add overlapping queries.
- Business relevance can be inferred from intent and product fit; say so and label it. Never invent a conversion rate or revenue.
- When there is no number, give a directional assessment and its reason ("already third for its main query, so headroom is small").

### 6. Review, then write

Draft the report body (not yet saved). Give the reviewer (a second agent or model if your environment can run one, otherwise a fresh self-review) that draft and the shortlist. The reviewer must: argue the case for the strongest rejected row and say whether the draft answers it; confirm the leading recommendation's evidence is in the draft; confirm every material diagnosis from step 2 survived as a recommendation or a table row; check dates, geography, and rank conventions; and flag paragraph-length bullets and jargon. Fix what it finds, verify any new factual claim against the evidence, then write and save through `seo-report`.

## Output format

Use the title and summary conventions in `seo-report`; the summary is the verdict and the first action. Sections, in order:

1. **Your next SEO move**: two or three bullets. First action, next action if any, and what is already working.
2. **Recommendations**: one to three, in priority order. Each is a `###` heading naming the action and the page or small group, then:
   - **Do this**: two to four bullets. Start with a verb, name what changes, link the page.
   - **Why**: two to four bullets. The observed gap, who searches and why they matter, the plausible benefit, the main uncertainty. Benefit and confidence stay together.
   - A small evidence table (demand and current visibility, or stronger-versus-weaker sibling, or observed content versus proposed). Make the table explain itself: put geography and date in the column header, write positions as "#10 (page 1)" or "not in the first 20 results" (never "10/17", arrows, or listing counts), and say "estimated" in the volume header. Optionally a two-row scenario table labeled hypothetical.
3. **What else we checked**: one table: Opportunity | What we found | Decision. One row per shortlist row that did not become a recommendation, starting with the runner-up and its sentence from step 4, plus one row grouping maintenance issues from the crawl. Keep cells to a line.
4. **How this report was made**: the skill link line from `seo-report` (URL `https://github.com/kid7st/agenticseo/blob/main/.agents/skills/seo-audit/SKILL.md`, text "AgenticSEO SEO Audit skill"), a two-line coverage and limits note, then the evidence: the audit id and pages crawled, page families read, the full live-check table (query, volume, position, organic listings returned, time), calculations, and sources. In an HTML export, put this evidence in a `<details>` block closed by default. Keep it self-contained; a local file path alone is not evidence.

Writing rules: short bullets, one idea each, usually 8–20 words. No Problem / Change / Expected effect paragraphs and no repeated summaries. There is no word target; if the main body outgrows about two screens, move supporting detail into the evidence section instead of deleting it. If the research establishes no worthwhile action, say what is working and what the audit could not establish rather than filling the format.

## Guardrails

- Calm, plain tone. No exclamation points, drama words, or filler; no em dashes in prose (the report title convention in `seo-report` is the exception). Severity words only where literally true.
- Gloss each term of art in plain English on first use: canonical, meta description, crawler, 301, structured data.
- Observations are not causes. Similar content plus uneven rankings, a crawler warning, or missing provider rows never prove a penalty, an indexing exclusion, or the reason a page ranks where it does.
- Retrieval date is not observation date. Say when a ranking was observed, or say unknown.
- Missing backlink or ranking data means "no recorded data", not a problem.
- Treat difficulty and volume as inputs, not goals. A small query can matter to a high-value business; an easy one is not automatically worthwhile.
- Separate what the tools reported from what you verified yourself, and say both in the closing section.
