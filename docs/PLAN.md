# Execution plan

## Working rule

Full SEO capability parity with OpenSEO is the target. Finish each phase with runnable local commands, a project-local artifact, and a comparison against pinned upstream behavior. Do not claim parity because a command name exists. Keep a tracked matrix of every product capability in [PRODUCT.md](PRODUCT.md): `not started / in progress / verified / blocked`, with an upstream reference, fixture, local command and observed differences. Add that matrix when implementation begins and pin the upstream commit; do not guess version-specific parity now.

## Phase 0 — Baseline and risk spikes

- Pin the upstream commit and enumerate the MCP tool list and SEO-oriented application-only endpoints, including AI Visibility, Lighthouse exports, GA4, saved data, reports and summaries.
- Record representative request/response fixtures for paid provider calls without committing credentials or sensitive project data. Check OpenSEO's MIT attribution requirements before copying code.
- Spike a Node-only DataForSEO call with validated output and project-local save. Spike the intended history store under interrupted and overlapping writes; decide DuckDB vs SQLite on evidence.
- Sketch a complete agent task using one skill and one real local query. Try it in Pi and Codex before expanding the command surface; note discovery failures, unnecessary calls and oversized outputs.
- Exit: an approved inventory with no known capability omitted; demonstrated portable boundary, chosen storage and identified nonportable dependencies, and evidence about the first agent workflow.

## Phase 1 — Local contract and durable project state

- Deliver the CLI's non-interactive JSON/error contract alongside a discoverable task skill. Discover projects from the working directory with an explicit override; initialize site and market first, then add project context, local artifacts, report/template CRUD and inspectable metadata.
- Return concise findings with source, date and scope; allow focused evidence retrieval without printing whole datasets into the agent's context. Make Markdown reports readable locally and retain HTML export.
- Keep credentials outside the project. Paid commands need no mandatory spending confirmation or configured budget.
- Exit: a shell-capable agent can create and reopen a project, update context, write and retrieve a report, and distinguish invalid input, missing credentials and provider failures without a Web or MCP server. A complete task works in Pi and Codex.

## Phase 2 — Research and intelligence

- Port DataForSEO access, retry/error classification, response validation, request-scoped caching and research shaping; compare to upstream fixtures.
- Deliver keywords (including saved/tagged/exported terms), SERPs, domain/ranked-keyword research, competitor comparison, backlinks and local SEO.
- Include application-only enrichment where it supplies a distinct SEO result, such as public domain-rating lookup.
- Exit: every research row in the product inventory has a comparable CLI operation; results retain provenance and raw evidence without overwhelming an agent response.

## Phase 3 — Crawling and site audit

- Extract safe crawl/discovery, per-page and cross-page checks; persist page, link, issue and run state locally. Port optional Lighthouse sampling and result export.
- Run locally first; only introduce a remote runner if measured job duration or uptime needs justify it. The remote runner must invoke the same audit operation.
- Exit: a representative site produces explainable, resumable audit results; robots rules, URL safety, failures and partial results are tested; issue/export output is comparable to upstream.

## Phase 4 — Ranking, scheduling and history

- Port tracker configuration, keyword changes, cost estimation, manual runs, queued/provider polling where needed, position history and trend queries.
- Add idempotent scheduler entry points callable by the OS scheduler, with duplicate-run prevention and explicit failure reporting.
- Exit: repeated runs produce comparable history, scheduled work survives an interrupted invocation, and provider costs and failures remain visible when available.

## Phase 5 — First-party Google data and AI visibility

- Support initial GSC and GA4 authorization, token refresh, property selection, performance/inspection and analytics operations. Keep credentials out of project artifacts.
- Port AI brand/mention lookup, cited sources and prompt exploration from application-only endpoints, including source- and platform-specific availability limits.
- Exit: authorized sample projects yield comparable first-party and AI-visibility outputs; revoked access produces a useful error, never a fabricated empty result.

## Phase 6 — Agent workflows and full parity review

- Extend the task-skill pattern established in Phase 1 to OpenSEO's public workflows: project setup, audits, keyword research/clustering, competitive work, local SEO, link prospecting and report writing. Preserve their decision-making intent without requiring MCP or OpenSEO's in-app chat.
- Review dashboard-style summary and opportunity logic; expose useful computed results as CLI operations rather than rebuilding a dashboard.
- Exercise every inventory row end to end from Pi and at least one other shell-capable agent, including mutations, exports and re-reading historical data. Publish a documented gap only for externally unavailable capabilities, then decide whether the release can honestly claim parity.
- Before a functional release, publish an install path, contributor and security reporting guidance. Keep OpenSEO's original license notices with ported code. Verify a clean-machine install, not only a source checkout.
- Exit: no required SEO row remains `not started`, `in progress` or silently skipped. The normal workflow starts with a local command, not a running OpenSEO server; a contributor can build and test it from the public repository.

## Dependencies and non-goals

Phases 0–1 establish the agent workflow and provider/storage boundaries for later phases; work within phases 3–5 can run in parallel once those contracts stabilize. Remote execution, agent-specific extensions, a custom MCP transport, UI, SaaS auth, collaboration and credit resale are not prerequisites. Avoid scheduling calendar dates until the Phase 0 spikes establish the effort of extracting Worker-bound code.
