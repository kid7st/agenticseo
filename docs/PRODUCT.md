# Product scope

## Goal

Build an open-source, agent-first SEO product that delivers OpenSEO's SEO capabilities through a portable core, local-first commands and portable agent skills, with project-owned data and no mandatory OpenSEO server. Full SEO capability parity is the destination; phases in the plan are delivery order, not a reduced product goal. The product must be useful to agents beyond Pi and maintainable by contributors outside its founding team.

A user asks their coding agent to investigate or improve a website. Skills guide the investigation; commands supply evidence and operations; the agent can use its existing file tools to implement changes. Every capability must be usable without a browser UI. Programmatic output must remain usable without interpreting a report or scraping terminal text.

## Users and boundaries

- Primary users: developers, SEO practitioners and teams using agents to research and improve websites. Pi is the first supported development path; any agent able to run commands should be able to use the product. Local-first does not mean single-user-only.
- The CLI runs on demand. It may call external APIs. Scheduled or remote work can invoke the same operations without introducing a required web service.
- Project context, saved results, and reports live in a project-owned directory with portable, documented formats. API credentials live outside the project or in environment variables, never in project files. Projects can be shared using ordinary version control for selected files; concurrent editing of one local history database is not promised.
- No hosted-account signup, workspace membership, team permissions, subscriptions, credit resale, referrals, or required Web UI. Provider usage fees and quotas still apply. Optional integrations must not turn into a mandatory hosted account.
- OpenSEO's in-app SAM chat interface is not reproduced. Its underlying SEO workflows must be available to the user's existing agent through local commands and skills; chat UI/session parity is outside scope.

## Capability inventory

This inventory covers both OpenSEO MCP and application-only SEO features. The implementation phase is recorded in [PLAN.md](PLAN.md). Validate the list against the upstream version pinned at the start of implementation; a tool list alone does not cover the whole product.

| Capability | Required behavior | Current OpenSEO reference |
| --- | --- | --- |
| Projects and context | Project target, market/language, positioning, competitors, important pages, preferences, research log | `src/server/features/projects`, `src/server/features/project-context` |
| Keywords | Discover and enrich keywords, volume/difficulty/CPC/intent/trends, inspect SERPs, save/tag/remove/export terms | `src/server/features/keywords`, `src/server/mcp/tools/research-keywords.ts` |
| Domain and competitors | Domain overview, ranking keywords and pages, comparative SERP competitors, research scopes and markets | `src/server/features/domain`, `src/server/mcp/tools/dataforseo-research-tools.ts` |
| Backlinks | Profiles, referring domains/pages, filters, historical signals where available, Ahrefs public domain rating enrichment | `src/server/features/backlinks`, `src/serverFunctions/ahrefs.ts` |
| Local SEO | Business search/profile, Maps and Local Finder results, categories, reviews, posts, Q&A, local rank grid | `src/server/mcp/tools/local-seo-tools.ts`, `src/server/lib/dataforseo/business.ts` |
| AI visibility | Brand mentions/share of voice, cited sources, prompt exploration across supported providers | `src/server/features/ai-search`, `src/serverFunctions/ai-search.ts` |
| Site audit | Robots/sitemap-aware crawl, page and cross-page issues, audit history, optional Lighthouse sampling, issue and raw-result export | `src/server/features/audit`, `src/server/lib/audit`, `src/serverFunctions/lighthouse.ts` |
| Rank tracking | Configurations, keyword management, manual and scheduled checks, cost estimates, runs and position history | `src/server/features/rank-tracking`, `src/server/workflows/RankCheckWorkflow.ts` |
| Search Console | Search performance, search opportunities, URL inspection and property selection | `src/server/features/gsc`, `src/server/mcp/tools/search-console-tools.ts` |
| Google Analytics | Organic overview, landing/page performance, acquisition, events, ecommerce, site search, audience and measurement checks | `src/server/features/ga4`, `src/server/mcp/tools/google-analytics-tools.ts` |
| Reporting | Project reports, reusable briefs/templates, HTML output, listing, reading and deletion; agent skills for research/audits/reporting | `src/server/features/reports`, `src/server/mcp/tools/report-tools.ts`, `plugins/openseo/skills` |
| Cross-feature summaries | Dashboard-style summary and opportunity prioritization from the above evidence, excluding onboarding/promotional widgets | `src/server/features/dashboard`, `src/server/features/ga4/services/SearchOpportunityService.ts` |

Data access is not the same as agent workflow parity. Preserve or adapt OpenSEO's public SEO skills where useful; discoverable task workflows, not a flat list of commands, are the primary agent experience. Commands supply data and operations; the agent owns interpretation, writing, and changes to the user's website. A normal run should return a concise finding with provenance and a local evidence reference, and let the agent retrieve specific rows or pages only when needed. Paid operations do not require product-level budget approval or website-edit approval; those choices belong to the user and their agent.

## Acceptance definition

For each inventory row, demonstrate a local invocation that produces the comparable OpenSEO result for a representative fixture or authorized live project, preserves important distinctions (target scope, market, dates, source and missing data), and leaves inspectable project-local evidence. For a mutation, verify that a second invocation can read the changed state. Test a task from the user's request through to a concise agent reply in both Pi and Codex, without flooding their context with raw results.

The final parity review must also inspect OpenSEO's application-only SEO endpoints, not just its MCP registration list. Document upstream-only behavior that cannot be reproduced because of provider access, licensing, or platform limitations rather than silently calling it complete. A public release also needs a documented install path, reproducible checks, a clear license and usable agent guidance for at least one non-Pi client.
