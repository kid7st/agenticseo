// Ported from OpenSEO src/server/features/domain/services/pagination.ts at commit
// 0ffff93101043aad7600a3b6a499a0cd2887ef49.
// Copyright (c) 2026 Ben Senescu. MIT License; see LICENSES/OpenSEO.txt.
/** Whether more pages exist, given the raw provider row count for this page
 *  (`response.items.length`). */
export function computeHasMore(
  offset: number,
  fetchedCount: number,
  totalCount: number | null | undefined,
  pageSize: number,
): boolean {
  return totalCount != null
    ? offset + fetchedCount < totalCount
    : fetchedCount === pageSize;
}
