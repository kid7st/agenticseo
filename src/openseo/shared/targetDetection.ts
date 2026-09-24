// Ported from OpenSEO src/shared/targetDetection.ts at commit
// 0ffff93101043aad7600a3b6a499a0cd2887ef49.
// Copyright (c) 2026 Ben Senescu. MIT License; see LICENSES/OpenSEO.txt.
// Local change: normalizeDomain is copied in from src/types/schemas/domain.ts.
/** OpenSEO's normalizeDomain from src/types/schemas/domain.ts: a bare hostname without www. */
function normalizeDomain(input: string): string {
  let d = input.trim().toLowerCase();
  // Ensure URL() can parse the input by adding a protocol if missing
  if (!/^[a-z]+:\/\//.test(d)) d = `https://${d}`;
  const { hostname } = new URL(d); // throws on truly invalid input
  return hostname.replace(/^www\./, "");
}

type DetectedTarget = {
  type: "domain" | "keyword";
  value: string;
};

/**
 * Decide whether free-text input is a domain (e.g. "example.com") or a brand
 * keyword (e.g. "Example Brand"). Heuristic: no whitespace + contains a dot +
 * `normalizeDomain` produces a valid hostname.
 */
export function detectTarget(rawInput: string): DetectedTarget {
  const trimmed = rawInput.trim();
  const looksLikeDomain =
    trimmed.length > 0 && !/\s/.test(trimmed) && trimmed.includes(".");

  if (looksLikeDomain) {
    try {
      const hostname = normalizeDomain(trimmed);
      if (hostname.includes(".")) {
        return { type: "domain", value: hostname };
      }
    } catch {
      // Fall through to keyword.
    }
  }

  return { type: "keyword", value: trimmed };
}
