import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { OperationError } from "./errors.js";
import type { Market } from "./market.js";
import { createDataforseoClient, ledgerCost, type ProviderCall } from "./openseo/dataforseo/client.js";
import { TAG_COLOR_KEYS } from "./openseo/keywords/saved-keyword-tags.js";
import {
  deleteSavedKeywordTag,
  exportSavedKeywords,
  getSavedKeywords,
  refreshSavedKeywordMetrics,
  removeSavedKeywords,
  saveKeywords,
  updateSavedKeywordTag,
  updateSavedKeywordTags,
  type SavedKeywordRow,
} from "./openseo/keywords/saved-keywords.js";
import { findTagIdsByNames, type SavedKeywordsListParams } from "./openseo/keywords/savedKeywordsRepository.js";
import { stateDirectory } from "./project.js";
import { withStore, type Store } from "./store.js";

export type SavedFilters = Omit<SavedKeywordsListParams, "tagIds" | "page" | "pageSize">;

/** Tags are addressed by name on the command line; an unknown name is an error, not a no-op. */
function tagIds(db: Store, names: string[]) {
  const { ids, missing } = findTagIdsByNames(db, names);
  if (missing.length > 0) throw new OperationError("input", `Unknown tag(s): ${missing.join(", ")}`);
  return ids;
}

/** OpenSEO's save_keywords: idempotent, with optional tags appended or replacing existing ones. */
export async function saveCommand(root: string, market: Market, input: { keywords: string[]; tags?: string[]; replaceTags: boolean }) {
  return withStore(root, (db) => {
    const { savedKeywordIds } = saveKeywords(db, { ...input, ...market, tagMode: input.replaceTags ? "replace" : "append" });
    return { savedCount: savedKeywordIds.length, ids: savedKeywordIds, tags: input.tags ?? [], tagMode: input.replaceTags ? "replace" : "append", market };
  });
}

/** OpenSEO's list_saved_keywords row: ids for removal and tagging, no timestamps or trends. */
function toListRow(row: SavedKeywordRow) {
  return {
    id: row.id,
    keyword: row.keyword,
    locationCode: row.locationCode,
    languageCode: row.languageCode,
    searchVolume: row.searchVolume,
    keywordDifficulty: row.keywordDifficulty,
    cpc: row.cpc,
    competition: row.competition,
    intent: row.intent,
    fetchedAt: row.fetchedAt,
    tags: row.tags.map((tag) => tag.name),
  };
}

export async function listCommand(root: string, input: SavedFilters & { page: number; pageSize: number }) {
  return withStore(root, (db) => {
    const { rows, totalCount, tags } = getSavedKeywords(db, input);
    const shownEnd = (input.page - 1) * input.pageSize + rows.length;
    return {
      totalCount,
      nextPage: shownEnd < totalCount ? input.page + 1 : null,
      rows: rows.map(toListRow),
      tags: tags.map((tag) => ({ name: tag.name, color: tag.color, keywordCount: tag.keywordCount })),
    };
  });
}

export async function removeCommand(root: string, ids: string[]) {
  return withStore(root, (db) => ({ requested: ids.length, ...removeSavedKeywords(db, { savedKeywordIds: ids }) }));
}

export async function tagCommand(root: string, input: { ids: string[]; add?: string[]; remove?: string[] }) {
  return withStore(root, (db) => {
    const result = updateSavedKeywordTags(db, { savedKeywordIds: input.ids, addTags: input.add, removeTagIds: input.remove && tagIds(db, input.remove) });
    return { taggedCount: result.taggedCount, addedTags: result.addedTags.map((tag) => tag.name), removedAssignments: result.removedAssignments };
  });
}

export async function renameTagCommand(root: string, input: { name: string; to?: string; color?: string }) {
  if (input.to === undefined && input.color === undefined) throw new OperationError("input", "Pass --to NEW_NAME, --color COLOR, or both");
  if (input.color !== undefined && input.color !== "none" && !(TAG_COLOR_KEYS as readonly string[]).includes(input.color)) {
    throw new OperationError("input", `--color must be one of ${TAG_COLOR_KEYS.join(", ")} or none`);
  }
  return withStore(root, (db) => {
    const [tagId] = tagIds(db, [input.name]);
    const result = updateSavedKeywordTag(db, { tagId, name: input.to, color: input.color === "none" ? null : input.color });
    if (!result.success) throw new OperationError("input", "--to must be a non-empty tag name");
    return { tag: { name: result.tag.name, color: result.tag.color } };
  });
}

export async function deleteTagCommand(root: string, name: string) {
  return withStore(root, (db) => deleteSavedKeywordTag(db, { tagId: tagIds(db, [name])[0] }));
}

// OpenSEO's saved-keywords CSV (src/client/features/saved-keywords/savedKeywordsUtils.ts
// and src/client/lib/csv.ts): same columns, every field quoted, numbers rounded to two
// decimals, and formula-injection prefixes neutralized.
const csvHeaders = ["Keyword", "Volume", "CPC", "Competition", "Score", "Intent", "Tags", "Fetched At"];

function csvField(value: string | number | null) {
  const rounded = typeof value === "number" && Number.isFinite(value) ? Math.round((value + Number.EPSILON) * 100) / 100 : value;
  let text = rounded == null ? "" : String(rounded);
  if (typeof rounded === "string" && text.length > 0 && ["=", "+", "-", "@", "\t", "\r", "\n"].includes(text[0])) text = `'${text}`;
  return `"${text.replaceAll('"', '""')}"`;
}

function toCsv(rows: SavedKeywordRow[]) {
  const lines = rows.map((row) =>
    [row.keyword, row.searchVolume, row.cpc, row.competition, row.keywordDifficulty, row.intent, row.tags.map((tag) => tag.name).join(", "), row.fetchedAt]
      .map(csvField)
      .join(","),
  );
  return `${[csvHeaders.map(csvField).join(","), ...lines].join("\n")}\n`;
}

/** Writes the filtered list as CSV (OpenSEO's export) or JSONL (one full row per line). */
export async function exportCommand(root: string, input: SavedFilters & { format: "csv" | "jsonl"; out?: string }) {
  const { format, out, ...filters } = input;
  const { rows } = await withStore(root, (db) => exportSavedKeywords(db, filters));
  if (rows.length === 0) throw new OperationError("input", "No saved keywords match; nothing to export");
  const file = out ? resolve(out) : join(stateDirectory(root), "exports", `saved-keywords-${new Date().toISOString().replaceAll(":", "-")}.${format}`);
  await mkdir(dirname(file), { recursive: true });
  await writeFile(file, format === "csv" ? toCsv(rows) : rows.map((row) => JSON.stringify(row)).join("\n") + "\n");
  return { file, format, rowCount: rows.length };
}

/** OpenSEO's saved-keyword metrics refresh: one paid call per market, stored as the latest snapshot. */
export async function refreshCommand(root: string) {
  const calls: ProviderCall[] = [];
  const { updated } = await withStore(root, (db) => refreshSavedKeywordMetrics(db, createDataforseoClient(calls)));
  return { updated, costUsd: ledgerCost(calls), calls };
}
