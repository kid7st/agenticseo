// Adapted from OpenSEO src/server/workflows/SiteAuditWorkflow.ts,
// src/server/workflows/siteAuditWorkflowPhases.ts and
// src/server/workflows/siteAuditWorkflowCrawl.ts at commit
// 0ffff93101043aad7600a3b6a499a0cd2887ef49.
// Copyright (c) 2026 Ben Senescu. MIT License; see LICENSES/OpenSEO.txt.
// Local changes: one local process runs the phases in order instead of durable
// Workflow steps. The crawl leases batches of 25 URLs from the SQLite frontier and
// persists each batch in one transaction; upstream's crawl chunks, retry window,
// soft deadlines and pipelined persistence exist for Worker step, memory and time
// limits and are not ported. The worker owns the audit through a token and a
// heartbeat, so a resumed run can take over a dead worker's leases; robots.txt and
// the 429 cooldown are checkpointed on the audit row and reused on resume.
// Lighthouse results are the Lighthouse phase's checkpoint: a resumed run skips
// the checks already stored. KV progress, billing and telemetry are not ported.
import { OperationError } from "../../errors.js";
import { transaction, type Store } from "../../store.js";
import {
  claimBatch,
  dropScratch,
  frontierStats,
  insertIssues,
  linkChecks,
  recordBatch,
  releaseUrls,
  seedSitemapUrls,
  seedStart,
  slimPages,
  toIssueRows,
  type ClaimedUrl,
  type PageLinksRow,
} from "../audit/auditStore.js";
import { createCrawlThrottle, type CrawlThrottle, type CrawlThrottleState } from "../audit/crawl-throttle.js";
import { adjustCrawlWindow, CRAWL_WINDOW } from "../audit/crawl-window.js";
import { discoverUrls, parseRobotsTxt, type RobotsResult } from "../audit/discovery.js";
import { deterministicAuditRowId } from "../audit/ids.js";
import { findDuplicates, findRedirectChainsAndLoops } from "../audit/issues/multipage-checks.js";
import { runPageReporters, type DetectedIssue } from "../audit/issues/page-reporters.js";
import type { CrawledPageResult } from "../audit/types.js";
import { isCrawlableUrl, type CrawlTargetPolicy } from "../audit/url-policy.js";
import { getOrigin, isSameOrigin, normalizeUrl } from "../audit/url-utils.js";
import { fetchLighthouseResult, selectLighthouseSample } from "../audit/lighthouse.js";
import { crawlPage } from "./site-audit-workflow-helpers.js";
import { HEARTBEAT_INTERVAL_MS } from "../../worker.js";

/** URLs leased and persisted together; upstream's persist sub-batch size. */
const BATCH_SIZE = 25;
/** Cap recorded link targets per page so link-heavy templates cannot bloat finalize. */
const MAX_STORED_LINKS_PER_PAGE = 500;
/** Cap newly discovered URLs per batch; crawler-trap page families emit thousands. */
const MAX_DISCOVERED_PER_BATCH = 20_000;
/** Lighthouse checks in flight: upstream's five URLs, each mobile and desktop. */
const LIGHTHOUSE_CONCURRENCY = 10;


export type AuditRunConfig = { maxPages: number; lighthouse: boolean } & Required<CrawlTargetPolicy>;

type AuditRow = {
  start_url: string;
  config: string;
  current_phase: "discovery" | "crawling" | "lighthouse" | "finalizing" | "completed";
  robots_text: string | null;
  throttle_state: string | null;
};

/** Another command deleted or resumed the audit; this worker must stop writing. */
export class OwnershipLost extends OperationError {
  constructor(auditId: string) {
    super("input", `Audit ${auditId} was deleted or resumed by another process; this worker stopped`);
  }
}

/** Refresh the heartbeat, proving this worker still owns the running audit. */
function claim(db: Store, auditId: string, token: string) {
  const result = db
    .prepare(`UPDATE audits SET heartbeat_at = ? WHERE id = ? AND worker_token = ? AND status = 'running'`)
    .run(new Date().toISOString(), auditId, token);
  if (result.changes === 0) throw new OwnershipLost(auditId);
}

const readAudit = (db: Store, auditId: string) =>
  db.prepare(`SELECT start_url, config, current_phase, robots_text, throttle_state FROM audits WHERE id = ?`).get(auditId) as AuditRow;

/** Runs or continues an audit from its recorded phase; the caller has set `token` as the owner. */
export async function runSiteAudit(db: Store, auditId: string, token: string) {
  transaction(db, () => {
    claim(db, auditId, token);
    db.prepare(`UPDATE audits SET worker_pid = ? WHERE id = ?`).run(process.pid, auditId);
  });
  let lost: unknown;
  const heartbeat = setInterval(() => {
    try {
      claim(db, auditId, token);
    } catch (error) {
      lost = error;
    }
  }, HEARTBEAT_INTERVAL_MS);
  const owned = () => {
    if (lost) throw lost;
    claim(db, auditId, token);
  };

  try {
    const audit = readAudit(db, auditId);
    const config = JSON.parse(audit.config) as AuditRunConfig;
    if (audit.current_phase === "discovery") await runDiscoveryPhase(db, auditId, owned, audit.start_url, config);
    if (readAudit(db, auditId).current_phase === "crawling") await runCrawlPhase(db, auditId, owned, config);
    if (config.lighthouse && readAudit(db, auditId).current_phase !== "finalizing") await runLighthousePhase(db, auditId, owned);
    await finalizeAudit(db, auditId, owned);
  } catch (error) {
    // Scoped to the owner token: a worker that lost the audit cannot mark it failed.
    db.prepare(`UPDATE audits SET status = 'failed', error_detail = ?, completed_at = ? WHERE id = ? AND worker_token = ? AND status = 'running'`).run(
      (error instanceof Error ? error.message : String(error)).slice(0, 500),
      new Date().toISOString(),
      auditId,
      token,
    );
    throw error;
  } finally {
    clearInterval(heartbeat);
  }
}

async function runDiscoveryPhase(db: Store, auditId: string, owned: () => void, startUrl: string, config: AuditRunConfig) {
  const origin = getOrigin(startUrl);
  const result = await discoverUrls(origin, config.maxPages);
  const robots = parseRobotsTxt(origin, result.robotsText);
  const normalizedStart = normalizeUrl(startUrl) ?? startUrl;
  const startAllowed = robots.isAllowed(normalizedStart) && isSameOrigin(normalizedStart, origin);

  const seen = new Set<string>();
  const seeds: string[] = [];
  for (const url of result.urls) {
    const normalized = normalizeUrl(url);
    if (!normalized || seen.has(normalized)) continue;
    seen.add(normalized);
    if (!isSameOrigin(normalized, origin)) continue;
    if (!isCrawlableUrl(normalized, config)) continue;
    if (!robots.isAllowed(normalized)) continue;
    seeds.push(normalized);
  }
  const seededCount = (startAllowed ? 1 : 0) + seeds.filter((seed) => seed !== normalizedStart).length;

  // One transaction with the phase change: a rerun after interruption seeds again from scratch.
  transaction(db, () => {
    owned();
    if (startAllowed) seedStart(db, auditId, normalizedStart);
    seedSitemapUrls(db, auditId, seeds);
    db.prepare(`UPDATE audits SET robots_text = ?, pages_total = ?, current_phase = 'crawling' WHERE id = ?`).run(
      result.robotsText,
      Math.min(seededCount, config.maxPages),
      auditId,
    );
  });
}

async function runCrawlPhase(db: Store, auditId: string, owned: () => void, config: AuditRunConfig) {
  const audit = readAudit(db, auditId);
  const origin = getOrigin(audit.start_url);
  // Parsed from the checkpointed text so a resumed crawl follows the rules the frontier was built with.
  const robots = parseRobotsTxt(origin, audit.robots_text);
  const saveThrottle = (state: CrawlThrottleState) =>
    db.prepare(`UPDATE audits SET throttle_state = ? WHERE id = ?`).run(JSON.stringify(state), auditId);
  const throttle = createCrawlThrottle(
    Number.POSITIVE_INFINITY,
    audit.throttle_state ? (JSON.parse(audit.throttle_state) as CrawlThrottleState) : undefined,
    async (state) => transaction(db, () => {
      owned();
      saveThrottle(state);
    }),
  );
  // Any lease left is a dead worker's unfinished batch.
  transaction(db, () => {
    owned();
    releaseUrls(db, auditId);
  });

  let windowSize = CRAWL_WINDOW.initial;
  for (;;) {
    const stats = frontierStats(db, auditId);
    if (stats.pending === 0 || stats.attempted >= config.maxPages || throttle.stopped) return;
    const claimed = transaction(db, () => {
      owned();
      return claimBatch(db, auditId, Math.min(BATCH_SIZE, config.maxPages - stats.attempted));
    });
    const results = await crawlBatch(claimed, windowSize, throttle);
    const pages = results.filter((page): page is CrawledPageResult => page !== null);
    const deferred = claimed.filter((_, index) => results[index] === null).map((entry) => entry.url);
    await persistCrawledPages(db, auditId, owned, { pages, deferred, claimed, origin, robots, config, throttleState: throttle.state });
    windowSize = adjustCrawlWindow(windowSize, pages);
  }
}

/** Fetch a batch with at most `windowSize` requests in flight; null marks a URL a stopped cooldown deferred. */
async function crawlBatch(claimed: ClaimedUrl[], windowSize: number, throttle: CrawlThrottle) {
  const results: Array<CrawledPageResult | null> = new Array(claimed.length).fill(null);
  let next = 0;
  const lane = async () => {
    while (next < claimed.length) {
      const index = next++;
      const entry = claimed[index];
      results[index] = await crawlPage(entry.url, entry.depth, entry.inSitemap, throttle);
    }
  };
  await Promise.all(Array.from({ length: Math.min(windowSize, claimed.length) }, lane));
  return results;
}

async function persistCrawledPages(
  db: Store,
  auditId: string,
  owned: () => void,
  input: {
    pages: CrawledPageResult[];
    deferred: string[];
    claimed: ClaimedUrl[];
    origin: string;
    robots: RobotsResult;
    config: AuditRunConfig;
    throttleState: CrawlThrottleState;
  },
) {
  const { pages, origin, robots, config } = input;
  const shouldQueue = (link: string) => isSameOrigin(link, origin) && isCrawlableUrl(link, config) && robots.isAllowed(link);
  const depthByUrl = new Map(input.claimed.map((entry) => [entry.url, entry.depth]));

  // Deterministic ids keep every write idempotent when a resumed worker re-crawls a batch.
  for (const page of pages) page.id = await deterministicAuditRowId(auditId, page.url);
  const issues = await toIssueRows(auditId, pages.flatMap((page) => runPageReporters(page)));

  const links: PageLinksRow[] = [];
  const discovered = new Map<string, number | null>();
  for (const page of pages) {
    const pageDepth = depthByUrl.get(page.url) ?? null;
    const childDepth = pageDepth === null ? null : pageDepth + 1;
    const targets: string[] = [];
    for (const link of page.links) {
      if (!link.isInternal) continue;
      if (targets.length < MAX_STORED_LINKS_PER_PAGE) targets.push(link.targetUrl);
      if (discovered.size < MAX_DISCOVERED_PER_BATCH && !discovered.has(link.targetUrl) && shouldQueue(link.targetUrl)) {
        discovered.set(link.targetUrl, childDepth);
      }
    }
    if (targets.length > 0) links.push({ pageId: page.id, url: page.url, targets });
    // Redirect targets continue the same navigation path: same depth.
    if (page.redirectUrl && !discovered.has(page.redirectUrl) && shouldQueue(page.redirectUrl)) {
      discovered.set(page.redirectUrl, pageDepth);
    }
  }

  transaction(db, () => {
    owned();
    const stats = recordBatch(db, auditId, { pages, issues, links, discovered: Array.from(discovered, ([url, depth]) => ({ url, depth })) });
    releaseUrls(db, auditId, input.deferred);
    db.prepare(`UPDATE audits SET pages_crawled = ?, pages_total = ?, throttle_state = ? WHERE id = ?`).run(
      stats.attempted,
      Math.min(stats.seen, config.maxPages),
      JSON.stringify(input.throttleState),
      auditId,
    );
  });
}

/**
 * Lighthouse (mobile and desktop) on a sample: the start page plus one HTML page
 * per site section, at most ten pages (see selectLighthouseSample). Each stored result is a checkpoint, so
 * a resumed run pays only for the checks it has not stored.
 */
async function runLighthousePhase(db: Store, auditId: string, owned: () => void) {
  const audit = readAudit(db, auditId);
  const pages = db.prepare(`SELECT id, url, status_code, is_html FROM audit_pages WHERE audit_id = ? ORDER BY rowid`).all(auditId) as Array<{
    id: string;
    url: string;
    status_code: number | null;
    is_html: number;
  }>;
  const sample = new Set(
    selectLighthouseSample(
      pages.map((page) => ({ url: page.url, statusCode: page.status_code ?? 0, isHtml: page.is_html === 1 })),
      audit.start_url,
      "auto",
    ),
  );
  const checks = pages
    .filter((page) => sample.has(page.url))
    .flatMap((page) => (["mobile", "desktop"] as const).map((strategy) => ({ url: page.url, pageId: page.id, strategy })));
  transaction(db, () => {
    owned();
    db.prepare(`UPDATE audits SET current_phase = 'lighthouse', lighthouse_total = ? WHERE id = ?`).run(checks.length, auditId);
  });

  const stored = new Set(
    (db.prepare(`SELECT page_id, strategy FROM audit_lighthouse_results WHERE audit_id = ?`).all(auditId) as Array<{ page_id: string; strategy: string }>).map(
      (row) => `${row.page_id} ${row.strategy}`,
    ),
  );
  const todo = checks.filter((check) => !stored.has(`${check.pageId} ${check.strategy}`));
  const insert = db.prepare(
    `INSERT OR IGNORE INTO audit_lighthouse_results (
       id, audit_id, page_id, strategy, performance_score, accessibility_score, best_practices_score, seo_score,
       lcp_ms, cls, inp_ms, ttfb_ms, error_message, payload_json, cost_usd, fetched_at
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  );
  for (let start = 0; start < todo.length; start += LIGHTHOUSE_CONCURRENCY) {
    owned();
    const chunk = todo.slice(start, start + LIGHTHOUSE_CONCURRENCY);
    // allSettled: one check stopping the audit must not discard its siblings' billed results.
    const settled = await Promise.allSettled(chunk.map((check) => fetchLighthouseResult(check.url, check.pageId, check.strategy)));
    const fetched = settled.flatMap((outcome) => (outcome.status === "fulfilled" ? [outcome.value] : []));
    const ids = await Promise.all(fetched.map(({ result }) => deterministicAuditRowId(auditId, result.pageId, result.strategy)));
    const fetchedAt = new Date().toISOString();
    transaction(db, () => {
      owned();
      fetched.forEach(({ result, payloadJson, costUsd }, index) => {
        insert.run(
          ids[index], auditId, result.pageId, result.strategy, result.performanceScore, result.accessibilityScore, result.bestPracticesScore,
          result.seoScore, result.lcpMs, result.cls, result.inpMs, result.ttfbMs, result.errorMessage ?? null, payloadJson, costUsd, fetchedAt,
        );
      });
    });
    const rejected = settled.find((outcome) => outcome.status === "rejected");
    if (rejected) throw rejected.reason;
  }
}

async function finalizeAudit(db: Store, auditId: string, owned: () => void) {
  transaction(db, () => {
    owned();
    db.prepare(`UPDATE audits SET current_phase = 'finalizing' WHERE id = ?`).run(auditId);
  });
  const audit = readAudit(db, auditId);
  const stats = frontierStats(db, auditId);
  const rateLimited = audit.throttle_state !== null && createCrawlThrottle(0, JSON.parse(audit.throttle_state) as CrawlThrottleState).stopped;
  // Orphan detection only makes sense when the crawl was not truncated.
  const crawlCompleted = stats.pending === 0 && !rateLimited;

  const pages = slimPages(db, auditId);
  const detected: DetectedIssue[] = [
    ...findDuplicates(pages),
    ...findRedirectChainsAndLoops(pages),
    // Page rows store normalized URLs; normalize the start URL the same way so the orphan exclusion matches.
    ...linkChecks(db, auditId, { startUrl: normalizeUrl(audit.start_url) ?? audit.start_url, crawlCompleted }),
  ];
  if (rateLimited) detected.push({ issueType: "crawl-rate-limited", pageId: null, pageUrl: audit.start_url });
  const rows = await toIssueRows(auditId, detected);

  transaction(db, () => {
    owned();
    insertIssues(db, auditId, rows);
    dropScratch(db, auditId);
    db.prepare(`UPDATE audits SET status = 'completed', current_phase = 'completed', pages_total = pages_crawled, completed_at = ? WHERE id = ?`).run(
      new Date().toISOString(),
      auditId,
    );
  });
}
