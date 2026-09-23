---
name: seo-project-setup
description: Set up an AgenticSEO project for a website and record its goals, positioning, competitors, key pages and writing preferences in the project context. Use when a user starts SEO work on a site, or asks the agent to remember what the business is and who it competes with.
---

# SEO project setup

Interview the user once about one website and store the durable answers in the project context, so later SEO tasks and other agents start from them instead of asking again. This is setup, not an audit; it makes no paid calls.

1. Run `agenticseo context`. If it fails with exit code 2 because no project exists, ask for the site and target market and run `agenticseo init --domain DOMAIN --location COUNTRY` (a two-letter country code such as `US`, or a DataForSEO location code; add `--language` only when the user targets a non-default language) in the website's repository root. Never guess the market.
2. Show the user what is already recorded and which `missingSections` are empty. Confirm or correct existing entries rather than asking again.
3. Ask in small batches, then write the answers to the `file` path from step 1 (`.agenticseo/context.json`). Write as the interview progresses, not all at the end:
   - `sections.business_overview`: what the business does, who it serves, markets and languages, and whether the site is new, established, migrating or recovering.
   - `sections.current_goal`: the SEO outcome with a metric and timeframe, for example "rank top 10 for 20 buying-intent terms by Q4".
   - `sections.positioning`: audience, problem, differentiator, and claims the user wants defended.
   - `sections.writing_preferences`: voice, banned words and topics to avoid.
   - `competitors`: `[{ "domain", "name"?, "notes"? }]`, one entry per domain, with why it matters.
   - `keyPages`: `[{ "url", "role"?: "hub" | "spoke" | "money" | "other", "topic"?, "notes"? }]`, a shortlist of 10 to 30 pages that matter, not a site inventory.
   - `customSections`: `{ "slug": { "title"?, "content" } }` for anything that does not fit above, at most 20.
   Each prose section holds up to 4,000 characters: a few tight paragraphs, not a transcript. An empty string means the section is missing. Record only facts the user confirmed.
4. Run `agenticseo context` again after each write. Exit code 2 names the invalid field; fix the file and rerun until it succeeds. The output shows competitor domains and page URLs in canonical form; two entries that normalize to the same domain or URL are rejected.
5. If this session spent money on a provider, append `{ "entryDate": "<today from agenticseo context>", "summary": "<what>: <inputs>. Verdict: <conclusion>" }` to `researchLog`. Copy `today` from the command output; do not guess the date.
6. Reply with a short summary of what was recorded and what is still missing, and suggest one next task, such as a keyword snapshot for a key page.
