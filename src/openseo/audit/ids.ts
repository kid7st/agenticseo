// Ported from OpenSEO src/server/lib/audit/ids.ts at commit
// 0ffff93101043aad7600a3b6a499a0cd2887ef49.
// Copyright (c) 2026 Ben Senescu. MIT License; see LICENSES/OpenSEO.txt.
/**
 * Deterministic row ids for audit data.
 *
 * Crawl/lighthouse persistence happens inside Workflow steps, which retry on
 * failure. Deriving ids from stable content (audit id + URL + ...) combined
 * with `onConflictDoNothing` makes those writes idempotent across retries —
 * a partially-written batch is simply completed on the next attempt instead
 * of duplicated under fresh random ids.
 */
export async function sha256Hex(text: string): Promise<string> {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(text),
  );
  return Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

export async function deterministicAuditRowId(
  ...parts: string[]
): Promise<string> {
  return (await sha256Hex(parts.join("|"))).slice(0, 36);
}
