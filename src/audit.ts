import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { once } from "node:events";
import { closeSync, openSync } from "node:fs";
import { join } from "node:path";
import { OperationError } from "./errors.js";
import { normalizeAndValidateStartUrl, resolveStartUrlRedirects } from "./openseo/audit/url-policy.js";
import { HEARTBEAT_STALE_MS, runSiteAudit, type AuditRunConfig } from "./openseo/workflows/siteAuditRunner.js";
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
  error_detail: string | null;
  worker_pid: number | null;
  heartbeat_at: string | null;
  started_at: string;
  completed_at: string | null;
};

const logFile = async (root: string, auditId: string) => join(await dataDirectory(root), `audit-${auditId}.log`);

/** A running audit's worker is gone when its heartbeat is stale or, on this machine, its process has exited. */
function workerAlive(row: AuditRow) {
  if (!row.heartbeat_at || Date.now() - Date.parse(row.heartbeat_at) > HEARTBEAT_STALE_MS) return false;
  if (row.worker_pid === null) return true;
  try {
    process.kill(row.worker_pid, 0);
    return true;
  } catch (error) {
    // EPERM means the process exists but belongs to someone else.
    return (error as NodeJS.ErrnoException).code !== "ESRCH";
  }
}

function findAudit(db: Store, auditId: string) {
  const row = db.prepare(`SELECT * FROM audits WHERE id = ?`).get(auditId) as AuditRow | undefined;
  if (!row) throw new OperationError("input", `No audit ${auditId} in this project`);
  return row;
}

/** Validate the target (URL policy and redirects, as OpenSEO's AuditService does), record the audit and run it. */
export async function startAudit(root: string, input: { url?: string; maxPages: number; allowPrivate: boolean; wait: boolean }) {
  const policy = { allowPrivate: input.allowPrivate };
  const target = input.url ?? `https://${(await readProject(root)).domain}/`;
  const startUrl = await resolveStartUrlRedirects(await normalizeAndValidateStartUrl(target, policy), policy);
  const config: AuditRunConfig = { maxPages: input.maxPages, allowPrivate: input.allowPrivate };
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
    const row = auditId ? findAudit(db, auditId) : (db.prepare(`SELECT * FROM audits ORDER BY started_at DESC LIMIT 1`).get() as AuditRow | undefined);
    if (!row) throw new OperationError("input", "No audits in this project; run 'agenticseo audit start'");
    const status = row.status === "running" && !workerAlive(row) ? "interrupted" : row.status;
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
      completed: undefined,
    }[status];
    return {
      id: row.id,
      startUrl: row.start_url,
      status,
      phase: row.current_phase,
      pagesCrawled: row.pages_crawled,
      pagesTotal: row.pages_total,
      maxPages: (JSON.parse(row.config) as AuditRunConfig).maxPages,
      startedAt: row.started_at,
      completedAt: row.completed_at,
      error: row.error_detail,
      issues,
      log: await logFile(root, row.id),
      next,
    };
  });
}
