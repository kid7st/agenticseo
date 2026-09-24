// Ported from OpenSEO src/shared/audit-fetch-class.ts at commit
// 0ffff93101043aad7600a3b6a499a0cd2887ef49.
// Copyright (c) 2026 Ben Senescu. MIT License; see LICENSES/OpenSEO.txt.
// How a page fetch resolved. "blocked" = WAF/bot challenge stood in the way;
// "rate_limited" = a 429 prevented the crawler from reading the page.
// Declared once so the SQLite and Postgres columns, the MCP filter, and the
// PageFetchClass type can't drift apart.
export const PAGE_FETCH_CLASSES = [
  "ok",
  "blocked",
  "rate_limited",
  "error",
] as const;

export type PageFetchClass = (typeof PAGE_FETCH_CLASSES)[number];
