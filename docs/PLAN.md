# Execution plan

## Working rule

Full SEO capability parity with OpenSEO is the target. The initial baseline is OpenSEO commit `0ffff93101043aad7600a3b6a499a0cd2887ef49`; expand the inventory against that snapshot rather than assuming MCP tools cover the product. Finish each phase with runnable local commands, a project-local artifact, and a comparison against pinned upstream behavior. Do not claim parity because a command name exists. Keep a tracked matrix of every product capability in [PRODUCT.md](PRODUCT.md): `not started / in progress / verified / blocked`, with an upstream reference, fixture, local command and observed differences.

## Phase 0 — Baseline and risk spikes

- Pin the upstream commit and enumerate the MCP tool list and SEO-oriented application-only endpoints, including AI Visibility, Lighthouse exports, GA4, saved data, reports and summaries. `scripts/upstream-coverage.mjs` compares the pinned tree against [PRODUCT.md](PRODUCT.md) and reports every upstream module the inventory never names. The 2026-09-23 run left 22 such modules, all judged to be sibling files of tools, server functions or feature directories an existing row already cites; no capability was missing. Rerun it in the Phase 6 parity review.
- Record representative request/response fixtures for paid provider calls without committing credentials or sensitive project data. Check OpenSEO's MIT attribution requirements before copying code.
- Validate a Node-only DataForSEO call with project-local evidence. US/en keyword overview calls succeeded. The earlier HTTP 403 did not reproduce: on 2026-09-23 the same account and Labs keyword-overview endpoint returned 200 for a five-term lookup, and a deliberately invalid key returns `DataForSEO HTTP 401`, so the 403 was not a malformed credential. Treat it as an account-side condition (IP allow list, API permission or balance) and re-check when Phase 1 implements credential handling. SQLite is selected for mutable history after a disposable cross-process spike (see [DESIGN.md](DESIGN.md)); confirm Node write behavior and representative data volume when building Phase 1 storage.
- Run a complete agent task using one skill and a real local query before expanding the command surface. Done in Pi on 2026-09-23: `keyword-snapshot` drove `agenticseo init` plus one live five-term lookup for a real site, returning a ~600-byte summary while the 72 KB raw provider response stayed in project-local evidence, with the unmatched term reported as missing rather than zero. A second shell-capable agent is deliberately deferred to the Phase 6 release review; one client is enough to test the command contract at this size.
- Exit: maintainer-reviewed inventory with no known capability omitted; demonstrated portable boundary, chosen storage and identified nonportable dependencies, and evidence about a live agent workflow. **Complete.**

## Phase 1 — Local contract and durable project state

- Deliver the CLI's non-interactive JSON/error contract alongside a discoverable task skill. Discover projects from the working directory with an explicit override; initialize site and market first, then add project context, local artifacts, report/template CRUD and inspectable metadata.
- Return concise findings with source, date and scope; allow focused evidence retrieval without printing whole datasets into the agent's context. Make Markdown reports readable locally and retain HTML export.
- Keep credentials outside the project. Paid commands need no mandatory spending confirmation or configured budget.
- Exit: a shell-capable agent can create and reopen a project, update context, write and retrieve a report, and distinguish invalid input, missing credentials and provider failures without a Web or MCP server. A complete task works in Pi; other clients are verified in Phase 6. **Complete** (2026-09-23, Pi): following `seo-project-setup`, `keyword-snapshot` and `seo-report` on a real site, the agent initialized a project, fixed a context edit that `agenticseo context` rejected with the exact field, ran one live lookup from the recorded key-page topic, saved a report and read it back with `--project` from another directory. Exit codes were observed live: 2 for no project and invalid context, 3 for a missing key and a rejected key (HTTP 401), 4 for a provider task error (`40501 Invalid Field: 'location_code'`, charged $0). Not yet built: the research log and report paging.

## Phase 2 — Research and intelligence

- Port DataForSEO access, retry/error classification, response validation, request-scoped caching and research shaping; compare to upstream fixtures.
- Deliver keywords (including saved/tagged/exported terms), SERPs, domain/ranked-keyword research, competitor comparison, backlinks and local SEO.
- Include application-only enrichment where it supplies a distinct SEO result, such as public domain-rating lookup.
- Exit: every research row in the product inventory has a comparable CLI operation; results retain provenance and raw evidence without overwhelming an agent response. **Complete** (2026-09-24, Pi): all 16 research rows have a command, fixture tests and live evidence, except three recorded gaps: place-name SERP locations ship with local rank tracking in Phase 4, the dashboard's daily backlink snapshot is reviewed with dashboards in Phase 6, and a successful Ahrefs Domain Rating lookup needs a real free key. Two end-to-end tasks ran from the skills against live data for $0.28: a competitor and keyword-opportunity study for a real site (research, metrics, SERP, competitors, domain, ranked keywords, pages, backlinks, saving and querying keywords, a validated report and research-log entry) and a local visibility check for a real business (categories, Maps SERP, profile, listings, reviews, Q&A, a 3×3 rank grid). Every paid result carried its provider, time, cost and an evidence file with the raw provider items. The exercise found two defects, fixed with regression tests: metrics looked up with `keywords` were not stored, so saved keywords showed them as unknown, and `local serp` and `local reviews` printed 30 KB and 21 KB (now 9 KB and 12 KB, full rows kept in evidence). The largest remaining default outputs are about 12 KB (`ranked` at 50 rows, `local reviews` at 20).

## Phase 3 — Crawling and site audit

- Extract safe crawl/discovery, per-page and cross-page checks; persist page, link, issue and run state locally. Port optional Lighthouse sampling and result export.
- Run locally first; only introduce a remote runner if measured job duration or uptime needs justify it. The remote runner must invoke the same audit operation.
- Exit: a representative site produces explainable, resumable audit results; robots rules, URL safety, failures and partial results are tested; issue/export output is comparable to upstream. **Complete** (2026-09-24, Pi): following `seo-audit` and `seo-report` on a real site, the agent:
  - started a 200-page audit in the background and polled it while running research;
  - read issues, pages and stored columns with `query`;
  - saved a Chinese report with an HTML export, a research-log entry and key pages.

  The crawl took 3 minutes 20 seconds and cost nothing. Paid lookups cost $0.17 before the DataForSEO balance ran out; the resulting HTTP 402 exited 4, and the report states it as a limit.

  `test/audit.test.ts` covers robots rules, URL safety, 429 back-off, a killed worker resumed without re-fetching, takeover and deletion, and partial results. The engine matched badseo.dev's declared issues on 40 of 42 fixture pages; the other two fixtures are not deployed. Lighthouse was verified separately: 12 checks for $0.06.

  The exercise found two gaps, both fixed. Failures did not print the provider's own response. The audit skill did not give the key-page fields, so the agent guessed `note`; the context check rejected it with the exact field.

  Not ported: hosted audit capacity limits and the Lighthouse issue-file download (`query` reads the stored payload).

## Phase 4 — Ranking, scheduling and history

- Port tracker configuration, keyword changes, cost estimation, manual runs, queued/provider polling where needed, position history and trend queries.
- Add idempotent scheduler entry points callable by the OS scheduler, with duplicate-run prevention and explicit failure reporting.
- Exit: repeated runs produce comparable history, scheduled work survives an interrupted invocation, and provider costs and failures remain visible when available. **Complete** (2026-09-24, Pi): asked to track the keywords from its earlier audit report, the agent:
  - created a tracker, added six keywords and estimated the cost;
  - ran a live check ($0.086) and reported the positions against the audit's historical ranks;
  - switched the tracker to weekly;
  - gave the crontab line from `rank schedule` without changing the system.

  It priced the weekly check from the live run, because the tracker was manual when it asked for the estimate. Creating or updating a scheduled tracker now returns its recurring estimate.

  A second check of the same tracker through `rank due` ($0.056: six queued tasks, one live fallback) completed. `rank show` compared the two runs, and `rank trend` and `rank matrix` listed both. Two keywords that ranked #24 and #38 in the live check were outside the top 100 in the queued check 20 minutes later; their raw task results confirm this, so it reflects Google's variation, not the parser.

  Interruption was verified live: a `rank due` killed after posting its tasks was adopted by the next call, which collected both paid tasks and paid nothing more.

  Costs are recorded per run. DataForSEO charged more than OpenSEO's price table: $0.008 against $0.0065 for a four-page live check, and $0.0024 against $0.00195 for a queued task. Estimates stay nominal.

## Phase 5 — First-party Google data and AI visibility

- Support initial GSC and GA4 authorization, token refresh, property selection, performance/inspection and analytics operations. Keep credentials out of project artifacts.
- Port AI brand/mention lookup, cited sources and prompt exploration from application-only endpoints, including source- and platform-specific availability limits.
- Exit: authorized sample projects yield comparable first-party and AI-visibility outputs; revoked access produces a useful error, never a fabricated empty result. **Complete** (2026-09-24, Pi): the user created a Desktop OAuth client and connected kid7st@gmail.com with `google connect`. Search Console `sc-domain:kua.ai` and GA4 `properties/369400289` were selected, and every command ran on their live data. In one Pi task that allowed free first-party data only, the agent:
  - compared 28 days of Search Console clicks (811, down 25%) with GA4;
  - found GA4 recording 27 organic sessions, all on `app.kua.ai`, with no key events;
  - traced this to a Google Tag Manager snippet on kua.ai that never runs;
  - saved a Chinese report with an HTML export.

  It made no DataForSEO call. AI visibility was verified live separately: a brand lookup with two competitors ($0.839) and four models on one prompt ($0.153).

  Revoked access was checked on a copy of the credentials with an invalid refresh token. Every Search Console and Analytics command exits 3 with Google's one-line reason and the reconnect command; none returns an empty result.

  Setting up the connection found five defects, all fixed:
  - a malformed client ID reached Google's consent page;
  - an unknown client failed only in the browser;
  - a Cloud project without the APIs enabled was reported as generic denied access, with a reconnect hint;
  - listings exited 0 when no account could list anything;
  - `--help` exited 2.

## Phase 6 — Agent workflows and full parity review

- Extend the task-skill pattern established in Phase 1 to OpenSEO's public workflows: project setup, audits, keyword research/clustering, competitive work, local SEO, link prospecting and report writing. Preserve their decision-making intent without requiring MCP or OpenSEO's in-app chat.
- Review dashboard-style summary and opportunity logic; expose useful computed results as CLI operations rather than rebuilding a dashboard.
- Exercise every inventory row end to end from Pi and at least one other shell-capable agent, including mutations, exports and re-reading historical data. Publish a documented gap only for externally unavailable capabilities, then decide whether the release can honestly claim parity.
- Before a functional release, publish an install path, contributor and security reporting guidance. Keep OpenSEO's original license notices with ported code. Verify a clean-machine install, not only a source checkout.
- Workflow skills (6a) are done: all ten OpenSEO skills are adapted in `.agents/skills/`. On 2026-09-24 each was run once in Pi against real data, and the seven sessions cost $1.22 in total:
  - `seo-project-setup` set up amazonseo.ai from scratch and connected Search Console and GA4.
  - `seo-coach` answered from existing reports at no cost.
  - `keyword-clustering`, `competitor-analysis`, `competitive-landscape`, `link-prospecting` and `local-seo` (Little Charli) each saved a report that `agenticseo reports` accepted, stayed within the user's budget ($0.05, $0.20, $0.65, $0.19 and $0.13), and follows the template, including its closing skill link.

  The only CLI friction was `--help` after a subcommand exiting 2, which is fixed.
- Exit: no required SEO row remains `not started`, `in progress` or silently skipped. The normal workflow starts with a local command, not a running OpenSEO server; a contributor can build and test it from the public repository.

## Dependencies and non-goals

Phases 0–1 establish the agent workflow and provider/storage boundaries for later phases; work within phases 3–5 can run in parallel once those contracts stabilize. Remote execution, agent-specific extensions, a custom MCP transport, UI, SaaS auth, collaboration and credit resale are not prerequisites. Avoid scheduling calendar dates until the Phase 0 spikes establish the effort of extracting Worker-bound code.
