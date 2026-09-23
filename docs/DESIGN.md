# Technical design

## Core boundary

Use the **same SEO logic for local and optional remote execution**:

```text
Pi / other agent -> CLI (JSON stdout, errors on stderr)
                         |
                         v
          SEO operations and validated inputs
             |             |             |
       data providers   local store   job runner
       (DataForSEO,     (project files  (in-process by
        Google, etc.)    + history DB)   default)
```

The CLI owns argument parsing and presentation; operations own SEO rules; provider calls own remote HTTP and response validation; persistence owns local state. Keep these boundaries only where needed to remove OpenSEO's Cloudflare/Web/account dependencies. Do not port its server functions, OAuth provider, billing context, MCP transport, or Web UI as a prerequisite for the core. Preserve upstream MIT attribution for any copied code.

Prefer TypeScript on Node so existing Zod schemas, DataForSEO shaping, issue detectors, and skill instructions can be reused where practical. Do not assume that an OpenSEO service is directly importable: current code uses `cloudflare:workers`, R2/KV, DB repositories and billing context in business paths. Extract portable logic with characterization checks; replace platform adapters instead of simulating a Worker runtime.

## Local state

- One explicit project root; local configuration and context can be inspected or edited by a person or an agent. HTML reports and large raw evidence remain files, with metadata indexing them.
- Historical rank, audit, keyword and analytics records need indexed, queryable storage with dates, source, scope and market preserved. DuckDB is the leading candidate for analytical queries, **not yet a settled choice**. Before locking it in, spike repeated writes, concurrent scheduled/interactive invocations, schema evolution, recovery after interruption, and file locking against a realistic audit and rank run. If it cannot safely serve the write path, use SQLite for operational state and introduce DuckDB only for analysis when needed.
- No secrets or OAuth refresh tokens in project files or Git. Use environment variables or an OS-backed credential store; ignore generated local history/evidence by default while allowing users to intentionally version selected context and reports. Define the exact layout after the storage spike.
- Paid-response caching is keyed by provider request, market, target scope and relevant options, with expiry recorded. Keep original provider data or enough provenance to inspect how a result was derived.

## Execution

- Interactive commands run in the foreground. A crawl runs locally first; a long job records durable progress and can be resumed or diagnosed after interruption. Respect robots.txt, safe URL policies, resource limits and provider rate limits.
- Scheduled checks use the host scheduler (cron/launchd/Task Scheduler) to invoke the same CLI. A scheduler is necessary for unattended execution but not for on-demand research. Avoid duplicate runs and persist failures visibly.
- An optional remote worker can run the same job contract when local execution is unsuitable. It requires explicit credential handling, job submission, result retrieval and secure storage; it is not the default and must not become a second SEO implementation.
- External API credentials are unavoidable for provider-backed features. Google OAuth needs an initial authorization flow and token refresh; a temporary loopback callback or another supported flow does not imply an always-on service.
- Self-hosted DataForSEO usage is billed by DataForSEO. Expose request cost estimates or user-set budgets and never silently fan out into unbounded paid calls. Costs, retries and provider errors remain observable in the CLI output.

## Agent contract

Start with an executable, not an MCP server or Pi-specific extension. Pi can call commands through its shell tool. The CLI provides machine-readable JSON for successful operations, documented exit codes and human-readable errors on stderr; no progress logs mixed into JSON. Commands must accept an explicit project root, support non-interactive operation and return paths to saved artifacts. Agent skills can guide when to call which command without duplicating SEO computations.

A future MCP adapter is optional. It should wrap the same operations if another agent needs MCP, not be a required server for Pi.

## Decisions to validate early

1. Pin an upstream OpenSEO commit and inventory MCP tools **plus** application-only SEO features. Record comparable inputs and output samples before changing shared logic.
2. Spike Node execution of one simple DataForSEO query and one project-local save, without Worker imports or a Web server. This tests the extraction boundary rather than assuming it works.
3. Spike the local history store with interrupted writes and overlapping invocations before committing to DuckDB. Keep the adapter private to the operations until the result is known.
4. Check how much of the crawler and Lighthouse path is portable. Where Cloudflare Workflow behavior is required for reliability, define equivalent local checkpoint semantics before extracting it.
