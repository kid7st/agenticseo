import { DatabaseSync } from "node:sqlite";
import { join } from "node:path";
import { setTimeout as sleep } from "node:timers/promises";
import { OperationError } from "./errors.js";
import { dataDirectory } from "./project.js";

export type Store = DatabaseSync;

/**
 * Schema versions, applied in order and recorded in PRAGMA user_version. Tables follow
 * OpenSEO's src/db/app.schema.ts without project_id, since each project has its own
 * database. Append a new entry to change the schema; never edit an applied one.
 */
const migrations = [
  `CREATE TABLE saved_keywords (
     id TEXT PRIMARY KEY,
     keyword TEXT NOT NULL,
     location_code INTEGER NOT NULL,
     language_code TEXT NOT NULL,
     created_at TEXT NOT NULL,
     UNIQUE (keyword, location_code, language_code)
   );
   CREATE INDEX saved_keywords_created_idx ON saved_keywords (created_at);
   CREATE TABLE saved_keyword_tags (
     id TEXT PRIMARY KEY,
     name TEXT NOT NULL,
     normalized_name TEXT NOT NULL UNIQUE,
     color TEXT,
     created_at TEXT NOT NULL
   );
   CREATE TABLE saved_keyword_tag_assignments (
     saved_keyword_id TEXT NOT NULL REFERENCES saved_keywords (id) ON DELETE CASCADE,
     tag_id TEXT NOT NULL REFERENCES saved_keyword_tags (id) ON DELETE CASCADE,
     created_at TEXT NOT NULL,
     PRIMARY KEY (saved_keyword_id, tag_id)
   );
   CREATE INDEX saved_keyword_tag_assignments_tag_idx ON saved_keyword_tag_assignments (tag_id);
   CREATE TABLE keyword_metrics (
     id INTEGER PRIMARY KEY AUTOINCREMENT,
     keyword TEXT NOT NULL,
     location_code INTEGER NOT NULL,
     language_code TEXT NOT NULL,
     search_volume INTEGER,
     cpc REAL,
     competition REAL,
     keyword_difficulty INTEGER,
     intent TEXT,
     monthly_searches TEXT,
     fetched_at TEXT NOT NULL,
     UNIQUE (keyword, location_code, language_code)
   );`,
  // Site audits follow OpenSEO's src/db/audit.schema.ts. Upstream keeps the crawl frontier
  // and link targets in a per-audit Durable Object (AuditScratchpad); here they are
  // tables deleted when the audit finalizes. A Lighthouse result keeps its compact
  // payload in payload_json, where upstream stores it in R2. worker_* and heartbeat_at record which
  // local process owns a running audit, so an interrupted one can be resumed.
  `CREATE TABLE audits (
     id TEXT PRIMARY KEY,
     start_url TEXT NOT NULL,
     status TEXT NOT NULL CHECK (status IN ('running', 'completed', 'failed')),
     config TEXT NOT NULL,
     current_phase TEXT NOT NULL CHECK (current_phase IN ('discovery', 'crawling', 'lighthouse', 'finalizing', 'completed')),
     pages_crawled INTEGER NOT NULL DEFAULT 0,
     pages_total INTEGER NOT NULL DEFAULT 0,
     lighthouse_total INTEGER NOT NULL DEFAULT 0,
     robots_text TEXT,
     throttle_state TEXT,
     error_detail TEXT,
     worker_token TEXT,
     worker_pid INTEGER,
     heartbeat_at TEXT,
     started_at TEXT NOT NULL,
     completed_at TEXT
   );
   CREATE TABLE audit_pages (
     id TEXT PRIMARY KEY,
     audit_id TEXT NOT NULL REFERENCES audits (id) ON DELETE CASCADE,
     url TEXT NOT NULL,
     status_code INTEGER,
     redirect_url TEXT,
     title TEXT,
     meta_description TEXT,
     canonical_url TEXT,
     robots_meta TEXT,
     og_title TEXT,
     og_description TEXT,
     og_image TEXT,
     h1_count INTEGER NOT NULL DEFAULT 0,
     h2_count INTEGER NOT NULL DEFAULT 0,
     h3_count INTEGER NOT NULL DEFAULT 0,
     h4_count INTEGER NOT NULL DEFAULT 0,
     h5_count INTEGER NOT NULL DEFAULT 0,
     h6_count INTEGER NOT NULL DEFAULT 0,
     heading_order_json TEXT,
     word_count INTEGER NOT NULL DEFAULT 0,
     images_total INTEGER NOT NULL DEFAULT 0,
     images_missing_alt INTEGER NOT NULL DEFAULT 0,
     images_json TEXT,
     internal_link_count INTEGER NOT NULL DEFAULT 0,
     external_link_count INTEGER NOT NULL DEFAULT 0,
     has_structured_data INTEGER NOT NULL DEFAULT 0,
     hreflang_tags_json TEXT,
     is_indexable INTEGER NOT NULL DEFAULT 1,
     x_robots_tag TEXT,
     header_canonical_url TEXT,
     crawl_depth INTEGER,
     in_sitemap INTEGER NOT NULL DEFAULT 0,
     content_hash TEXT,
     fetch_class TEXT NOT NULL DEFAULT 'ok' CHECK (fetch_class IN ('ok', 'blocked', 'rate_limited', 'error')),
     response_time_ms INTEGER,
     UNIQUE (audit_id, url)
   );
   CREATE TABLE audit_issues (
     id TEXT PRIMARY KEY,
     audit_id TEXT NOT NULL REFERENCES audits (id) ON DELETE CASCADE,
     page_id TEXT REFERENCES audit_pages (id) ON DELETE CASCADE,
     page_url TEXT NOT NULL,
     issue_type TEXT NOT NULL,
     severity TEXT NOT NULL CHECK (severity IN ('critical', 'warning', 'info')),
     details_json TEXT
   );
   CREATE INDEX audit_issues_audit_type_idx ON audit_issues (audit_id, issue_type);
   CREATE INDEX audit_issues_page_id_idx ON audit_issues (page_id);
   CREATE TABLE audit_frontier (
     audit_id TEXT NOT NULL REFERENCES audits (id) ON DELETE CASCADE,
     url TEXT NOT NULL,
     depth INTEGER,
     source TEXT NOT NULL,
     in_sitemap INTEGER NOT NULL DEFAULT 0,
     state TEXT NOT NULL DEFAULT 'pending' CHECK (state IN ('pending', 'leased', 'crawled')),
     PRIMARY KEY (audit_id, url)
   );
   CREATE INDEX audit_frontier_claim_idx ON audit_frontier (audit_id, state, source);
   CREATE TABLE audit_page_links (
     page_id TEXT PRIMARY KEY REFERENCES audit_pages (id) ON DELETE CASCADE,
     audit_id TEXT NOT NULL REFERENCES audits (id) ON DELETE CASCADE,
     url TEXT NOT NULL,
     targets_json TEXT NOT NULL
   );
   CREATE INDEX audit_page_links_audit_idx ON audit_page_links (audit_id);
   CREATE TABLE audit_lighthouse_results (
     id TEXT PRIMARY KEY,
     audit_id TEXT NOT NULL REFERENCES audits (id) ON DELETE CASCADE,
     page_id TEXT NOT NULL REFERENCES audit_pages (id) ON DELETE CASCADE,
     strategy TEXT NOT NULL CHECK (strategy IN ('mobile', 'desktop')),
     performance_score INTEGER,
     accessibility_score INTEGER,
     best_practices_score INTEGER,
     seo_score INTEGER,
     lcp_ms REAL,
     cls REAL,
     inp_ms REAL,
     ttfb_ms REAL,
     error_message TEXT,
     payload_json TEXT,
     cost_usd REAL NOT NULL,
     fetched_at TEXT NOT NULL
   );
   CREATE INDEX audit_lighthouse_results_audit_id_idx ON audit_lighthouse_results (audit_id);`,
  // Rank tracking follows OpenSEO's src/db/app.schema.ts. rank_check_runs also records
  // the local process that owns a running check, and rank_check_tasks keeps each
  // queued DataForSEO task id, so a scheduled check interrupted after paying for its
  // tasks can collect them later instead of posting them again.
  `CREATE TABLE rank_tracking_configs (
     id TEXT PRIMARY KEY,
     domain TEXT NOT NULL,
     location_code INTEGER NOT NULL,
     language_code TEXT NOT NULL,
     location_name TEXT,
     devices TEXT NOT NULL CHECK (devices IN ('desktop', 'mobile', 'both')),
     serp_depth INTEGER NOT NULL,
     schedule_interval TEXT NOT NULL CHECK (schedule_interval IN ('manual', 'daily', 'weekly', 'monthly')),
     is_active INTEGER NOT NULL DEFAULT 1,
     last_checked_at TEXT,
     next_check_at TEXT,
     last_skip_reason TEXT,
     created_at TEXT NOT NULL
   );
   CREATE UNIQUE INDEX rank_tracking_configs_national_idx ON rank_tracking_configs (domain, location_code) WHERE location_name IS NULL;
   CREATE UNIQUE INDEX rank_tracking_configs_local_idx ON rank_tracking_configs (domain, location_code, location_name) WHERE location_name IS NOT NULL;
   CREATE TABLE rank_tracking_keywords (
     id TEXT PRIMARY KEY,
     config_id TEXT NOT NULL REFERENCES rank_tracking_configs (id) ON DELETE CASCADE,
     keyword TEXT NOT NULL,
     match_case INTEGER NOT NULL DEFAULT 0,
     search_volume INTEGER,
     keyword_difficulty INTEGER,
     cpc REAL,
     metrics_fetched_at TEXT,
     created_at TEXT NOT NULL,
     UNIQUE (config_id, keyword)
   );
   CREATE TABLE rank_check_runs (
     id TEXT PRIMARY KEY,
     config_id TEXT NOT NULL REFERENCES rank_tracking_configs (id) ON DELETE CASCADE,
     status TEXT NOT NULL CHECK (status IN ('running', 'completed', 'failed')),
     trigger TEXT NOT NULL CHECK (trigger IN ('manual', 'scheduled')),
     keywords_total INTEGER NOT NULL DEFAULT 0,
     keywords_checked INTEGER NOT NULL DEFAULT 0,
     is_subset_run INTEGER NOT NULL DEFAULT 0,
     error_message TEXT,
     cost_usd REAL NOT NULL DEFAULT 0,
     worker_pid INTEGER,
     heartbeat_at TEXT,
     started_at TEXT NOT NULL,
     completed_at TEXT
   );
   CREATE INDEX rank_check_runs_config_idx ON rank_check_runs (config_id, started_at);
   CREATE UNIQUE INDEX rank_check_runs_one_active_per_config_idx ON rank_check_runs (config_id) WHERE status = 'running';
   CREATE TABLE rank_snapshots (
     id INTEGER PRIMARY KEY AUTOINCREMENT,
     run_id TEXT NOT NULL REFERENCES rank_check_runs (id) ON DELETE CASCADE,
     tracking_keyword_id TEXT NOT NULL,
     keyword TEXT NOT NULL,
     device TEXT NOT NULL CHECK (device IN ('desktop', 'mobile')),
     position INTEGER,
     url TEXT,
     serp_features TEXT,
     checked_at TEXT NOT NULL,
     UNIQUE (run_id, tracking_keyword_id, device)
   );
   CREATE INDEX rank_snapshots_keyword_device_idx ON rank_snapshots (tracking_keyword_id, device, checked_at);
   CREATE TABLE rank_check_tasks (
     run_id TEXT NOT NULL REFERENCES rank_check_runs (id) ON DELETE CASCADE,
     tracking_keyword_id TEXT NOT NULL,
     keyword TEXT NOT NULL,
     device TEXT NOT NULL CHECK (device IN ('desktop', 'mobile')),
     task_id TEXT NOT NULL,
     posted_at TEXT NOT NULL,
     PRIMARY KEY (run_id, tracking_keyword_id, device)
   );`,
  `CREATE TABLE backlink_snapshots (
     id INTEGER PRIMARY KEY AUTOINCREMENT,
     domain TEXT NOT NULL,
     rank INTEGER,
     backlinks INTEGER,
     referring_domains INTEGER,
     broken_backlinks INTEGER,
     new_backlinks INTEGER,
     lost_backlinks INTEGER,
     new_referring_domains INTEGER,
     lost_referring_domains INTEGER,
     captured_at TEXT NOT NULL
   );`,
  // The Lighthouse sample may only pick HTML pages.
  `ALTER TABLE audit_pages ADD COLUMN is_html INTEGER NOT NULL DEFAULT 0;`,
];

export const databaseFile = (directory: string) => join(directory, "agenticseo.db");

const schemaVersion = (db: DatabaseSync) => (db.prepare("PRAGMA user_version").get() as { user_version: number }).user_version;

const busyTimeoutMs = 5000;

/**
 * Switches the database to WAL. Converting a new database needs a read lock upgraded to
 * an exclusive one; when several commands do that at once, SQLite returns SQLITE_BUSY
 * immediately instead of waiting for busy_timeout (its lock-upgrade deadlock rule), so
 * this statement is retried within the same budget. On a database already in WAL mode
 * the statement is a no-op.
 */
async function enableWal(db: DatabaseSync) {
  const deadline = Date.now() + busyTimeoutMs;
  for (;;) {
    try {
      db.exec("PRAGMA journal_mode = WAL");
      return;
    } catch (error) {
      const busy = ((error as { errcode?: number }).errcode ?? 0) % 256 === 5;
      if (!busy || Date.now() > deadline) throw error;
      await sleep(20 + Math.random() * 30);
    }
  }
}

/**
 * Opens the project database. WAL lets readers run while one command writes, and the
 * busy timeout makes concurrent writers wait instead of failing (see docs/DESIGN.md).
 */
export async function openStore(root: string): Promise<Store> {
  return openDatabase(databaseFile(await dataDirectory(root)));
}

/** Opens and migrates a database file; openStore resolves the project's file first. */
export async function openDatabase(file: string): Promise<Store> {
  const db = new DatabaseSync(file);
  try {
    db.exec(`PRAGMA busy_timeout = ${busyTimeoutMs}; PRAGMA foreign_keys = ON;`);
    await enableWal(db);
    if (schemaVersion(db) !== migrations.length) {
      transaction(db, () => {
        // Re-read under the write lock: a concurrent command may have migrated meanwhile.
        const version = schemaVersion(db);
        if (version > migrations.length) {
          throw new OperationError("input", `The project database has schema version ${version}, newer than this agenticseo supports (${migrations.length}); update agenticseo`);
        }
        for (const [index, sql] of migrations.entries()) if (index >= version) db.exec(sql);
        db.exec(`PRAGMA user_version = ${migrations.length}`);
      });
    }
  } catch (error) {
    db.close();
    throw error;
  }
  return db;
}

/** Runs work in one write transaction; IMMEDIATE takes the write lock up front so it cannot deadlock. */
export function transaction<T>(db: Store, work: () => T): T {
  db.exec("BEGIN IMMEDIATE");
  try {
    const result = work();
    db.exec("COMMIT");
    return result;
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
}

export async function withStore<T>(root: string, work: (db: Store) => T | Promise<T>): Promise<T> {
  const db = await openStore(root);
  try {
    return await work(db);
  } finally {
    db.close();
  }
}

const maxQueryRows = 500;

/**
 * Read-only SQL for agents: the connection cannot write, one statement per call, and
 * results are capped so a broad SELECT cannot flood the caller's context.
 */
export async function queryStore(root: string, sql: string) {
  if (sql.trim().replace(/;\s*$/, "").includes(";")) {
    throw new OperationError("input", "Run one SQL statement per query");
  }
  const directory = await dataDirectory(root);
  // Creating the schema first means a query on a fresh project sees empty tables.
  (await openStore(root)).close();
  const db = new DatabaseSync(databaseFile(directory), { readOnly: true });
  try {
    let rows: unknown[];
    try {
      rows = db.prepare(sql).all();
    } catch (error) {
      throw new OperationError("input", `SQL error: ${(error as Error).message}`, { cause: error });
    }
    // node:sqlite rows have a null prototype; plain objects print and compare normally.
    return { rowCount: Math.min(rows.length, maxQueryRows), truncated: rows.length > maxQueryRows, rows: rows.slice(0, maxQueryRows).map((row) => ({ ...(row as object) })) };
  } finally {
    db.close();
  }
}
