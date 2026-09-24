// Adapted from OpenSEO src/server/features/dashboard/services/DashboardService.ts,
// src/server/features/dashboard/repositories/BacklinkSnapshotRepository.ts and the
// dashboard's GSC and GA4 cards (src/serverFunctions/ga4.ts getGa4DashboardReport)
// at commit 0ffff93101043aad7600a3b6a499a0cd2887ef49.
// Copyright (c) 2026 Ben Senescu. MIT License; see LICENSES/OpenSEO.txt.
// Local changes: one command returns the whole dashboard. The backlink snapshot
// refreshes only on --refresh-backlinks, never as a side effect of reading, and a
// failed refresh fails the command instead of falling back to the stale snapshot.
// Search Console and GA4 failures fail the command; only a project that was never
// connected reads as not connected. Every rank tracker is summarized (upstream reads
// at most five). Activation and onboarding steps are Web UI state and are dropped.
import { sort } from "remeda";
import { analyticsOverview } from "./ga4.js";
import { searchConsoleReport } from "./gsc.js";
import { createDataforseoClient, ledgerCost, type ProviderCall } from "./openseo/dataforseo/client.js";
import { normalizeBacklinksTarget } from "./openseo/dataforseoBacklinksTarget.js";
import { shiftGa4Date } from "./openseo/ga4/Ga4Dates.js";
import { getLatestResults } from "./openseo/rank-tracking/rankTrackingResults.js";
import { AUDIT_ISSUE_TYPES, ISSUE_SEVERITY_ORDER, type AuditIssueType, type IssueSeverity } from "./openseo/shared/audit-issues.js";
import { readProject, saveEvidence } from "./project.js";
import { withStore, type Store } from "./store.js";
import { workerAlive } from "./worker.js";

// Upstream refreshes once a day per project; the same age marks a snapshot stale here.
const SNAPSHOT_MAX_AGE_MS = 24 * 60 * 60 * 1000;
const REFRESH = "agenticseo overview --refresh-backlinks";

function rankSummary(db: Store) {
  const configs = db.prepare(`SELECT id FROM rank_tracking_configs WHERE is_active = 1 ORDER BY created_at, rowid`).all() as Array<{ id: string }>;
  if (configs.length === 0) return null;
  const summary = { trackers: configs.length, trackedKeywords: 0, improved: 0, declined: 0, top10: 0, lastCheckedAt: null as string | null };
  for (const { id } of configs) {
    const result = getLatestResults(db, id, "7d");
    summary.trackedKeywords += result.rows.length;
    const checkedAt = result.run?.lastCheckedAt;
    if (checkedAt && (!summary.lastCheckedAt || checkedAt > summary.lastCheckedAt)) summary.lastCheckedAt = checkedAt;
    for (const row of result.rows) {
      for (const device of ["desktop", "mobile"] as const) {
        const { position, previousPosition } = row[device];
        if (position !== null && position <= 10) summary.top10 += 1;
        if (position === null || previousPosition === null) continue;
        // Lower position number = better ranking.
        if (position < previousPosition) summary.improved += 1;
        else if (position > previousPosition) summary.declined += 1;
      }
    }
  }
  return summary;
}

function auditSummary(db: Store) {
  const audit = db.prepare(`SELECT id, status, pages_crawled, started_at, worker_pid, heartbeat_at FROM audits ORDER BY started_at DESC LIMIT 1`).get() as
    | { id: string; status: string; pages_crawled: number; started_at: string; worker_pid: number | null; heartbeat_at: string | null }
    | undefined;
  if (!audit) return null;
  const types = db
    .prepare(`SELECT issue_type, severity, COUNT(DISTINCT page_url) AS pages FROM audit_issues WHERE audit_id = ? GROUP BY issue_type, severity`)
    .all(audit.id) as Array<{ issue_type: AuditIssueType; severity: IssueSeverity; pages: number }>;
  const sorted = sort(types, (a, b) => ISSUE_SEVERITY_ORDER[a.severity] - ISSUE_SEVERITY_ORDER[b.severity] || b.pages - a.pages);
  return {
    id: audit.id,
    status: audit.status === "running" && !workerAlive(audit) ? "interrupted" : audit.status,
    pagesCrawled: audit.pages_crawled,
    startedAt: audit.started_at,
    // Top issue types by severity then affected-page count.
    topIssues: sorted.slice(0, 3).map((row) => ({ issueType: row.issue_type, title: AUDIT_ISSUE_TYPES[row.issue_type].title, severity: row.severity, pages: row.pages })),
    totalIssueTypes: sorted.length,
  };
}

type SnapshotRow = {
  domain: string;
  rank: number | null;
  backlinks: number | null;
  referring_domains: number | null;
  broken_backlinks: number | null;
  new_backlinks: number | null;
  lost_backlinks: number | null;
  new_referring_domains: number | null;
  lost_referring_domains: number | null;
  captured_at: string;
};

// id, not captured_at: autoincrement is monotonic.
const latestSnapshot = (db: Store) => db.prepare(`SELECT * FROM backlink_snapshots ORDER BY id DESC LIMIT 1`).get() as SnapshotRow | undefined;
const isFresh = (row: SnapshotRow) => Date.now() - Date.parse(row.captured_at) < SNAPSHOT_MAX_AGE_MS;

function backlinkSummary(db: Store, domain: string) {
  const row = latestSnapshot(db);
  // A snapshot of the project's previous domain says nothing about the current one.
  if (!row || row.domain !== domain) return { snapshot: null, next: REFRESH };
  const stale = !isFresh(row);
  return {
    domain: row.domain,
    rank: row.rank,
    backlinks: row.backlinks,
    referringDomains: row.referring_domains,
    brokenBacklinks: row.broken_backlinks,
    newBacklinks: row.new_backlinks,
    lostBacklinks: row.lost_backlinks,
    newReferringDomains: row.new_referring_domains,
    lostReferringDomains: row.lost_referring_domains,
    capturedAt: row.captured_at,
    stale,
    ...(stale && { next: REFRESH }),
  };
}

/**
 * The paid half of the dashboard: a whole-site DataForSEO backlinks summary, at
 * most once a day. Returns what it cost and where the raw response is kept.
 */
async function refreshBacklinkSnapshot(root: string, db: Store, domain: string) {
  const latest = latestSnapshot(db);
  if (latest && latest.domain === domain && isFresh(latest)) return { refreshed: false, reason: "The snapshot is under a day old", costUsd: 0 };
  // Dashboard totals cover the whole site, subdomains included.
  const target = normalizeBacklinksTarget(domain, { scope: "subdomains" });
  const calls: ProviderCall[] = [];
  const summary = await createDataforseoClient(calls).backlinks.summary({ target: target.apiTarget, includeSubdomains: target.includeSubdomains });
  const capturedAt = new Date().toISOString();
  db.prepare(
    `INSERT INTO backlink_snapshots (domain, rank, backlinks, referring_domains, broken_backlinks, new_backlinks, lost_backlinks, new_referring_domains, lost_referring_domains, captured_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    domain,
    summary.rank ?? null,
    summary.backlinks ?? null,
    summary.referring_domains ?? null,
    summary.broken_backlinks ?? null,
    summary.new_backlinks ?? null,
    summary.lost_backlinks ?? null,
    summary.new_referring_domains ?? summary.new_reffering_domains ?? null,
    summary.lost_referring_domains ?? summary.lost_reffering_domains ?? null,
    capturedAt,
  );
  const costUsd = ledgerCost(calls);
  const evidence = await saveEvidence(root, capturedAt, { provider: "DataForSEO", fetchedAt: capturedAt, domain, costUsd, calls });
  return { refreshed: true, provider: "DataForSEO", costUsd, evidence };
}

const metric = (row: Record<string, string | number | null> | null, name: string) => {
  const value = row?.[name];
  return typeof value === "number" ? value : null;
};

/** GA4 omits days without organic sessions; zero-fill them so the trend covers every day of the range. */
function fillDailySessions(rows: Array<Record<string, string | number | null>>, range: { startDate: string; endDate: string }) {
  const sessionsByDate = new Map<string, number>();
  for (const row of rows) {
    // GA4's `date` dimension is YYYYMMDD; the range dates are YYYY-MM-DD.
    if (typeof row.date !== "string" || typeof row.sessions !== "number") continue;
    sessionsByDate.set(`${row.date.slice(0, 4)}-${row.date.slice(4, 6)}-${row.date.slice(6, 8)}`, row.sessions);
  }
  const days: Array<{ date: string; sessions: number }> = [];
  for (let date = range.startDate; date <= range.endDate; date = shiftGa4Date(date, 1)) days.push({ date, sessions: sessionsByDate.get(date) ?? 0 });
  return days;
}

async function analyticsCard(root: string) {
  const overview = await analyticsOverview(root, {});
  const totals = (row: Record<string, string | number | null> | null) => ({
    sessions: metric(row, "sessions"),
    activeUsers: metric(row, "activeUsers"),
    engagementRate: metric(row, "engagementRate"),
    keyEvents: metric(row, "keyEvents"),
  });
  return {
    connected: true,
    propertyId: overview.source.propertyId,
    range: overview.request.resolvedDateRange,
    totals: totals(overview.current),
    prevTotals: totals(overview.previous),
    trend: fillDailySessions(overview.trend, overview.request.resolvedDateRange),
  };
}

async function searchConsoleCard(root: string) {
  const { siteUrl, range, totals, prevTotals } = await searchConsoleReport(root, { dateRange: "last_28_days" });
  return { connected: true, siteUrl, range, totals, prevTotals };
}

/** OpenSEO's project dashboard: rank, audit, backlink, Search Console and GA4 summaries. */
export async function projectOverview(root: string, input: { refreshBacklinks: boolean }) {
  const project = await readProject(root);
  return withStore(root, async (db) => {
    const backlinksRefresh = input.refreshBacklinks ? await refreshBacklinkSnapshot(root, db, project.domain) : undefined;
    const [searchConsole, analytics] = await Promise.all([
      project.searchConsole ? searchConsoleCard(root) : { connected: false, next: "agenticseo google connect, then agenticseo gsc use SITE" },
      project.analytics ? analyticsCard(root) : { connected: false, next: "agenticseo google connect --for analytics, then agenticseo ga4 use PROPERTY" },
    ]);
    return {
      domain: project.domain,
      rank: rankSummary(db),
      audit: auditSummary(db),
      backlinks: backlinkSummary(db, project.domain),
      ...(backlinksRefresh && { backlinksRefresh }),
      searchConsole,
      analytics,
    };
  });
}
