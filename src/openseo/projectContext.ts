// Ported from OpenSEO at commit 0ffff93101043aad7600a3b6a499a0cd2887ef49:
// src/types/schemas/projectContext.ts (vocabulary and entry schemas),
// src/server/features/project-context/services/contextUpdateOps.ts (caps and
// normalizeKeyPageUrl) and ProjectContextService.ts (research-log window).
// Copyright (c) 2026 Ben Senescu. MIT License; see LICENSES/OpenSEO.txt.
// Local change: normalizers return null instead of throwing AppError, so the
// file schema can report the failing field.
import { z } from "zod";

export const PROJECT_CONTEXT_SECTION_KEYS = [
  "business_overview",
  "current_goal",
  "positioning",
  "writing_preferences",
] as const;

/** Cap on every prose section, enforced by the service and hinted in the UI. */
export const PROSE_MAX_CHARS = 4000;

export const KEY_PAGE_ROLES = ["hub", "spoke", "money", "other"] as const;

export const MAX_CUSTOM_SECTIONS = 20;
export const MAX_COMPETITORS = 100;
export const MAX_KEY_PAGES = 100;

export const RESEARCH_LOG_RETENTION_DAYS = 90;
export const RESEARCH_LOG_LIMIT = 20;

// Custom sections are addressed by slug.
export const customSectionSlugSchema = z
  .string()
  .trim()
  .max(60)
  .regex(
    /^[a-z0-9]+(?:-[a-z0-9]+)*$/,
    "Use a lowercase slug like 'launch-plan'",
  );

export const competitorInputSchema = z.object({
  domain: z.string().trim().min(1).max(255),
  name: z.string().trim().max(120).optional(),
  notes: z.string().trim().max(500).optional(),
});

export const keyPageInputSchema = z.object({
  url: z.string().trim().min(1).max(2048),
  role: z.enum(KEY_PAGE_ROLES).optional(),
  topic: z.string().trim().max(200).optional(),
  notes: z.string().trim().max(500).optional(),
});

export const researchLogSummarySchema = z.string().trim().min(1).max(1000);

/**
 * Canonicalize a key-page URL so the same page is one row: force https, strip
 * a leading www and the fragment, lowercase the host (URL does), keep the path
 * and query — unlike backlinks targets, real pages may live behind a query
 * string. Bare "example.com" gets https:// prepended.
 */
export function normalizeKeyPageUrl(raw: string): string | null {
  const input = raw.trim();
  const withScheme = /^[a-z][a-z0-9+.-]*:\/\//i.test(input)
    ? input
    : `https://${input}`;
  const url = URL.parse(withScheme);
  if (!url || (url.protocol !== "https:" && url.protocol !== "http:")) {
    return null;
  }
  url.protocol = "https:";
  url.hash = "";
  url.hostname = url.hostname.replace(/^www\./, "");
  const href = url.toString();
  // "example.com" round-trips as "example.com/"; keep the bare-host form.
  return url.pathname === "/" && !url.search ? href.replace(/\/$/, "") : href;
}
