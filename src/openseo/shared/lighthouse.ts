// Ported from OpenSEO src/shared/lighthouse.ts at commit
// 0ffff93101043aad7600a3b6a499a0cd2887ef49.
// Copyright (c) 2026 Ben Senescu. MIT License; see LICENSES/OpenSEO.txt.
export const LIGHTHOUSE_CATEGORIES = [
  "performance",
  "accessibility",
  "best-practices",
  "seo",
] as const;

export const LIGHTHOUSE_CATEGORY_TABS = [
  "all",
  ...LIGHTHOUSE_CATEGORIES,
] as const;

export type LighthouseCategory = (typeof LIGHTHOUSE_CATEGORIES)[number];
export type LighthouseCategoryTab = (typeof LIGHTHOUSE_CATEGORY_TABS)[number];
