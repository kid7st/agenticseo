// Translated from OpenSEO src/server/features/keywords/repositories/
// KeywordResearchRepository.ts and SavedKeywordTagsRepository.ts at commit
// 0ffff93101043aad7600a3b6a499a0cd2887ef49.
// Copyright (c) 2026 Ben Senescu. MIT License; see LICENSES/OpenSEO.txt.
// Local changes: drizzle queries become SQL on a per-project SQLite database, so
// project_id scoping and D1's parameter-chunking loops are gone; writes that
// upstream batches run inside the caller's transaction; timestamps are ISO 8601;
// renaming a tag onto an existing name is an input error instead of a constraint
// failure.
import { randomUUID } from "node:crypto";
import { AppError } from "../platform.js";
import type { Store } from "../../store.js";
import { normalizeSavedKeywordTag, normalizeSavedKeywordTags } from "./saved-keyword-tags.js";

export type SavedKeywordRecord = {
  id: string;
  keyword: string;
  locationCode: number;
  languageCode: string;
  createdAt: string;
};

export type KeywordMetricRecord = {
  searchVolume: number | null;
  cpc: number | null;
  competition: number | null;
  keywordDifficulty: number | null;
  intent: string | null;
  monthlySearches: string | null;
  fetchedAt: string;
};

export type SavedKeywordTagRecord = {
  id: string;
  name: string;
  normalizedName: string;
  color: string | null;
  createdAt: string;
};

export type SavedKeywordSortField =
  | "createdAt"
  | "keyword"
  | "searchVolume"
  | "cpc"
  | "competition"
  | "keywordDifficulty"
  | "fetchedAt";

export type SavedKeywordsListParams = {
  search?: string;
  includeTerms?: string[];
  excludeTerms?: string[];
  minVolume?: number | null;
  maxVolume?: number | null;
  minCpc?: number | null;
  maxCpc?: number | null;
  minDifficulty?: number | null;
  maxDifficulty?: number | null;
  tagIds?: string[];
  tagNames?: string[];
  page?: number;
  pageSize?: number;
  sort?: SavedKeywordSortField;
  order?: "asc" | "desc";
};

type SqlValue = string | number | null;

const now = () => new Date().toISOString();
const placeholders = (values: readonly unknown[]) => values.map(() => "?").join(", ");

const keywordColumns = `k.id AS id, k.keyword AS keyword, k.location_code AS locationCode,
  k.language_code AS languageCode, k.created_at AS createdAt`;
const tagColumns = `t.id AS id, t.name AS name, t.normalized_name AS normalizedName,
  t.color AS color, t.created_at AS createdAt`;

export function upsertKeywordMetric(
  db: Store,
  params: {
    keyword: string;
    locationCode: number;
    languageCode: string;
    searchVolume: number | null;
    cpc: number | null;
    competition: number | null;
    keywordDifficulty: number | null;
    intent: string | null;
    monthlySearchesJson: string;
  },
) {
  db.prepare(
    `INSERT INTO keyword_metrics (keyword, location_code, language_code, search_volume, cpc,
       competition, keyword_difficulty, intent, monthly_searches, fetched_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT (keyword, location_code, language_code) DO UPDATE SET
       search_volume = excluded.search_volume, cpc = excluded.cpc,
       competition = excluded.competition, keyword_difficulty = excluded.keyword_difficulty,
       intent = excluded.intent, monthly_searches = excluded.monthly_searches,
       fetched_at = excluded.fetched_at`,
  ).run(
    params.keyword,
    params.locationCode,
    params.languageCode,
    params.searchVolume,
    params.cpc,
    params.competition,
    params.keywordDifficulty,
    params.intent,
    params.monthlySearchesJson,
    now(),
  );
}

export function saveKeywordsToProject(
  db: Store,
  params: { keywords: string[]; locationCode: number; languageCode: string },
): SavedKeywordRecord[] {
  if (params.keywords.length === 0) return [];
  const insert = db.prepare(
    `INSERT INTO saved_keywords (id, keyword, location_code, language_code, created_at)
     VALUES (?, ?, ?, ?, ?) ON CONFLICT DO NOTHING`,
  );
  for (const keyword of params.keywords) {
    insert.run(randomUUID(), keyword, params.locationCode, params.languageCode, now());
  }
  return db
    .prepare(
      `SELECT ${keywordColumns} FROM saved_keywords k
       WHERE k.location_code = ? AND k.language_code = ? AND k.keyword IN (${placeholders(params.keywords)})`,
    )
    .all(params.locationCode, params.languageCode, ...params.keywords) as SavedKeywordRecord[];
}

function escapeLike(value: string) {
  return value.replace(/[\\%_]/g, (char) => `\\${char}`);
}

function buildSavedKeywordWhere(params: SavedKeywordsListParams & { tagIds: string[] }) {
  const clauses: string[] = [];
  const values: SqlValue[] = [];
  const like = (term: string, negate: boolean) => {
    clauses.push(`lower(k.keyword) ${negate ? "NOT " : ""}LIKE ? ESCAPE '\\'`);
    values.push(`%${escapeLike(term.toLocaleLowerCase())}%`);
  };
  const search = params.search?.trim();
  if (search) like(search, false);
  for (const term of params.includeTerms ?? []) if (term.trim()) like(term.trim(), false);
  for (const term of params.excludeTerms ?? []) if (term.trim()) like(term.trim(), true);
  const ranges: Array<[string, "<=" | ">=", number | null | undefined]> = [
    ["m.search_volume", ">=", params.minVolume],
    ["m.search_volume", "<=", params.maxVolume],
    ["m.cpc", ">=", params.minCpc],
    ["m.cpc", "<=", params.maxCpc],
    ["m.keyword_difficulty", ">=", params.minDifficulty],
    ["m.keyword_difficulty", "<=", params.maxDifficulty],
  ];
  for (const [column, operator, value] of ranges) {
    if (value == null) continue;
    clauses.push(`${column} ${operator} ?`);
    values.push(value);
  }
  if (params.tagIds.length > 0) {
    clauses.push(
      `EXISTS (SELECT 1 FROM saved_keyword_tag_assignments a
               WHERE a.saved_keyword_id = k.id AND a.tag_id IN (${placeholders(params.tagIds)}))`,
    );
    values.push(...params.tagIds);
  }
  return { where: clauses.length > 0 ? `WHERE ${clauses.join(" AND ")}` : "", values };
}

const sortColumns: Record<SavedKeywordSortField, string> = {
  createdAt: "k.created_at",
  keyword: "k.keyword",
  searchVolume: "m.search_volume",
  cpc: "m.cpc",
  competition: "m.competition",
  keywordDifficulty: "m.keyword_difficulty",
  fetchedAt: "m.fetched_at",
};

function getTagFilterIds(db: Store, params: { tagIds?: string[]; tagNames?: string[] }) {
  const directTagIds = params.tagIds ?? [];
  const normalizedTags = normalizeSavedKeywordTags(params.tagNames);
  if (normalizedTags.length === 0) {
    return { tagIds: [...new Set(directTagIds)], emptyTagNameMatch: false };
  }
  const names = normalizedTags.map((tag) => tag.normalizedName);
  const rows = db
    .prepare(`SELECT id FROM saved_keyword_tags WHERE normalized_name IN (${placeholders(names)})`)
    .all(...names) as Array<{ id: string }>;
  return {
    tagIds: [...new Set([...directTagIds, ...rows.map((row) => row.id)])],
    emptyTagNameMatch: directTagIds.length === 0 && rows.length === 0,
  };
}

export function listSavedKeywordTags(db: Store) {
  return db
    .prepare(
      `SELECT ${tagColumns}, count(a.saved_keyword_id) AS keywordCount
       FROM saved_keyword_tags t LEFT JOIN saved_keyword_tag_assignments a ON a.tag_id = t.id
       GROUP BY t.id ORDER BY t.normalized_name ASC`,
    )
    .all() as Array<SavedKeywordTagRecord & { keywordCount: number }>;
}

function listTagsBySavedKeywordIds(db: Store, savedKeywordIds: string[]) {
  const tagsByKeywordId = new Map<string, SavedKeywordTagRecord[]>();
  if (savedKeywordIds.length === 0) return tagsByKeywordId;
  const rows = db
    .prepare(
      `SELECT a.saved_keyword_id AS savedKeywordId, ${tagColumns}
       FROM saved_keyword_tag_assignments a JOIN saved_keyword_tags t ON t.id = a.tag_id
       WHERE a.saved_keyword_id IN (${placeholders(savedKeywordIds)})
       ORDER BY t.normalized_name ASC`,
    )
    .all(...savedKeywordIds) as Array<SavedKeywordTagRecord & { savedKeywordId: string }>;
  for (const { savedKeywordId, ...tag } of rows) {
    const tags = tagsByKeywordId.get(savedKeywordId) ?? [];
    tags.push(tag);
    tagsByKeywordId.set(savedKeywordId, tags);
  }
  return tagsByKeywordId;
}

const metricJoin = `LEFT JOIN keyword_metrics m ON m.keyword = k.keyword
  AND m.location_code = k.location_code AND m.language_code = k.language_code`;

export function listSavedKeywordsByProject(db: Store, params: SavedKeywordsListParams) {
  const { tagIds, emptyTagNameMatch } = getTagFilterIds(db, params);
  const tags = listSavedKeywordTags(db);
  if (emptyTagNameMatch) return { rows: [], totalCount: 0, tags };

  const { where, values } = buildSavedKeywordWhere({ ...params, tagIds });
  const { totalCount } = db
    .prepare(`SELECT count(*) AS totalCount FROM saved_keywords k ${metricJoin} ${where}`)
    .get(...values) as { totalCount: number };
  const order = `${sortColumns[params.sort ?? "createdAt"]} ${params.order === "asc" ? "ASC" : "DESC"}, k.id ASC`;
  const page = params.pageSize == null ? "" : `LIMIT ${params.pageSize} OFFSET ${((params.page ?? 1) - 1) * params.pageSize}`;
  const rows = db
    .prepare(
      `SELECT ${keywordColumns}, m.search_volume AS searchVolume, m.cpc AS cpc,
         m.competition AS competition, m.keyword_difficulty AS keywordDifficulty,
         m.intent AS intent, m.monthly_searches AS monthlySearches, m.fetched_at AS fetchedAt
       FROM saved_keywords k ${metricJoin} ${where} ORDER BY ${order} ${page}`,
    )
    .all(...values) as Array<SavedKeywordRecord & KeywordMetricRecord>;
  const tagsByKeywordId = listTagsBySavedKeywordIds(db, rows.map((row) => row.id));
  return {
    totalCount,
    tags,
    rows: rows.map(({ id, keyword, locationCode, languageCode, createdAt, ...metric }) => ({
      row: { id, keyword, locationCode, languageCode, createdAt },
      metric: metric.fetchedAt == null ? null : metric,
      tags: tagsByKeywordId.get(id) ?? [],
    })),
  };
}

function listSavedKeywordRowsByIds(db: Store, savedKeywordIds: string[]) {
  if (savedKeywordIds.length === 0) return [];
  return db
    .prepare(`SELECT ${keywordColumns} FROM saved_keywords k WHERE k.id IN (${placeholders(savedKeywordIds)})`)
    .all(...savedKeywordIds) as SavedKeywordRecord[];
}

function upsertSavedKeywordTags(db: Store, tagNames: readonly string[] | undefined) {
  const normalizedTags = normalizeSavedKeywordTags(tagNames);
  if (normalizedTags.length === 0) return [];
  const insert = db.prepare(
    `INSERT INTO saved_keyword_tags (id, name, normalized_name, created_at)
     VALUES (?, ?, ?, ?) ON CONFLICT DO NOTHING`,
  );
  for (const tag of normalizedTags) insert.run(randomUUID(), tag.name, tag.normalizedName, now());
  const names = normalizedTags.map((tag) => tag.normalizedName);
  return db
    .prepare(`SELECT ${tagColumns} FROM saved_keyword_tags t WHERE t.normalized_name IN (${placeholders(names)}) ORDER BY t.normalized_name ASC`)
    .all(...names) as SavedKeywordTagRecord[];
}

export function addTagsToSavedKeywords(db: Store, params: { savedKeywordIds: string[]; tagNames: string[] }) {
  const savedKeywordRows = listSavedKeywordRowsByIds(db, params.savedKeywordIds);
  if (savedKeywordRows.length === 0) return { savedKeywordCount: 0, tags: [] };
  const tags = upsertSavedKeywordTags(db, params.tagNames);
  const assign = db.prepare(
    `INSERT INTO saved_keyword_tag_assignments (saved_keyword_id, tag_id, created_at)
     VALUES (?, ?, ?) ON CONFLICT DO NOTHING`,
  );
  for (const row of savedKeywordRows) for (const tag of tags) assign.run(row.id, tag.id, now());
  return { savedKeywordCount: savedKeywordRows.length, tags };
}

export function replaceTagsForSavedKeywords(db: Store, params: { savedKeywordIds: string[]; tagNames: string[] }) {
  const addResult = addTagsToSavedKeywords(db, params);
  const keepTagIds = addResult.tags.map((tag) => tag.id);
  if (addResult.savedKeywordCount === 0 || keepTagIds.length === 0) return { ...addResult, removedCount: 0 };
  const savedKeywordIds = listSavedKeywordRowsByIds(db, params.savedKeywordIds).map((row) => row.id);
  const { changes } = db
    .prepare(
      `DELETE FROM saved_keyword_tag_assignments
       WHERE saved_keyword_id IN (${placeholders(savedKeywordIds)}) AND tag_id NOT IN (${placeholders(keepTagIds)})`,
    )
    .run(...savedKeywordIds, ...keepTagIds);
  return { ...addResult, removedCount: Number(changes) };
}

export function removeTagsFromSavedKeywords(db: Store, params: { savedKeywordIds: string[]; tagIds: string[] }) {
  const savedKeywordRows = listSavedKeywordRowsByIds(db, params.savedKeywordIds);
  const tags = params.tagIds.length === 0
    ? []
    : (db.prepare(`SELECT ${tagColumns} FROM saved_keyword_tags t WHERE t.id IN (${placeholders(params.tagIds)})`).all(...params.tagIds) as SavedKeywordTagRecord[]);
  const savedKeywordIds = savedKeywordRows.map((row) => row.id);
  const tagIds = tags.map((tag) => tag.id);
  let removedCount = 0;
  if (savedKeywordIds.length > 0 && tagIds.length > 0) {
    removedCount = Number(
      db
        .prepare(
          `DELETE FROM saved_keyword_tag_assignments
           WHERE saved_keyword_id IN (${placeholders(savedKeywordIds)}) AND tag_id IN (${placeholders(tagIds)})`,
        )
        .run(...savedKeywordIds, ...tagIds).changes,
    );
  }
  return { removedCount, savedKeywordCount: savedKeywordRows.length, tags };
}

export function updateSavedKeywordTag(db: Store, params: { tagId: string; name?: string; color?: string | null }) {
  const sets: string[] = [];
  const values: SqlValue[] = [];
  if (params.name !== undefined) {
    const normalizedTag = normalizeSavedKeywordTag(params.name);
    if (!normalizedTag) return null;
    const clash = db
      .prepare("SELECT id FROM saved_keyword_tags WHERE normalized_name = ? AND id <> ?")
      .get(normalizedTag.normalizedName, params.tagId);
    if (clash) throw new AppError("VALIDATION_ERROR", `A tag named "${normalizedTag.name}" already exists`);
    sets.push("name = ?", "normalized_name = ?");
    values.push(normalizedTag.name, normalizedTag.normalizedName);
  }
  if (params.color !== undefined) {
    sets.push("color = ?");
    values.push(params.color);
  }
  if (sets.length === 0) return null;
  db.prepare(`UPDATE saved_keyword_tags SET ${sets.join(", ")} WHERE id = ?`).run(...values, params.tagId);
  return (db.prepare(`SELECT ${tagColumns} FROM saved_keyword_tags t WHERE t.id = ?`).get(params.tagId) as SavedKeywordTagRecord | undefined) ?? null;
}

export function deleteSavedKeywordTag(
  db: Store,
  params: { tagId: string },
): { status: "deleted" } | { status: "not_found" } | { status: "in_use"; assignmentCount: number } {
  if (!db.prepare("SELECT id FROM saved_keyword_tags WHERE id = ?").get(params.tagId)) return { status: "not_found" };
  // Guard: refuse to delete a tag that's still attached to saved keywords.
  // FK cascade would otherwise silently drop assignments.
  const { assignmentCount } = db
    .prepare("SELECT count(*) AS assignmentCount FROM saved_keyword_tag_assignments WHERE tag_id = ?")
    .get(params.tagId) as { assignmentCount: number };
  if (assignmentCount > 0) return { status: "in_use", assignmentCount };
  const { changes } = db.prepare("DELETE FROM saved_keyword_tags WHERE id = ?").run(params.tagId);
  return Number(changes) > 0 ? { status: "deleted" } : { status: "not_found" };
}

export function removeSavedKeywords(db: Store, savedKeywordIds: string[]) {
  if (savedKeywordIds.length === 0) return 0;
  return Number(db.prepare(`DELETE FROM saved_keywords WHERE id IN (${placeholders(savedKeywordIds)})`).run(...savedKeywordIds).changes);
}

/** Tag ids for names, for callers that address tags by name (the CLI) rather than id (the app). */
export function findTagIdsByNames(db: Store, names: string[]) {
  const normalized = normalizeSavedKeywordTags(names);
  const rows = normalized.length === 0
    ? []
    : (db.prepare(`SELECT id, normalized_name AS normalizedName FROM saved_keyword_tags WHERE normalized_name IN (${placeholders(normalized)})`)
        .all(...normalized.map((tag) => tag.normalizedName)) as Array<{ id: string; normalizedName: string }>);
  const missing = normalized.filter((tag) => !rows.some((row) => row.normalizedName === tag.normalizedName)).map((tag) => tag.name);
  return { ids: rows.map((row) => row.id), missing };
}
