# Product scope

## Goal

Deliver OpenSEO's SEO capabilities as local commands callable by an agent, with project-owned data and no mandatory OpenSEO server. Full capability parity is the destination; phases in the plan are delivery order, not a reduced product goal.

An agent should be able to inspect a project's context, buy only the data needed, execute research or audits, save the evidence, and use it to recommend or implement SEO improvements. Every capability must be usable without a browser UI. Programmatic output must remain usable without interpreting a report or scraping terminal text.

## Users and boundaries

- Primary user: one person working on one or more websites with a local coding agent such as Pi.
- The CLI runs on demand. It may call external APIs. Scheduled or remote work can invoke the same operations without introducing a required web service.
- Project context, saved results, and reports live in the user's project directory. API credentials live outside the project or in environment variables, never in project files.
- No hosted-account signup, workspace membership, team permissions, subscriptions, credit resale, referrals, or Web UI. Provider usage fees and quotas still apply.
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

Data access is not the same as agent workflow parity. Preserve or adapt OpenSEO's public SEO skills where useful; the CLI supplies data and operations, while the agent owns interpretation, writing, and changes to the user's website.

## Acceptance definition

For each inventory row, demonstrate a local invocation that produces the comparable OpenSEO result for a representative fixture or authorized live project, preserves important distinctions (target scope, market, dates, source and missing data), and leaves inspectable project-local evidence. For a mutation, verify that a second invocation can read the changed state. For a paid operation, show expected cost or an explicit spending limit before executing it.

The final parity review must also inspect OpenSEO's application-only SEO endpoints, not just its MCP registration list. Document upstream-only behavior that cannot be reproduced because of provider access, licensing, or platform limitations rather than silently calling it complete.
