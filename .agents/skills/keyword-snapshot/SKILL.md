---
name: keyword-snapshot
description: Compare candidate SEO keywords for a website with a local DataForSEO snapshot. Use when a user asks which search terms fit a product or page, or wants a first evidence-backed keyword opportunity.
---

# Keyword snapshot

Use AgenticSEO's installed `agenticseo` command. If it is not on PATH, tell the user how to install it from this repository; do not invent metrics. The command needs `DATAFORSEO_API_KEY` (base64 of DataForSEO login:password) in the environment.

1. Run `agenticseo context` to read the project's goal, positioning, competitors and key pages. If it exits with code 2 because no project exists, ask for the site and target country/language and run `agenticseo init --domain DOMAIN --location LOCATION_CODE --language LANGUAGE_CODE`. Use DataForSEO location codes; never guess the market.
2. Choose a few candidate queries from the recorded goal, the key pages and the site's actual content. Run `agenticseo keywords "QUERY ONE" "QUERY TWO" ...`. The first slice checks keyword metrics, not rankings or related keyword discovery.
3. Read the concise result first. It contains the lookup time, provider cost, missing keywords, and an evidence file path. Read specific rows from that file only if the brief output is insufficient. Missing or null metrics are unknown, not zero.
4. Recommend at most one next page or content change supported by both the site's content and the available keyword evidence. State the market and lookup date. Search volume is a provider estimate, not visits; this command does not establish a Google ranking. If the evidence is too thin, say what further research is needed instead.

If the command fails, report its actual error. Exit code 3 means the key is missing or rejected; ask the user to fix it. Exit code 4 is a provider failure; report it and any charged cost, and do not retry in a loop. Do not substitute made-up metrics or treat a failed lookup as no search demand.
