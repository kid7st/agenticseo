// Ported from OpenSEO src/server/lib/r2-cache.ts at commit
// 0ffff93101043aad7600a3b6a499a0cd2887ef49.
// Copyright (c) 2026 Ben Senescu. MIT License; see LICENSES/OpenSEO.txt.
// Local change: R2 objects become one JSON file per key in the project's cache
// directory, returned as a Cache object instead of module functions bound to the
// Worker env.
import { randomUUID } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { join } from "node:path";

/**
 * Cache TTL constants in seconds.
 */
export const CACHE_TTL = {
  /** Related keyword research results */
  researchResult: 86400,
} as const;

/**
 * Build a deterministic cache key from an endpoint slug and input params.
 * Uses a SHA-256 digest for stability across runtimes.
 */
export async function buildCacheKey(
  prefix: string,
  params: Record<string, unknown>,
): Promise<string> {
  const raw = JSON.stringify(
    Object.fromEntries(
      Object.entries(params).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)),
    ),
  );

  return `${prefix}:${await sha256Hex(raw)}`;
}

export type Cache = {
  /**
   * Get a cached JSON value. Returns null on miss or expiry. Callers should
   * validate the shape with Zod before trusting it — schema drift between
   * writes and reads is otherwise silent.
   */
  get(key: string): Promise<unknown>;
  /** Store a JSON value with a soft TTL. */
  set(key: string, data: unknown, ttlSeconds: number): Promise<void>;
};

export function createFileCache(directory: string): Cache {
  const fileFor = (key: string) => join(directory, `${key.replace(/[^a-z0-9-]/gi, "_")}.json`);
  return {
    async get(key) {
      let text: string;
      try {
        text = await readFile(fileFor(key), "utf8");
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
        throw error;
      }
      // As upstream: an unreadable entry is a miss, and the caller re-fetches.
      let entry: { expiresAt?: unknown; value?: unknown };
      try {
        entry = JSON.parse(text) as typeof entry;
      } catch {
        return null;
      }
      if (typeof entry.expiresAt !== "string" || Date.parse(entry.expiresAt) < Date.now()) return null;
      return entry.value ?? null;
    },
    async set(key, data, ttlSeconds) {
      await mkdir(directory, { recursive: true });
      const file = fileFor(key);
      const temporary = `${file}.${randomUUID()}.tmp`;
      const expiresAt = new Date(Date.now() + ttlSeconds * 1000).toISOString();
      await writeFile(temporary, JSON.stringify({ expiresAt, value: data }));
      await rename(temporary, file);
    },
  };
}

/**
 * Compute a deterministic SHA-256 digest for cache keys.
 */
async function sha256Hex(input: string): Promise<string> {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(input),
  );

  return Array.from(new Uint8Array(digest), (byte) =>
    byte.toString(16).padStart(2, "0"),
  ).join("");
}
