import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { once } from "node:events";
import { closeSync, openSync } from "node:fs";
import { rm } from "node:fs/promises";
import { join } from "node:path";
import { OperationError } from "./errors.js";
import { toCsv, toJsonl, writeExport } from "./export.js";
import { normalizeAndValidateStartUrl, resolveStartUrlRedirects } from "./openseo/audit/url-policy.js";
import { AUDIT_ISSUE_TYPES, ISSUE_SEVERITY_ORDER, type AuditIssueType, type IssueSeverity } from "./openseo/shared/audit-issues.js";
import type { PageFetchClass } from "./openseo/shared/audit-fetch-class.js";
import { runSiteAudit, type AuditRunConfig } from "./openseo/workflows/siteAuditRunner.js";
import { workerAlive } from "./worker.js";
import { getRequiredEnvValue } from "./openseo/platform.js";
import { readStoredLighthousePayload } from "./openseo/lighthousePayload.js";
import type { LighthouseCategory } from "./openseo/shared/lighthouse.js";
import { dataDirectory, readProject } from "./project.js";
import { transaction, withStore, type Store } from "./store.js";

type AuditRow = {
  id: string;
  start_url: string;
  status: "running" | "completed" | "failed";
  config: string;
  current_phase: string;
  pages_crawled: number;
  pages_total: number;
  lighthouse_total: number;
  error_detail: string | null;
  worker_pid: number | null;
  heartbeat_at: string | null;
  started_at: string;
  completed_at: string | null;
};

const logFile = async (root: string, auditId: string) => join(await dataDirectory(root), `audit-${auditId}.log`);

/** The given audit, or the latest one when no id is given (as OpenSEO's audit tools default). */
function findAudit(db: Store, auditId?: string) {
  const row = (auditId ? db.prepare(`SELECT * FROM audits WHERE id = ?`).get(auditId) : db.prepare(`SELECT * FROM audits ORDER BY started_at DESC LIMIT 1`).get()) as
    | AuditRow
    | undefined;
  if (!row) throw new OperationError("input", auditId ? `No audit ${auditId} in this project` : "No audits in this project; run 'agenticseo audit start'");
  return row;
}

const liveStatus = (row: AuditRow) => (row.status === "running" && !workerAlive(row) ? "interrupted" : row.status);

/** Validate the target (URL policy and redirects, as OpenSEO's AuditService does), record the audit and run it. */
export async function startAudit(root: string, input: { url?: string; maxPages: number; allowPrivate: boolean; lighthouse: boolean; wait: boolean }) {
  // Lighthouse is billed by DataForSEO: a missing key fails now, not after the crawl.
  if (input.lighthouse) await getRequiredEnvValue("DATAFORSEO_API_KEY");
  const policy = { allowPrivate: input.allowPrivate };
  const target = input.url ?? `https://${(await readProject(root)).domain}/`;
  const startUrl = await resolveStartUrlRedirects(await normalizeAndValidateStartUrl(target, policy), policy);
  const config: AuditRunConfig = { maxPages: input.maxPages, allowPrivate: input.allowPrivate, lighthouse: input.lighthouse };
  const auditId = randomUUID();
  const token = randomUUID();
  const now = new Date().toISOString();
  await withStore(root, (db) =>
    db
      .prepare(`INSERT INTO audits (id, start_url, status, config, current_phase, worker_token, heartbeat_at, started_at) VALUES (?, ?, 'running', ?, 'discovery', ?, ?, ?)`)
      .run(auditId, startUrl, JSON.stringify(config), token, now, now),
  );
  return launch(root, auditId, token, input.wait);
}

/** Continue an interrupted or failed audit from its recorded phase. */
export async function resumeAudit(root: string, auditId: string, wait: boolean) {
  const token = randomUUID();
  await withStore(root, (db) =>
    transaction(db, () => {
      const row = findAudit(db, auditId);
      if (row.status === "completed") throw new OperationError("input", `Audit ${auditId} is already completed`);
      if (row.status === "running" && workerAlive(row)) {
        throw new OperationError("input", `Audit ${auditId} is still running (process ${row.worker_pid ?? "starting"}); check it with 'agenticseo audit status ${auditId}'`);
      }
      db.prepare(
        `UPDATE audits SET status = 'running', error_detail = NULL, completed_at = NULL, worker_token = ?, worker_pid = NULL, heartbeat_at = ? WHERE id = ?`,
      ).run(token, new Date().toISOString(), auditId);
    }),
  );
  return launch(root, auditId, token, wait);
}

/** Run the audit in this process (--wait) or in a detached worker that logs to the project's data directory. */
async function launch(root: string, auditId: string, token: string, wait: boolean) {
  if (wait) {
    await runAuditWorker(root, auditId, token);
    return auditStatus(root, auditId);
  }
  const log = openSync(await logFile(root, auditId), "a");
  try {
    const child = spawn(process.execPath, [...process.execArgv, process.argv[1], "audit", "_run", auditId, token, "--project", root], {
      detached: true,
      stdio: ["ignore", log, log],
    });
    await once(child, "spawn");
    child.unref();
  } finally {
    closeSync(log);
  }
  return auditStatus(root, auditId);
}

/** The worker entry point: `audit _run` in a detached process, or the foreground of --wait. */
export async function runAuditWorker(root: string, auditId: string, token: string) {
  await withStore(root, (db) => runSiteAudit(db, auditId, token));
}

/** One audit's progress, or the latest audit's when no id is given. */
export async function auditStatus(root: string, auditId?: string) {
  return withStore(root, async (db) => {
    const row = findAudit(db, auditId);
    const status = liveStatus(row);
    const issues =
      row.status === "completed"
        ? Object.fromEntries(
            (db.prepare(`SELECT severity, COUNT(*) AS count FROM audit_issues WHERE audit_id = ? GROUP BY severity`).all(row.id) as Array<{ severity: string; count: number }>).map(
              (entry) => [entry.severity, entry.count],
            ),
          )
        : undefined;
    const next = {
      running: `agenticseo audit status ${row.id}`,
      interrupted: `agenticseo audit resume ${row.id}`,
      failed: `agenticseo audit resume ${row.id}`,
      completed: `agenticseo audit issues ${row.id}`,
    }[status];
    const config = JSON.parse(row.config) as AuditRunConfig;
    const lighthouse = config.lighthouse
      ? {
          total: row.lighthouse_total,
          ...(db
            .prepare(
              `SELECT COUNT(*) FILTER (WHERE error_message IS NULL) AS completed, COUNT(*) FILTER (WHERE error_message IS NOT NULL) AS failed,
                      ROUND(COALESCE(SUM(cost_usd), 0), 6) AS costUsd
               FROM audit_lighthouse_results WHERE audit_id = ?`,
            )
            .get(row.id) as { completed: number; failed: number; costUsd: number }),
        }
      : undefined;
    return {
      id: row.id,
      startUrl: row.start_url,
      status,
      phase: row.current_phase,
      pagesCrawled: row.pages_crawled,
      pagesTotal: row.pages_total,
      maxPages: config.maxPages,
      lighthouse,
      startedAt: row.started_at,
      completedAt: row.completed_at,
      error: row.error_detail,
      issues,
      log: await logFile(root, row.id),
      next,
    };
  });
}

/** An audit's issues, severity-first (so a limit drops info rows before critical ones), then by type and URL. */
function selectIssues(db: Store, auditId: string, filters: { severity?: IssueSeverity; issueType?: string } = {}) {
  const rows = db
    .prepare(
      `SELECT severity, issue_type, page_url, details_json FROM audit_issues
       WHERE audit_id = ? AND (? IS NULL OR severity = ?) AND (? IS NULL OR issue_type = ?)
       ORDER BY issue_type, page_url`,
    )
    .all(auditId, filters.severity ?? null, filters.severity ?? null, filters.issueType ?? null, filters.issueType ?? null) as Array<{
    severity: IssueSeverity;
    issue_type: AuditIssueType;
    page_url: string;
    details_json: string | null;
  }>;
  return rows
    .sort((a, b) => ISSUE_SEVERITY_ORDER[a.severity] - ISSUE_SEVERITY_ORDER[b.severity])
    .map((row) => ({
      severity: row.severity,
      issueType: row.issue_type,
      url: row.page_url,
      details: row.details_json === null ? null : (JSON.parse(row.details_json) as unknown),
    }));
}

/**
 * OpenSEO's get_audit_issues, with a per-type summary. Each type's how-to-fix is
 * given once in the summary instead of on every row.
 */
export async function auditIssues(root: string, input: { auditId?: string; severity?: IssueSeverity; issueType?: string; limit: number }) {
  if (input.issueType !== undefined && !(input.issueType in AUDIT_ISSUE_TYPES)) {
    throw new OperationError("input", `Unknown issue type ${input.issueType}; use one of ${Object.keys(AUDIT_ISSUE_TYPES).join(", ")}`);
  }
  return withStore(root, (db) => {
    const audit = findAudit(db, input.auditId);
    const rows = selectIssues(db, audit.id, input);
    const counts = new Map<AuditIssueType, number>();
    for (const row of rows) counts.set(row.issueType, (counts.get(row.issueType) ?? 0) + 1);
    const summary = Array.from(counts, ([issueType, count]) => {
      const { severity, title, howToFix } = AUDIT_ISSUE_TYPES[issueType];
      return { issueType, severity, title, count, howToFix };
    }).sort((a, b) => ISSUE_SEVERITY_ORDER[a.severity] - ISSUE_SEVERITY_ORDER[b.severity] || b.count - a.count);
    const status = liveStatus(audit);
    return {
      auditId: audit.id,
      startUrl: audit.start_url,
      status,
      ...(status !== "completed" && {
        note: "The audit has not completed: these are the checks on pages crawled so far. Duplicate, redirect, broken-link and orphan checks run when it completes.",
      }),
      total: rows.length,
      shown: Math.min(rows.length, input.limit),
      summary,
      issues: rows.slice(0, input.limit),
    };
  });
}
/** OpenSEO's get_audit_pages: crawled pages with their SEO fields; `query` reads every column. */
export async function auditPages(root: string, input: { auditId?: string; fetchClass?: PageFetchClass; statusCode?: number; urlContains?: string; limit: number }) {
  return withStore(root, (db) => {
    const audit = findAudit(db, input.auditId);
    const rows = db
      .prepare(
        `SELECT url, status_code, fetch_class, redirect_url, title, meta_description, word_count, is_indexable,
                crawl_depth, in_sitemap, internal_link_count, response_time_ms
         FROM audit_pages
         WHERE audit_id = ? AND (? IS NULL OR fetch_class = ?) AND (? IS NULL OR status_code = ?) AND (? IS NULL OR instr(url, ?) > 0)
         ORDER BY rowid`,
      )
      .all(
        audit.id,
        input.fetchClass ?? null,
        input.fetchClass ?? null,
        input.statusCode ?? null,
        input.statusCode ?? null,
        input.urlContains ?? null,
        input.urlContains ?? null,
      ) as Array<Record<string, string | number | null>>;
    return {
      auditId: audit.id,
      total: rows.length,
      shown: Math.min(rows.length, input.limit),
      pages: rows.slice(0, input.limit).map((row) => ({
        url: row.url,
        statusCode: row.status_code,
        fetchClass: row.fetch_class,
        redirectUrl: row.redirect_url,
        title: row.title,
        metaDescription: row.meta_description,
        wordCount: row.word_count,
        isIndexable: row.is_indexable === 1,
        crawlDepth: row.crawl_depth,
        inSitemap: row.in_sitemap === 1,
        internalLinkCount: row.internal_link_count,
        responseTimeMs: row.response_time_ms,
      })),
    };
  });
}

/** OpenSEO's list_site_audits, newest first. */
export async function listAudits(root: string) {
  return withStore(root, (db) => ({
    audits: (db.prepare(`SELECT * FROM audits ORDER BY started_at DESC`).all() as AuditRow[]).map((row) => ({
      id: row.id,
      startUrl: row.start_url,
      status: liveStatus(row),
      pagesCrawled: row.pages_crawled,
      pagesTotal: row.pages_total,
      startedAt: row.started_at,
      completedAt: row.completed_at,
    })),
  }));
}

/**
 * OpenSEO's delete_site_audit: the audit, its pages, issues and crawl state, and its
 * log. A running worker finds its audit gone at its next write and stops.
 */
export async function deleteAudit(root: string, auditId: string) {
  const status = await withStore(root, (db) =>
    transaction(db, () => {
      const status = liveStatus(findAudit(db, auditId));
      db.prepare(`DELETE FROM audits WHERE id = ?`).run(auditId);
      return status;
    }),
  );
  await rm(await logFile(root, auditId), { force: true });
  return { auditId, deleted: true, stoppedWorker: status === "running" };
}

/**
 * OpenSEO's audit results export (src/client/features/audit/results/export.ts): the
 * issues, pages or Lighthouse performance table with the same CSV columns and JSON
 * fields, as CSV or JSON lines.
 */
export async function exportAudit(root: string, input: { auditId?: string; table: "issues" | "pages" | "performance"; format: "csv" | "jsonl"; out?: string }) {
  const { auditId, rowCount, content } = await withStore(root, (db) => {
    const audit = findAudit(db, input.auditId);
    if (input.table === "issues") {
      const rows = selectIssues(db, audit.id).map((row) => {
        const { title, howToFix } = AUDIT_ISSUE_TYPES[row.issueType];
        return { severity: row.severity, issueType: row.issueType, issue: title, url: row.url, details: row.details, howToFix };
      });
      const csv = () =>
        toCsv(
          ["Severity", "Issue", "URL", "Details", "How To Fix"],
          rows.map((row) => [row.severity, row.issue, row.url, row.details === null ? "" : JSON.stringify(row.details), row.howToFix]),
        );
      return { auditId: audit.id, rowCount: rows.length, content: input.format === "csv" ? csv() : toJsonl(rows) };
    }
    if (input.table === "performance") {
      const rows = selectLighthouse(db, audit.id).map((row) => ({
        url: row.url,
        strategy: row.strategy,
        performance: row.performance_score,
        accessibility: row.accessibility_score,
        seo: row.seo_score,
        lcpMs: row.lcp_ms,
        cls: row.cls,
        inpMs: row.inp_ms,
        ttfbMs: row.ttfb_ms,
      }));
      const csv = () =>
        toCsv(
          ["URL", "Device", "Performance", "Accessibility", "SEO", "LCP (ms)", "CLS", "INP (ms)", "TTFB (ms)"],
          rows.map((row) => [row.url, row.strategy, row.performance, row.accessibility, row.seo, row.lcpMs, row.cls, row.inpMs, row.ttfbMs]),
        );
      return { auditId: audit.id, rowCount: rows.length, content: input.format === "csv" ? csv() : toJsonl(rows) };
    }
    const rows = db
      .prepare(
        `SELECT url, status_code AS statusCode, title, h1_count AS h1Count, word_count AS wordCount, images_total AS imagesTotal,
                images_missing_alt AS imagesMissingAlt, response_time_ms AS responseTimeMs
         FROM audit_pages WHERE audit_id = ? ORDER BY rowid`,
      )
      .all(audit.id) as Array<{ url: string; statusCode: number | null; title: string | null; h1Count: number; wordCount: number; imagesTotal: number; imagesMissingAlt: number; responseTimeMs: number | null }>;
    const csv = () =>
      toCsv(
        ["URL", "Status", "Title", "H1", "Words", "Images", "Missing Alt", "Response Time (ms)"],
        rows.map((row) => [row.url, row.statusCode, row.title, row.h1Count, row.wordCount, row.imagesTotal, row.imagesMissingAlt, row.responseTimeMs]),
      );
    return { auditId: audit.id, rowCount: rows.length, content: input.format === "csv" ? csv() : toJsonl(rows.map((row) => ({ ...row }))) };
  });
  if (rowCount === 0) throw new OperationError("input", `Audit ${auditId} has no ${input.table}; nothing to export`);
  const file = await writeExport(root, { name: `audit-${input.table}`, format: input.format, content, out: input.out });
  return { auditId, table: input.table, file, format: input.format, rowCount };
}

type LighthouseRow = {
  id: string;
  url: string;
  strategy: "mobile" | "desktop";
  performance_score: number | null;
  accessibility_score: number | null;
  best_practices_score: number | null;
  seo_score: number | null;
  lcp_ms: number | null;
  cls: number | null;
  inp_ms: number | null;
  ttfb_ms: number | null;
  error_message: string | null;
  payload_json: string | null;
  cost_usd: number;
  fetched_at: string;
};

function selectLighthouse(db: Store, auditId: string) {
  return db
    .prepare(
      `SELECT r.*, p.url FROM audit_lighthouse_results r JOIN audit_pages p ON p.id = r.page_id
       WHERE r.audit_id = ? ORDER BY p.rowid, r.strategy DESC`,
    )
    .all(auditId) as LighthouseRow[];
}

/** Every Lighthouse check's scores and Core Web Vitals, with its result id and issue count. */
export async function lighthouseResults(root: string, auditId?: string) {
  return withStore(root, (db) => {
    const audit = findAudit(db, auditId);
    const rows = selectLighthouse(db, audit.id);
    return {
      auditId: audit.id,
      costUsd: Math.round(rows.reduce((sum, row) => sum + row.cost_usd, 0) * 1e6) / 1e6,
      results: rows.map((row) => ({
        resultId: row.id,
        url: row.url,
        strategy: row.strategy,
        scores: { performance: row.performance_score, accessibility: row.accessibility_score, bestPractices: row.best_practices_score, seo: row.seo_score },
        lcpMs: row.lcp_ms,
        cls: row.cls,
        inpMs: row.inp_ms,
        ttfbMs: row.ttfb_ms,
        issueCount: row.payload_json === null ? null : readStoredLighthousePayload(row.payload_json).report.issues.length,
        error: row.error_message,
      })),
    };
  });
}

/** One Lighthouse check's issues, largest savings first (OpenSEO's getAuditLighthouseIssues). */
export async function lighthouseIssues(root: string, input: { auditId?: string; resultId: string; category?: LighthouseCategory }) {
  return withStore(root, (db) => {
    const audit = findAudit(db, input.auditId);
    const row = selectLighthouse(db, audit.id).find((candidate) => candidate.id === input.resultId);
    if (!row) throw new OperationError("input", `No Lighthouse result ${input.resultId} in audit ${audit.id}`);
    if (row.payload_json === null) throw new OperationError("input", `Lighthouse result ${row.id} failed: ${row.error_message}`);
    const { storedPayload, report } = readStoredLighthousePayload(row.payload_json, input.category);
    return {
      auditId: audit.id,
      resultId: row.id,
      finalUrl: storedPayload?.metadata.finalUrl ?? row.url,
      strategy: row.strategy,
      fetchedAt: row.fetched_at,
      category: input.category ?? "all",
      hasIssueDetails: report.hasIssueDetails,
      scores: storedPayload?.scores ?? null,
      metrics: storedPayload?.metrics ?? null,
      issues: report.issues,
    };
  });
}
