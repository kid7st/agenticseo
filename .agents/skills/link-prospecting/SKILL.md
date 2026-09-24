---
name: link-prospecting
description: Find link prospects from SERPs and backlink signals, discover public contact paths, and draft outreach for a page, product, study, guide or tool. Use when the user wants backlinks or mentions for a linkable asset.
---

<!-- Adapted from OpenSEO plugins/openseo/skills/link-prospecting/SKILL.md (https://github.com/every-app/open-seo, MIT, Copyright (c) 2026 Ben Senescu) for the AgenticSEO CLI. -->

# Link prospecting

## Goal

Find realistic pages, sites and authors that might reference the user's page, product, study, guide or tool. Use `agenticseo` for prospect discovery, then use your web, search or browser tools for contact discovery.

Use the installed `agenticseo` command. Lookups are billed by DataForSEO and need `DATAFORSEO_API_KEY`; each result states its cost and points to an evidence file.

## Required inputs

- The user's domain or target URL
- The linkable asset, page, product, study, tool or topic
- Optional competitors
- Optional market/location/language

## Project context

1. Run `agenticseo context` first and ground the outreach in it: `positioning` supplies the claim that makes a link worth giving, and the saved `competitors` are the backlink profiles to mine. If there is no project, set one up as `seo-project-setup` step 1 describes.
2. This skill needs `positioning` and competitors. If either is empty, run a minimal inline setup: ask the user why someone would cite them and who they compete with, or infer it from the site and `agenticseo competitors` and confirm, write it to `.agenticseo/context.json`, then continue. Never front-load the full interview; suggest `seo-project-setup` at the end for the rest.
3. Before paying, check `researchLog`. If the same research ran within the last 30 days, reuse its evidence and say so instead of buying it again.
4. On finish, write back what is durable: the linkable asset in `keyPages`, any competitor whose backlink profile proved useful in `competitors`, and append `{ "entryDate": "<today from agenticseo context>", "summary": "Link prospecting: <asset/target page>. Verdict: <conclusion>. Evidence: <paths>" }` to `researchLog`. Run `agenticseo context` to validate.

## Deliver as a report

Deliver through the `seo-report` skill. If that skill is not available, say so and stop before writing the report.

## Commands

- `agenticseo serp "QUERY"...`: find ranking articles, listicles, resource pages, comparisons and topical publishers, up to 10 queries per call.
- `agenticseo backlinks overview DOMAIN`: a competitor domain's or page's backlink and referring-domain profile, with its top referring domains.
- `agenticseo backlinks domains DOMAIN` and `agenticseo backlinks links DOMAIN`: page through a competitor's referring domains and individual backlinks (`--include`, `--min-domain-rank`, `--link-type dofollow`, `--hide-lost`) when its profile is the best source of prospects.
- `agenticseo domain DOMAIN`: qualify important prospect domains.
- `agenticseo ranked DOMAIN`: what a prospect or competitor ranks for, when topical fit matters.
- `agenticseo local businesses` and `agenticseo local serp`: for local link prospecting, when nearby businesses, local competitors or Maps categories can reveal partnership targets.
- `agenticseo research "SEED"...`: expand prospecting queries.

## Contact discovery tools

After `agenticseo` identifies good prospects, use your web search, page fetch or browser tools for public contact discovery.

Look for:

- Author byline pages
- Contact pages
- Editorial guidelines
- About/team pages
- LinkedIn, X, Bluesky or other professional profiles
- Newsletter or publication masthead pages
- Public email addresses in page HTML or visible page text
- Structured data such as `Person`, `Organization`, `sameAs` or `email`

Only record contact details that were actually found. Include the source URL for any email, profile or contact form.

## Prospecting query patterns

Build queries from the asset or topic:

- `<topic> resources`
- `best <category> tools`
- `<competitor> alternatives`
- `<topic> statistics`
- `<topic> guide`
- `<topic> examples`
- `<topic> templates`
- `<topic> software`
- `<topic> for <audience>`

Run `agenticseo serp` for the most relevant patterns, up to 10 queries per call.

## Workflow

1. Clarify the linkable asset and the reason someone would reference it.
2. Build 5–10 prospecting queries by default.
3. Run `agenticseo serp` for those queries.
4. If competitors are provided, run `agenticseo backlinks overview` for the strongest competitor domains or pages first, and page through their referring domains when the overview shows a useful profile. Continue without backlink evidence if it fails.
5. For local SEO, use `agenticseo local businesses` and `agenticseo local serp` around priority locations to identify nearby competitors, categories and local SERP evidence before searching for local chambers, associations, campus resources, community pages and directories.
6. Filter prospects:
   - Keep topical relevance and editorial pages.
   - Prioritize articles, directories, resource pages, comparisons, statistics pages, templates and curated lists.
   - Deprioritize homepages, login pages, thin affiliate pages, spam, unrelated forums, and direct competitors unless a comparison angle is valid.
7. For each good prospect, define the outreach angle:
   - Broken or missing resource
   - Better current data
   - Useful tool/template
   - Alternative or comparison inclusion
   - Expert quote or supporting reference
8. For the strongest prospects, visit or search the prospect site to find the best contact path.
9. Draft outreach messages. If contact details were found, include the source. If not, list the next best contact-discovery path.

## Output format

Title: `Link Prospecting: <linkable asset> — <date>` (see `seo-report`).

If a report template applies (see `seo-report`), its sections and tone replace this list.

Sections in this order:

1. **The angle**: one or two opening sentences naming the best outreach angle and the prospect type to work first.
2. **Prospects**: a table of prospect URL, site, source, suggested angle, contact path and priority. Keep it under about eight columns; drop the ones that add nothing for this run.
3. **Why these**: one finding per prospect worth explaining: the evidence that they link to things like this, then the exact ask.
4. **Outreach drafts**: the message text for each of two or three reusable angles: resource or list inclusion, an article update, and a comparison mention.
5. **Limitations**: notes: contact paths not found, prospects that are direct competitors or likely paid placements, and which source found each contact detail.
6. **What to do next**: an ordered list: who to send to first, and in what order.
7. **How this report was made**: opens with the skill link line from `seo-report`, pointing at `https://github.com/kid7st/agenticseo/blob/main/.agents/skills/link-prospecting/SKILL.md` ("AgenticSEO Link Prospecting skill"), then which commands returned prospects (with costs and evidence paths) and which came from the web or the browser.

## Guardrails

- Do not invent email addresses, social handles or contact names.
- Do not say `agenticseo` found contact details; it does not return them. Attribute contact discovery to the web, search or browser source used.
- If contact details are not available after a reasonable search, recommend specific discovery steps such as checking the author page, contact page, LinkedIn, X or a reputable contact-enrichment tool.
- Avoid spammy mass outreach. Personalize by page and reason.
- Flag prospects that are direct competitors or likely paid placements.
- On exit code 3, ask the user to fix the key; on exit code 4, report the error and any charged cost, and do not retry in a loop.
