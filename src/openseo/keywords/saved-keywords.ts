// Ported from OpenSEO src/server/features/keywords/services/research/saved-keywords.ts
// and refresh-metrics.ts at commit 0ffff93101043aad7600a3b6a499a0cd2887ef49.
// Copyright (c) 2026 Ben Senescu. MIT License; see LICENSES/OpenSEO.txt.
// Local changes: functions take the project database and run their writes in one
// transaction; saving does not accept caller-supplied metrics, because research
// already stores them and refresh fetches the rest; a missing monthly volume stays
// null; TagInUseError becomes a VALIDATION_ERROR with the same message.
import { z } from "zod";
import { transaction, type Store } from "../../store.js";
import type { DataforseoClient } from "../dataforseo/client.js";
import { fetchKeywordMetricsForList } from "../dataforseo/keyword-metrics.js";
import { AppError } from "../platform.js";
import type { MonthlySearch } from "../types.js";
import { normalizeIntent, normalizeKeyword } from "./helpers.js";
import {
  addTagsToSavedKeywords,
  deleteSavedKeywordTag as deleteTag,
  listSavedKeywordsByProject,
  removeSavedKeywords as removeKeywords,
  removeTagsFromSavedKeywords,
  replaceTagsForSavedKeywords,
  saveKeywordsToProject,
  updateSavedKeywordTag as updateTag,
  upsertKeywordMetric,
  type SavedKeywordsListParams,
} from "./savedKeywordsRepository.js";

const monthlySearchesSchema = z.array(
  z.object({
    year: z.number().int().positive(),
    month: z.number().int().min(1).max(12),
    searchVolume: z.number().int().nonnegative().nullable(),
  }),
);

function parseMonthlySearches(payload: string | null): MonthlySearch[] {
  if (!payload) return [];
  let json: unknown;
  try {
    json = JSON.parse(payload);
  } catch {
    return [];
  }
  const result = monthlySearchesSchema.safeParse(json);
  return result.success ? result.data : [];
}

export function saveKeywords(
  db: Store,
  input: {
    keywords: string[];
    locationCode: number;
    languageCode: string;
    tags?: string[];
    tagMode: "append" | "replace";
  },
) {
  const normalizedKeywords = [...new Set(input.keywords.map(normalizeKeyword).filter((kw) => kw.length > 0))];
  return transaction(db, () => {
    const savedRows = saveKeywordsToProject(db, {
      keywords: normalizedKeywords,
      locationCode: input.locationCode,
      languageCode: input.languageCode,
    });
    const savedKeywordIds = savedRows.map((row) => row.id);

    if (input.tagMode === "replace") {
      const replacementTags = input.tags ?? [];
      if (replacementTags.length === 0) {
        throw new AppError("VALIDATION_ERROR", "Replacement tags are required when tagMode is replace.");
      }
      replaceTagsForSavedKeywords(db, { savedKeywordIds, tagNames: replacementTags });
    } else if ((input.tags?.length ?? 0) > 0) {
      addTagsToSavedKeywords(db, { savedKeywordIds, tagNames: input.tags ?? [] });
    }

    return { success: true, savedKeywordIds };
  });
}

export function getSavedKeywords(db: Store, input: SavedKeywordsListParams) {
  const result = listSavedKeywordsByProject(db, input);
  return {
    rows: mapSavedKeywordRows(result.rows),
    totalCount: result.totalCount,
    tags: result.tags.map((tag) => ({
      id: tag.id,
      name: tag.name,
      normalizedName: tag.normalizedName,
      color: tag.color ?? null,
      keywordCount: tag.keywordCount,
    })),
  };
}

export function exportSavedKeywords(db: Store, input: Omit<SavedKeywordsListParams, "page" | "pageSize">) {
  return { rows: mapSavedKeywordRows(listSavedKeywordsByProject(db, input).rows) };
}

export function updateSavedKeywordTags(
  db: Store,
  input: { savedKeywordIds: string[]; addTags?: string[]; removeTagIds?: string[] },
) {
  return transaction(db, () => {
    const addResult = (input.addTags?.length ?? 0) > 0
      ? addTagsToSavedKeywords(db, { savedKeywordIds: input.savedKeywordIds, tagNames: input.addTags ?? [] })
      : { savedKeywordCount: 0, tags: [] };
    const removeResult = (input.removeTagIds?.length ?? 0) > 0
      ? removeTagsFromSavedKeywords(db, { savedKeywordIds: input.savedKeywordIds, tagIds: input.removeTagIds ?? [] })
      : { removedCount: 0, savedKeywordCount: 0, tags: [] };
    return {
      success: true,
      taggedCount: Math.max(addResult.savedKeywordCount, removeResult.savedKeywordCount),
      addedTags: addResult.tags.map((tag) => ({ id: tag.id, name: tag.name, normalizedName: tag.normalizedName, color: tag.color ?? null })),
      removedTagIds: removeResult.tags.map((tag) => tag.id),
      removedAssignments: removeResult.removedCount,
    };
  });
}

function mapSavedKeywordRows(rows: ReturnType<typeof listSavedKeywordsByProject>["rows"]) {
  return rows.map(({ row, metric, tags }) => ({
    id: row.id,
    keyword: row.keyword,
    locationCode: row.locationCode,
    languageCode: row.languageCode,
    createdAt: row.createdAt,
    searchVolume: metric?.searchVolume ?? null,
    cpc: metric?.cpc ?? null,
    competition: metric?.competition ?? null,
    keywordDifficulty: metric?.keywordDifficulty ?? null,
    intent: metric?.intent ?? null,
    monthlySearches: parseMonthlySearches(metric?.monthlySearches ?? null),
    fetchedAt: metric?.fetchedAt ?? null,
    tags: tags.map((tag) => ({ id: tag.id, name: tag.name, normalizedName: tag.normalizedName, color: tag.color ?? null })),
  }));
}

export type SavedKeywordRow = ReturnType<typeof mapSavedKeywordRows>[number];

export function updateSavedKeywordTag(db: Store, input: { tagId: string; name?: string; color?: string | null }) {
  const updated = transaction(db, () => updateTag(db, input));
  if (!updated) return { success: false as const };
  return {
    success: true as const,
    tag: { id: updated.id, name: updated.name, normalizedName: updated.normalizedName, color: updated.color ?? null },
  };
}

export function deleteSavedKeywordTag(db: Store, input: { tagId: string }) {
  const result = transaction(db, () => deleteTag(db, input));
  if (result.status === "in_use") {
    const count = result.assignmentCount;
    throw new AppError(
      "VALIDATION_ERROR",
      `Tag is attached to ${count} keyword${count === 1 ? "" : "s"}. Remove the tag from those keywords first.`,
    );
  }
  return { success: result.status === "deleted" };
}

export function removeSavedKeywords(db: Store, input: { savedKeywordIds: string[] }) {
  const deletedCount = transaction(db, () => removeKeywords(db, input.savedKeywordIds));
  return { success: true, deletedCount };
}

/** Re-fetches metrics for every saved keyword, one provider call per market. */
export async function refreshSavedKeywordMetrics(db: Store, client: DataforseoClient): Promise<{ updated: number }> {
  const { rows } = listSavedKeywordsByProject(db, {});
  if (rows.length === 0) return { updated: 0 };

  let updated = 0;
  // Group by (locationCode, languageCode) so each provider call is homogeneous.
  const groups = new Map<string, typeof rows>();
  for (const row of rows) {
    const key = `${row.row.locationCode}:${row.row.languageCode}`;
    const group = groups.get(key) ?? [];
    group.push(row);
    groups.set(key, group);
  }

  for (const groupRows of groups.values()) {
    const { locationCode, languageCode } = groupRows[0].row;
    const metrics = await fetchKeywordMetricsForList(client, {
      keywords: groupRows.map((r) => r.row.keyword),
      locationCode,
      languageCode,
    });
    const byKeyword = new Map(metrics.map((metric) => [metric.keyword.toLowerCase(), metric]));
    // One transaction per market: a later market's failure keeps what earlier calls paid for.
    transaction(db, () => {
      for (const r of groupRows) {
        const metric = byKeyword.get(r.row.keyword.toLowerCase());
        if (!metric) continue;
        upsertKeywordMetric(db, {
          keyword: r.row.keyword,
          locationCode,
          languageCode,
          searchVolume: metric.searchVolume,
          cpc: metric.cpc,
          competition: metric.competition,
          keywordDifficulty: metric.keywordDifficulty,
          intent: normalizeIntent(metric.intent),
          monthlySearchesJson: JSON.stringify(metric.monthlySearches),
        });
      }
    });
    updated += byKeyword.size;
  }

  return { updated };
}
