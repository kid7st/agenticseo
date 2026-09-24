// How long-running local work (site audits, rank checks) proves it is still alive.
// The owning process refreshes a heartbeat on its row; other commands judge liveness
// from it, so an interrupted run can be resumed or closed instead of blocking forever.

export const HEARTBEAT_INTERVAL_MS = 5_000;
/** A running row whose heartbeat is older than this has lost its worker. */
export const HEARTBEAT_STALE_MS = 30_000;

/** Dead when the heartbeat is stale or, on this machine, the process has exited. */
export function workerAlive(row: { worker_pid: number | null; heartbeat_at: string | null }) {
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
