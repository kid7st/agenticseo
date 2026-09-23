// Ported from OpenSEO src/types/keywords.ts at commit
// 0ffff93101043aad7600a3b6a499a0cd2887ef49 (research subset).
// Copyright (c) 2026 Ben Senescu. MIT License; see LICENSES/OpenSEO.txt.
// Local change: a missing monthly search volume is null, not a number, because
// AgenticSEO keeps missing metrics unknown instead of writing 0.

export type KeywordIntent =
  | "informational"
  | "commercial"
  | "transactional"
  | "navigational"
  | "unknown";

export type MonthlySearch = {
  year: number;
  month: number;
  searchVolume: number | null;
};

export type KeywordResearchRow = {
  keyword: string;
  searchVolume: number | null;
  trend: MonthlySearch[];
  keywordDifficulty: number | null;
  cpc: number | null;
  competition: number | null;
  intent: KeywordIntent;
};
