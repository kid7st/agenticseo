// Adapted from OpenSEO src/server/features/audit/AuditScratchpad.ts,
// src/server/features/audit/scratchpad-sql.ts,
// src/server/features/audit/repositories/AuditRepository.ts (insertCrawledBatch,
// insertIssues) and src/server/lib/audit/issues/multipage.ts at commit
// 0ffff93101043aad7600a3b6a499a0cd2887ef49.
// Copyright (c) 2026 Ben Senescu. MIT License; see LICENSES/OpenSEO.txt.
// Local changes: the scratchpad Durable Object's frontier and link tables live in
// the project database, scoped by audit_id, and the finalize queries join
// audit_pages instead of a page mirror. The legacy per-edge links table, the
// 7-day cleanup alarm and the 500 MB link-storage budget are not ported: they
// guard Durable Object billing and size caps. Calls are synchronous (node:sqlite)
// and run inside the caller's transaction.
import type { Store } from "../../store.js";
import { AUDIT_ISSUE_TYPES } from "../shared/audit-issues.js";
import { deterministicAuditRowId } from "./ids.js";
import type { SlimPage } from "./issues/multipage-checks.js";
import type { DetectedIssue } from "./issues/page-reporters.js";
import type { CrawledPageResult } from "./types.js";

export interface ClaimedUrl {
  url: string;
  /** Clicks from the start URL; null when only reachable via sitemap. */
  depth: number | null;
  inSitemap: boolean;
}

export interface FrontierStats {
  /** Pages attempted (crawled or errored) so far. */
  attempted: number;
  /** URLs still waiting to be crawled. */
  pending: number;
  /** Every URL ever enqueued (attempted + pending + leased). */
  seen: number;
}

/** One crawled page's internal link targets, stored as one JSON row. */
export interface PageLinksRow {
  pageId: string;
  url: string;
  targets: string[];
}

export interface IssueRow {
  id: string;
  pageId: string | null;
  pageUrl: string;
  issueType: DetectedIssue["issueType"];
  severity: string;
  detailsJson: string | null;
}

const BROKEN_LINK_ISSUE_CAP = 2_000;

export function seedStart(db: Store, auditId: string, url: string) {
  db.prepare(`INSERT OR IGNORE INTO audit_frontier (audit_id, url, depth, source, in_sitemap) VALUES (?, ?, 0, 'link', 0)`).run(auditId, url);
}

/** Upsert so a URL that already exists (e.g. the start URL) still gets its in-sitemap flag. */
export function seedSitemapUrls(db: Store, auditId: string, urls: string[]) {
  const insert = db.prepare(
    `INSERT INTO audit_frontier (audit_id, url, depth, source, in_sitemap) VALUES (?, ?, NULL, 'sitemap', 1)
     ON CONFLICT (audit_id, url) DO UPDATE SET in_sitemap = 1`,
  );
  for (const url of urls) insert.run(auditId, url);
}

/**
 * Lease the next batch of pending URLs: link-discovered URLs drain before
 * sitemap-only ones, FIFO within each class.
 */
export function claimBatch(db: Store, auditId: string, limit: number): ClaimedUrl[] {
  if (limit <= 0) return [];
  const rows = db
    .prepare(
      `SELECT url, depth, in_sitemap FROM audit_frontier WHERE audit_id = ? AND state = 'pending'
       ORDER BY CASE source WHEN 'link' THEN 0 ELSE 1 END, rowid LIMIT ?`,
    )
    .all(auditId, limit) as Array<{ url: string; depth: number | null; in_sitemap: number }>;
  const lease = db.prepare(`UPDATE audit_frontier SET state = 'leased' WHERE audit_id = ? AND url = ?`);
  for (const row of rows) lease.run(auditId, row.url);
  return rows.map((row) => ({ url: row.url, depth: row.depth, inSitemap: row.in_sitemap === 1 }));
}

/** Return leased URLs to the queue: ones a stopped cooldown deferred, or all of a dead worker's. */
export function releaseUrls(db: Store, auditId: string, urls?: string[]) {
  if (urls === undefined) {
    db.prepare(`UPDATE audit_frontier SET state = 'pending' WHERE audit_id = ? AND state = 'leased'`).run(auditId);
    return;
  }
  const release = db.prepare(`UPDATE audit_frontier SET state = 'pending' WHERE audit_id = ? AND url = ? AND state = 'leased'`);
  for (const url of urls) release.run(auditId, url);
}

/** Issue rows with deterministic ids, so re-inserting a batch is a no-op. */
export async function toIssueRows(auditId: string, issues: DetectedIssue[]): Promise<IssueRow[]> {
  return Promise.all(
    issues.map(async (issue) => ({
      id: await deterministicAuditRowId(auditId, issue.pageUrl, issue.issueType, issue.dedupeKey ?? ""),
      pageId: issue.pageId,
      pageUrl: issue.pageUrl,
      issueType: issue.issueType,
      severity: AUDIT_ISSUE_TYPES[issue.issueType].severity,
      detailsJson: issue.details ? JSON.stringify(issue.details) : null,
    })),
  );
}

export function insertIssues(db: Store, auditId: string, rows: IssueRow[]) {
  const insert = db.prepare(
    `INSERT OR IGNORE INTO audit_issues (id, audit_id, page_id, page_url, issue_type, severity, details_json) VALUES (?, ?, ?, ?, ?, ?, ?)`,
  );
  for (const row of rows) insert.run(row.id, auditId, row.pageId, row.pageUrl, row.issueType, row.severity, row.detailsJson);
}

/** Persist one crawled batch: page rows, their issues, link targets, completions and newly found URLs. */
export function recordBatch(
  db: Store,
  auditId: string,
  input: { pages: CrawledPageResult[]; issues: IssueRow[]; links: PageLinksRow[]; discovered: Array<{ url: string; depth: number | null }> },
): FrontierStats {
  const insertPage = db.prepare(
    `INSERT OR REPLACE INTO audit_pages (
       id, audit_id, url, status_code, redirect_url, title, meta_description, canonical_url, robots_meta,
       og_title, og_description, og_image, h1_count, h2_count, h3_count, h4_count, h5_count, h6_count,
       heading_order_json, word_count, images_total, images_missing_alt, images_json, internal_link_count,
       external_link_count, has_structured_data, hreflang_tags_json, is_indexable, x_robots_tag,
       header_canonical_url, crawl_depth, in_sitemap, content_hash, fetch_class, response_time_ms
     ) VALUES (${Array(35).fill("?").join(", ")})`,
  );
  const crawled = db.prepare(`UPDATE audit_frontier SET state = 'crawled' WHERE audit_id = ? AND url = ?`);
  for (const page of input.pages) {
    insertPage.run(
      page.id, auditId, page.url, page.statusCode, page.redirectUrl, page.title, page.metaDescription, page.canonicalUrl, page.robotsMeta,
      page.ogTitle, page.ogDescription, page.ogImage, page.h1Count, page.h2Count, page.h3Count, page.h4Count, page.h5Count, page.h6Count,
      JSON.stringify(page.headingOrder), page.wordCount, page.imagesTotal, page.imagesMissingAlt, JSON.stringify(page.images),
      page.links.filter((link) => link.isInternal).length, page.links.filter((link) => !link.isInternal).length,
      page.hasStructuredData ? 1 : 0, JSON.stringify(page.hreflangTags), page.isIndexable ? 1 : 0, page.xRobotsTag,
      page.headerCanonicalUrl, page.crawlDepth, page.inSitemap ? 1 : 0, page.contentHash, page.fetchClass, page.responseTimeMs,
    );
    crawled.run(auditId, page.url);
  }
  insertIssues(db, auditId, input.issues);
  const insertLinks = db.prepare(`INSERT OR REPLACE INTO audit_page_links (page_id, audit_id, url, targets_json) VALUES (?, ?, ?, ?)`);
  for (const page of input.links) insertLinks.run(page.pageId, auditId, page.url, JSON.stringify(page.targets));
  // OR IGNORE: already-seen URLs (crawled, leased, or pending) keep their existing row.
  const discover = db.prepare(`INSERT OR IGNORE INTO audit_frontier (audit_id, url, depth, source, in_sitemap) VALUES (?, ?, ?, 'link', 0)`);
  for (const found of input.discovered) discover.run(auditId, found.url, found.depth);
  return frontierStats(db, auditId);
}

export function frontierStats(db: Store, auditId: string): FrontierStats {
  const row = db
    .prepare(
      `SELECT COUNT(*) FILTER (WHERE state = 'crawled') AS attempted,
              COUNT(*) FILTER (WHERE state = 'pending') AS pending,
              COUNT(*) AS seen
       FROM audit_frontier WHERE audit_id = ?`,
    )
    .get(auditId) as { attempted: number; pending: number; seen: number };
  return { attempted: row.attempted, pending: row.pending, seen: row.seen };
}

/** The page columns the duplicate and redirect checks read (multipage.ts). */
export function slimPages(db: Store, auditId: string): SlimPage[] {
  const rows = db
    .prepare(
      `SELECT id, url, status_code, fetch_class, title, meta_description, content_hash, redirect_url,
              word_count, is_indexable, canonical_url, header_canonical_url
       FROM audit_pages WHERE audit_id = ?`,
    )
    .all(auditId) as Array<Record<string, string | number | null>>;
  return rows.map((row) => ({
    id: row.id as string,
    url: row.url as string,
    statusCode: row.status_code as number | null,
    fetchClass: row.fetch_class as SlimPage["fetchClass"],
    title: row.title as string | null,
    metaDescription: row.meta_description as string | null,
    contentHash: row.content_hash as string | null,
    redirectUrl: row.redirect_url as string | null,
    wordCount: row.word_count as number,
    isIndexable: row.is_indexable === 1,
    canonicalUrl: row.canonical_url as string | null,
    headerCanonicalUrl: row.header_canonical_url as string | null,
  }));
}

/**
 * The two checks that need link edges. Broken links: every internal link whose
 * target was crawled and answered 4xx/5xx (blocked targets excluded; a WAF 403
 * is not evidence of a broken link). Orphans: a live 2xx page no other page
 * links to and nothing redirects to, only meaningful on a completed crawl.
 */
export function linkChecks(db: Store, auditId: string, input: { startUrl: string; crawlCompleted: boolean }): DetectedIssue[] {
  const broken = db
    .prepare(
      `SELECT p.page_id AS source_page_id, p.url AS source_url, j.value AS target_url, m.status_code AS target_status
       FROM audit_page_links p, json_each(p.targets_json) AS j
       CROSS JOIN audit_pages m ON m.audit_id = p.audit_id AND m.url = j.value
       WHERE p.audit_id = ? AND m.status_code >= 400 AND m.fetch_class = 'ok'
       ORDER BY source_page_id, target_url
       LIMIT ?`,
    )
    .all(auditId, BROKEN_LINK_ISSUE_CAP) as Array<{ source_page_id: string; source_url: string; target_url: string; target_status: number }>;
  const orphans = input.crawlCompleted
    ? (db
        .prepare(
          `SELECT m.id AS page_id, m.url FROM audit_pages m
           LEFT JOIN (
             SELECT DISTINCT j.value AS target_url
             FROM audit_page_links p, json_each(p.targets_json) AS j
             WHERE p.audit_id = ? AND j.value != p.url
           ) inbound ON inbound.target_url = m.url
           WHERE m.audit_id = ? AND m.url != ?
             AND m.fetch_class = 'ok'
             AND m.status_code >= 200 AND m.status_code < 300
             AND inbound.target_url IS NULL
             AND NOT EXISTS (SELECT 1 FROM audit_pages r WHERE r.audit_id = m.audit_id AND r.redirect_url = m.url)`,
        )
        .all(auditId, auditId, input.startUrl) as Array<{ page_id: string; url: string }>)
    : [];
  return [
    ...broken.map((row) => ({
      issueType: "broken-internal-link" as const,
      pageId: row.source_page_id,
      pageUrl: row.source_url,
      dedupeKey: row.target_url,
      details: { targetUrl: row.target_url, targetStatus: row.target_status },
    })),
    ...orphans.map((row) => ({ issueType: "orphan-page" as const, pageId: row.page_id, pageUrl: row.url })),
  ];
}

/** Crawl scratch state is not needed once the audit is finalized. */
export function dropScratch(db: Store, auditId: string) {
  db.prepare(`DELETE FROM audit_frontier WHERE audit_id = ?`).run(auditId);
  db.prepare(`DELETE FROM audit_page_links WHERE audit_id = ?`).run(auditId);
}
