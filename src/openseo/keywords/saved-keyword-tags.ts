// Ported from OpenSEO src/shared/saved-keyword-tags.ts and the TAG_COLOR_KEYS list
// of src/shared/tag-colors.ts at commit 0ffff93101043aad7600a3b6a499a0cd2887ef49.
// Copyright (c) 2026 Ben Senescu. MIT License; see LICENSES/OpenSEO.txt.

export const TAG_COLOR_KEYS = [
  "slate",
  "rose",
  "amber",
  "lime",
  "emerald",
  "sky",
  "violet",
  "fuchsia",
] as const;

export type TagColorKey = (typeof TAG_COLOR_KEYS)[number];

const TAG_SEPARATOR = /[\n,]+/;

type NormalizedSavedKeywordTag = {
  name: string;
  normalizedName: string;
};

export function normalizeSavedKeywordTag(
  value: string,
): NormalizedSavedKeywordTag | null {
  const name = value.trim().replace(/\s+/g, " ");
  if (name.length === 0) return null;
  return {
    name,
    normalizedName: name.toLocaleLowerCase(),
  };
}

export function normalizeSavedKeywordTags(
  values: readonly string[] | undefined,
): NormalizedSavedKeywordTag[] {
  const tags = new Map<string, NormalizedSavedKeywordTag>();
  for (const value of values ?? []) {
    const tag = normalizeSavedKeywordTag(value);
    if (!tag || tags.has(tag.normalizedName)) continue;
    tags.set(tag.normalizedName, tag);
  }
  return [...tags.values()];
}

export function parseSavedKeywordTagInput(value: string): string[] {
  return normalizeSavedKeywordTags(value.split(TAG_SEPARATOR)).map(
    (tag) => tag.name,
  );
}
