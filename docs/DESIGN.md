# Technical design

## Core boundary

Use the **same SEO logic for local and optional remote execution**:

```text
User -> coding agent (task skills + file tools)
                    |
                    v
                   CLI -> SEO operations
                           |       |       |
                        providers  local   job runner
                                   store   (local by default)
```

The CLI owns argument parsing and presentation; operations own SEO rules; provider calls own remote HTTP and response validation; persistence owns local state. Keep these boundaries only where needed to remove OpenSEO's Cloudflare/Web/account dependencies. Do not port its server functions, OAuth provider, billing context, MCP transport, or Web UI as a prerequisite for the core. Publish a documented install path for users outside the source checkout, and keep command contracts agent-neutral. Preserve upstream MIT attribution for any copied code.

Prefer TypeScript on Node so existing Zod schemas, DataForSEO shaping, issue detectors, and skill instructions can be reused where practical. Do not assume that an OpenSEO service is directly importable: current code uses `cloudflare:workers`, R2/KV, DB repositories and billing context in business paths. Extract portable logic with characterization checks; replace platform adapters instead of simulating a Worker runtime.

## Local state

- Discover the project from the current directory, with an explicit project-root override for use elsewhere. Ask initially for only the target site and market; collect additional context when the task needs it. Local configuration and context can be inspected or edited by a person or an agent. Use Markdown for readable reports by default, keep HTML export for OpenSEO capability parity, and store large raw evidence as files with searchable metadata.
- Historical rank, audit, keyword and analytics records need indexed, queryable storage with dates, source, scope and market preserved. DuckDB is the leading candidate for analytical queries, **not yet a settled choice**. Before locking it in, spike repeated writes, concurrent scheduled/interactive invocations, schema evolution, recovery after interruption, and file locking against a realistic audit and rank run. If it cannot safely serve the write path, use SQLite for operational state and introduce DuckDB only for analysis when needed.
- No secrets or OAuth refresh tokens in project files or Git. Use environment variables or an OS-backed credential store; ignore generated local history/evidence by default while allowing users to intentionally version selected context and reports. Define the exact layout after the storage spike.
- Paid-response caching is keyed by provider request, market, target scope and relevant options, with expiry recorded. Keep original provider data or enough provenance to inspect how a result was derived.

## Execution

- Interactive commands run in the foreground. A crawl runs locally first; a long job records durable progress and can be resumed or diagnosed after interruption. Respect robots.txt, safe URL policies, resource limits and provider rate limits.
- Scheduled checks use the host scheduler (cron/launchd/Task Scheduler) to invoke the same CLI. A scheduler is necessary for unattended execution but not for on-demand research. Avoid duplicate runs and persist failures visibly.
- An optional remote worker can run the same job contract when local execution is unsuitable. It requires explicit credential handling, job submission, result retrieval and secure storage; it is not the default and must not become a second SEO implementation.
- External API credentials are unavoidable for provider-backed features. Google OAuth needs an initial authorization flow and token refresh; a temporary loopback callback or another supported flow does not imply an always-on service.
- DataForSEO bills the user directly. Keep optional cost estimates where available and report actual provider costs and errors when known. Do not introduce mandatory budget configuration, preflight approval, or a product-level gate on website edits.

## Agent contract

Ship a portable executable and task-focused Agent Skills together. Skills explain how to investigate and interpret results; they do not duplicate SEO computations. Pi and Codex can call the same commands through their shell tools. Keep the command surface discoverable by task, with detailed capabilities still reachable when needed. The CLI supplies JSON for machine-readable results, documented exit codes and errors on stderr; no progress logs mixed into JSON. Default replies stay small: finding, source/date/scope, and a path or identifier for fetching precise rows later. Full datasets remain in local artifacts. Discover the project from the working directory and allow an explicit root override. Long-running commands expose progress without corrupting machine-readable results.

A Pi extension or MCP adapter may improve integration for clients that need it, but must wrap the same operations and remain optional; neither is a required server or the primary product interface.

## Decisions to validate early

1. Pin an upstream OpenSEO commit and inventory MCP tools **plus** application-only SEO features. Record comparable inputs and output samples before changing shared logic.
2. Spike Node execution of one simple DataForSEO query and one project-local save, without Worker imports or a Web server. This tests the extraction boundary rather than assuming it works.
3. Spike the local history store with interrupted writes and overlapping invocations before committing to DuckDB. Keep the adapter private to the operations until the result is known.
4. Test one complete task in Pi and Codex: discover the site, retrieve focused evidence, save it locally, and give one grounded recommendation. Record missed skills, unnecessary calls and context-heavy results before broadening the CLI.
5. Check how much of the crawler and Lighthouse path is portable. Where Cloudflare Workflow behavior is required for reliability, define equivalent local checkpoint semantics before extracting it.
