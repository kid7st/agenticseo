# Design

This page explains how AgenticSEO is built and why, for contributors. Users should start with the [README](../README.md).

## Product boundaries

A user asks their coding agent to investigate or improve a website. Skills guide the investigation, commands supply evidence and operations, and the agent uses its own file tools to change the site. The target is OpenSEO's SEO capability set ([parity](openseo-parity.md)), delivered without OpenSEO's hosted product:

- **No required server.** Commands run on demand on the user's machine and may call external APIs. Scheduled work uses the host scheduler to invoke the same commands. An MCP adapter or remote runner may be added later only as an optional wrapper around the same operations.
- **Project-owned data.** Context, saved results and reports live in the website's own `.agenticseo/` folder in documented formats. Selected files can be versioned and shared with Git; concurrent writes to one database from several machines are not supported.
- **No accounts.** No sign-up, workspaces, permissions, subscriptions or credit resale. Providers bill the user directly.
- **The user's agent is the interface.** OpenSEO's in-app chat is not reproduced; its workflows are skills any Agent Skills client can load. Commands stay agent-neutral: JSON on stdout, errors on stderr, documented exit codes.
- **No gates on spending.** Paid commands report their cost and never require a budget or approval step. Those choices belong to the user and their agent.

## Architecture

```text
User -> coding agent (skills + file tools)
                 |
                 v
                CLI (src/cli.ts) -> operations (src/*.ts)
                                       |          |          |
                              providers (src/openseo/)  SQLite  files in .agenticseo/
```

- `src/cli.ts` parses arguments and prints results. `src/*.ts` hold the operations: one module per area (keywords, domain, backlinks, local, audit, rank, ai, gsc, ga4, overview).
- `src/openseo/` holds source adapted from OpenSEO. Each file names its upstream path and commit, keeps OpenSEO's MIT notice and lists its local changes. `src/openseo/platform.ts` stands in for the Worker-bound modules the adapted code imports (errors, environment); it is the one place that decides what they mean locally.
- Code is TypeScript on Node, so OpenSEO's Zod schemas, DataForSEO shaping, issue detectors and rank logic port with small changes. Cloudflare Workers, R2, KV, Durable Objects, billing context and the Web UI are replaced, not simulated.

## Local state

Everything for a site lives in `.agenticseo/` inside it:

| Path | Written by | Contents | Git |
| --- | --- | --- | --- |
| `project.json` | `init`, `gsc use`, `ga4 use` | Domain, market, Search Console and GA4 selection | versionable |
| `context.json` | people and agents | Business context and research log, in OpenSEO's field names and limits | versionable |
| `reports/`, `templates/` | people and agents | Markdown reports with HTML pages; report templates | versionable |
| `exports/` | export commands | CSV and JSON lines | versionable |
| `evidence/` | paid commands | Raw provider responses with time, source and cost | ignored |
| `cache/` | paid commands | Provider responses keyed by request, market and scope, with expiry | ignored |
| `data/agenticseo.db` | commands | SQLite: saved keywords, metrics, audits, rank history, backlink snapshots | ignored |

Who writes what follows one rule. Free-form content that people or agents author (context, reports, templates) is files they edit with their own tools, and the CLI validates and indexes it. Structured data with keys and queries lives in the database and changes only through commands; agents read it through command output, `agenticseo query` (read-only SQL) or exports. Provider evidence is written only by the CLI, which knows its true time, source and cost.

**SQLite, through Node's built-in `node:sqlite`.** A cross-process comparison with DuckDB chose it: SQLite lets a reader see committed rows while another process writes, and DuckDB refuses a second process while a writer holds the file. The database runs in WAL mode with a 5-second busy timeout, and writes use short `BEGIN IMMEDIATE` transactions. The schema version is `PRAGMA user_version`, re-checked under the write lock so concurrent first runs migrate once. Converting a fresh database to WAL can fail at once with `SQLITE_BUSY` when several processes start together, so that one statement is retried within the same budget. Tests cover waiting writers, concurrent migration and a dozen processes converting one database at the same moment. Shared writes over network filesystems are not supported.

**Credentials never enter a project.** Provider keys come from environment variables. Google grants live in an owner-only file in the user's config directory, `~/.config/agenticseo/google-accounts.json`, as gcloud and gh keep theirs.

## Providers

- **Validation.** Every provider response is parsed against a schema before use. An unusable response is a provider failure (exit 4), never an empty result. Missing metrics stay `null`, not 0.
- **Costs.** Each paid command reports what DataForSEO charged, including for failed calls that were still billed. Estimates such as `rank estimate` use OpenSEO's price table; actual charges ran about 20% higher in our checks, and runs record the actual amount.
- **Batches.** Bulk commands (`research`, `serp`, `local grid`, `ai brand`) run each item on its own and report failed items. A rejected key stops the batch, because every other item would fail the same way; a batch where every item failed fails the command.
- **Output size.** Command output is sized for an agent's context. Large results show their first rows or a summary, and the evidence file keeps everything.
- **Network.** `src/cli.ts` enables Node's environment proxy support at startup, so `HTTPS_PROXY`, `HTTP_PROXY` and `NO_PROXY` apply to every request, as they do for curl.

## Long-running work

- **Site audits** run the ported crawler unchanged: discovery, URL safety policy, page analysis, cross-page checks and the 429 throttle. Only OpenSEO's Workflow and Durable Object orchestration is replaced. `audit start` launches a detached worker, or runs in the foreground with `--wait`. The URL frontier lives in SQLite (pending, leased, crawled), and each batch of 25 pages commits in one transaction. Pages and issues have ids derived from the audit and URL, so a repeated write changes nothing. A worker proves ownership with a token on every write and a heartbeat every 5 seconds. A run is interrupted when its heartbeat is over 30 seconds old or its process has exited. `audit resume` takes ownership, returns the dead worker's leases and continues from the recorded phase. Stored Lighthouse results act as checkpoints, so a resumed audit does not pay for them twice.
- **Rank checks.** Manual runs use DataForSEO's live endpoint. Scheduled checks use its task queue, about 70% cheaper, and poll for up to about 15 minutes before checking unfinished keywords live. Task ids are stored as soon as they are posted, so a killed run is adopted by the next `rank due` without paying again. The next-check time acts as a compare-and-set claim, so overlapping schedulers do not double-run a tracker. The CLI prints a crontab line and never edits the system scheduler.
- **Google** uses the user's own Desktop OAuth client with the installed-app flow (PKCE and a one-time loopback redirect). Tokens refresh on use, and no service stays running. The client is checked with Google before the consent page opens, so a wrong ID or secret fails in the terminal.

## Skills

The ten skills in `.agents/skills/` adapt OpenSEO's skills. MCP tool calls become `agenticseo` commands, and context patch operations become edits to `context.json` validated by `agenticseo context`. Skills explain how to investigate and interpret; they do not repeat computations the commands already do. Every workflow delivers through `seo-report`, which writes Markdown plus one self-contained HTML page from `seo-report/template.html`; `agenticseo reports` refuses HTML that loads anything remote.

## Verification and releases

- `npm run check` builds and runs the fixture-backed tests. Tests never make paid calls; local HTTP servers stand in for crawled sites and a mock `fetch` for providers.
- `scripts/live-check.mjs` runs every command against real providers in a temporary project, reads back each mutation and checks each export. It costs about $1.20 and is run by hand before a release. `scripts/upstream-coverage.mjs` lists upstream modules the [parity inventory](openseo-parity.md) never names.
- Releases are GitHub releases built by `.github/workflows/release.yml` from a version tag, with the packed CLI as `agenticseo.tgz`. A global install from a git URL cannot work: npm runs the git dependency's build with the global flag inherited, so TypeScript is never installed. The package is `private` and is not published to the npm registry.
- Pi is the only agent client tested so far.
