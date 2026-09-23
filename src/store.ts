import { DatabaseSync } from "node:sqlite";
import { join } from "node:path";
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
];

const databaseFile = (directory: string) => join(directory, "agenticseo.db");

const schemaVersion = (db: DatabaseSync) => (db.prepare("PRAGMA user_version").get() as { user_version: number }).user_version;

/**
 * Opens the project database. WAL lets readers run while one command writes, and the
 * busy timeout makes concurrent writers wait instead of failing (see docs/DESIGN.md).
 */
export async function openStore(root: string): Promise<Store> {
  const db = new DatabaseSync(databaseFile(await dataDirectory(root)));
  // The timeout comes first so that switching to WAL also waits for other writers.
  db.exec("PRAGMA busy_timeout = 5000; PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON;");
  try {
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
