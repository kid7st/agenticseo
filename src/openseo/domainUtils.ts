// Ported from OpenSEO src/server/lib/domainUtils.ts at commit
// 0ffff93101043aad7600a3b6a499a0cd2887ef49 (target parsing subset).
// Copyright (c) 2026 Ben Senescu. MIT License; see LICENSES/OpenSEO.txt.
import { AppError } from "./platform.js";
import {
  parseResearchTarget,
  type ResearchScope,
  type ResearchTarget,
} from "./researchScope.js";

export function parseResearchTargetOrThrow(
  input: string,
  scope?: ResearchScope,
): ResearchTarget {
  const parsed = parseResearchTarget(input, scope);
  if (!parsed.ok) {
    throw new AppError("VALIDATION_ERROR", parsed.message);
  }
  return parsed.target;
}

export function toRelativePath(url: string | null | undefined): string | null {
  if (!url) return null;

  try {
    const parsed = new URL(url);
    return `${parsed.pathname}${parsed.search}` || "/";
  } catch {
    return null;
  }
}
