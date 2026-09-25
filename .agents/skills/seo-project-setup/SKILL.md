---
name: seo-project-setup
description: Set up an AgenticSEO project for a website and record its scope, goals, positioning, competitors, key pages and writing preferences in the project context, and connect Google Search Console and Analytics. Use when a user starts SEO work on a site, or asks the agent to remember what the business is and who it competes with.
---

<!-- Adapted from OpenSEO plugins/openseo/skills/seo-project-setup/SKILL.md (https://github.com/every-app/open-seo, MIT, Copyright (c) 2026 Ben Senescu) for the AgenticSEO CLI. -->

# SEO project setup

## Goal

Interview the user once about one website or SEO project, and store the answers in the project's shared context. Every other skill and agent reads that context, and the user can read and edit it in `.agenticseo/context.json`, so it survives new sessions, new machines and new agents. This is a context setup workflow, not a full audit.

## Tone

Be friendly, practical and structured. Ask questions in small batches. Explain why each item matters only when useful. Do not overwhelm a beginner with jargon.

## Where the answers go

- `agenticseo context` prints everything already known, the context `file` path, `today`'s date and a `missingSections` list. It is free.
- You write the answers into that file with your file tools, then run `agenticseo context` again: exit code 2 names any invalid field. The fields this skill uses:
  - `sections.business_overview`, `sections.current_goal`, `sections.positioning`, `sections.writing_preferences`: prose, up to about 4,000 characters each, a few tight paragraphs, not a transcript. An empty string means the section is missing.
  - `competitors`: `[{ "domain", "name"?, "notes"? }]`, one entry per domain.
  - `keyPages`: `[{ "url", "role"?: "hub" | "spoke" | "money" | "other", "topic"?, "notes"? }]`.
  - `customSections`: `{ "<slug>": { "title"?, "content" } }` for anything that does not fit a typed section, at most 20.
  - `researchLog`: append `{ "entryDate": "<today>", "summary": "<what>: <inputs>. Verdict: <conclusion>" }` when this session spends money on a provider.

Write in batches as the interview progresses; do not hold every answer until the end.

## Checklist

### 1. Check the command and the project

1. Run `agenticseo context`. If the command is missing, tell the user how to install AgenticSEO from its repository; nothing can be saved without it.
2. If it exits 2 because no project exists, ask for the site and target market and run `agenticseo init --domain DOMAIN --location COUNTRY` (a two-letter country code such as `US`, or a DataForSEO location code; add `--language` only when the user targets a non-default language) in the website's repository root, or in a folder the user chooses. Never guess the market.
3. If the user works on several sites, confirm which one this project is for before writing.

Do not run paid research just to test connectivity.

### 2. Read what is already there

Show the user a short summary of what the context already holds and which `missingSections` are empty. Confirm or correct existing entries rather than re-asking questions that are already answered; this skill is often re-run after another skill filled in part of the context.

### 3. Collect website scope

Ask for:

- Primary website/domain
- Additional domains or subdomains
- Important products, services, categories or pages
- Target countries/languages
- Whether the site is new, established, migrating or recovering from a drop
- CMS or publishing workflow, if relevant

Write the durable parts to `business_overview`: what the business does, who it is for, the target markets/locales, and the site's current stage.

### 4. Capture goals

Ask the user what they want from SEO:

- More qualified leads
- More signups/trials
- More ecommerce revenue
- More newsletter/audience growth
- More brand/category awareness
- Recovery from traffic loss
- Better ranking for specific pages

Ask for success metrics and timeframe. If goals are vague, help turn them into measurable goals such as "increase non-branded organic signups" or "rank top 10 for 20 buying-intent terms".

Write the result to `current_goal`, including the metric and timeframe.

### 5. Capture positioning and strategy context

Ask what research they have already done about the company, product, audience and competitors. Request any notes, docs, customer interviews, positioning docs, pitch decks, landing pages or strategy memos they can share.

Probe for:

- Who the product or site is for
- What pain it solves
- Why users choose it over alternatives
- Competitors and substitutes
- Strong opinions or positioning claims
- Best customers and bad-fit customers
- Existing content that already converts
- Topics they do not want to target

If the user has not done this yet, offer to help research positioning using the company website, competitor pages, reviews, forums and web search.

Write to `positioning`: audience, the problem, the differentiator and any claims the user wants defended. Ask about voice, banned words or phrases, and topics to avoid, and write those to `writing_preferences`; content-drafting workflows read that section.

### 6. Save competitors

Turn the competitors and substitutes from step 5 into `competitors` entries: one per domain, with a short `notes` line on why they matter ("direct competitor, owns the comparison pages"). If the user is unsure who competes in search, `agenticseo competitors KEYWORD...` on a handful of seed keywords names them. It is billed: confirm the list with the user before saving, and log the spend.

Competitors saved here are reused by `competitive-landscape`, `competitor-analysis` and `link-prospecting`.

### 7. Inventory key assets

Ask for or discover:

- Sitemap or important URL list
- Current blog/resources/content library
- Product/category/feature pages
- Existing keyword lists (`agenticseo saved list` shows what the project already saved)
- Current rank trackers (`agenticseo rank list`)
- Backlink or PR assets
- Linkable assets such as studies, templates, tools, datasets, calculators or original opinions

Save the pages that actually matter as `keyPages`: money pages, topic hubs and the linkable assets. This is a curated shortlist, not a site inventory: 10 to 30 URLs is normal. Give each one a `role` and, where known, the `topic` it targets.

### 8. Connect Google Search Console and Analytics

Search Console is the richest first-party signal: existing impressions, near-ranking terms, cannibalization and pages that already have search demand. Google Analytics adds what visitors do after the click. Both are free to read.

1. Run `agenticseo google accounts`. If an account can already read them, go to step 3.
2. Connecting needs the user's own Desktop OAuth client (setup guide: https://github.com/kid7st/agenticseo/blob/main/docs/google.md). With `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET` set, run `agenticseo google connect` and pass on the address it prints; the user approves in their browser within five minutes. If the command exits 3, its message names what to fix in Google Cloud.
3. Run `agenticseo gsc sites` and `agenticseo ga4 properties`, confirm with the user which property belongs to this site, then `agenticseo gsc use SITE_URL` and `agenticseo ga4 use PROPERTY_ID`.
4. Confirm it works with `agenticseo gsc report`. Once connected, `keyword-research`, `keyword-clustering` and `seo-audit` read it directly; there are no files to maintain.

If the user declines or cannot create the OAuth client, skip this step without blocking the setup. Search Console CSV exports can still inform a later task if the user drops them in a working folder (step 9).

### 9. Keep files only for file work

Project knowledge lives in `.agenticseo/context.json`, not in loose notes. A working folder is still useful for the things that are actually files: Search Console CSV exports, crawls, drafts and briefs. Reports belong in the project's reports directory through `seo-report`.

If the user wants one, suggest a folder beside the website or content repository, with a structure like:

```text
seo-workspace/
  gsc/
  drafts/
```

Do not create folders unless the user asks, and do not duplicate goals, positioning or competitors into a local file; that is what the project context is for.

### 10. Recommend the first workflow

After intake, recommend one next workflow:

- `seo-audit`: when the site already exists and the user wants to know what to fix or do first, especially if they are new to SEO
- `keyword-research`: when the user needs ideas from seed topics
- `keyword-clustering`: when they have keywords or Search Console data to map to pages
- `competitive-landscape`: when the market is unclear
- `competitor-analysis`: when they know a competitor to study
- `link-prospecting`: when they have a linkable asset or target page
- `local-seo`: when the business depends on Google Maps visibility near a location

## Output format

Use a checklist with statuses:

| Step | Status | Notes | Next action |
| ---- | ------ | ----- | ----------- |

Then summarize:

- Project status (path, domain, market)
- Sites in scope
- Goals
- Known positioning
- Competitors saved
- Key pages saved
- Search Console and Analytics status, and any local files
- Sections still missing from the project context
- Recommended next workflow

Tell the user they can read and edit everything saved here in `.agenticseo/context.json`.

## Guardrails

- Keep setup lightweight. The user should feel oriented, not assigned homework.
- Confirm facts with the user before writing them. Inferences from the site are fine to propose, but they get saved as agreed answers, not guesses.
- Do not claim Search Console or Analytics is connected unless `agenticseo gsc report` or `agenticseo ga4 overview` succeeds (they exit 2 when not connected and 3 when the grant needs reconnecting). Do not pretend a CSV has been provided unless you can see it.
- Keep project setup focused on setup and context unless the user asks for live research. If a step does spend money, append a research-log entry so other skills do not buy it again.
- If web search or scraping is used for positioning research, distinguish source evidence from inference.
- Overwriting a section replaces it. When context already exists, merge the new answers into the existing prose instead of discarding it.
