// Search Console commands. The query and inspection shaping follows OpenSEO's
// src/server/mcp/tools/search-console-tools.ts, and the report and export follow
// src/serverFunctions/searchPerformance.ts, at commit
// 0ffff93101043aad7600a3b6a499a0cd2887ef49 (Copyright (c) 2026 Ben Senescu, MIT;
// see LICENSES/OpenSEO.txt). Local changes: a missing or dead connection is an
// error with an exit code, not a `connected: false` or `ok: false` result.
import { OperationError } from "./errors.js";
import { toCsv, toJsonl, writeExport } from "./export.js";
import { getPerformance, inspectUrls, listSites, resolveSite, type GscConnection } from "./openseo/gsc/GscService.js";
import {
  GSC_DEFAULT_ROW_LIMIT,
  GSC_MAX_ROW_LIMIT,
  resolveDateRange,
  type GscDateRange,
  type GscDimension,
  type GscPerformanceFilter,
  type GscSearchType,
} from "./openseo/gsc/searchAnalytics.js";
import { buildStrikingDistanceRows, previousPeriod, sumSearchTotals, toDimensionRows } from "./openseo/gsc/searchPerformanceReport.js";
import { readProject, writeProject } from "./project.js";

type GscPerfRow = { keys?: string[]; clicks: number; impressions: number; ctr: number; position?: number };
type MetricFilter = { minPosition?: number; maxPosition?: number; minImpressions?: number };

const connectionOf = async (root: string): Promise<GscConnection | undefined> => (await readProject(root)).searchConsole;

export { listSites as searchConsoleSites };

/** Map a verified property to this project (OpenSEO's setSite). */
export async function useSearchConsoleSite(root: string, input: { siteUrl: string; account?: string }) {
  const connection = await resolveSite(input);
  const project = await readProject(root);
  await writeProject(root, { ...project, searchConsole: connection });
  return { searchConsole: connection };
}

export async function disconnectSearchConsole(root: string) {
  const { searchConsole, ...project } = await readProject(root);
  if (!searchConsole) throw new OperationError("input", "Search Console is not connected for this project");
  await writeProject(root, project);
  return { disconnected: searchConsole.siteUrl };
}

// Rows without a position (discover/googleNews) never match a position bound.
function matchesMetricFilter(row: GscPerfRow, filter: MetricFilter): boolean {
  if (filter.minImpressions !== undefined && row.impressions < filter.minImpressions) return false;
  if (filter.minPosition !== undefined && (row.position === undefined || row.position < filter.minPosition)) return false;
  if (filter.maxPosition !== undefined && (row.position === undefined || row.position > filter.maxPosition)) return false;
  return true;
}

// Google returns full-precision floats; four decimals of CTR and one of position is all anyone reads.
function roundMetrics<T extends GscPerfRow>(row: T): T {
  return { ...row, ctr: Math.round(row.ctr * 10_000) / 10_000, ...(row.position === undefined ? {} : { position: Math.round(row.position * 10) / 10 }) };
}

/**
 * OpenSEO's get_search_console_performance. Google sorts by clicks and cannot
 * filter by position or impressions, so a metric filter fetches the top 1000 rows
 * of the window and filters here; pagination stays in Google's row space.
 */
export async function searchConsolePerformance(
  root: string,
  input: {
    dimensions?: GscDimension[];
    dateRange?: GscDateRange;
    startDate?: string;
    endDate?: string;
    filters?: GscPerformanceFilter[];
    rowLimit?: number;
    startRow?: number;
    type?: GscSearchType;
    dataState?: "all" | "final";
  } & MetricFilter,
) {
  // GSC rejects searchAppearance combined with any other dimension.
  if (input.dimensions?.includes("searchAppearance") && input.dimensions.length > 1) {
    throw new OperationError("input", "searchAppearance must be the only dimension when used");
  }
  // A half-specified explicit range would silently fall back to a default window.
  if (Boolean(input.startDate) !== Boolean(input.endDate)) {
    throw new OperationError("input", "Provide both --start and --end, or neither (use --range instead)");
  }
  const { minPosition, maxPosition, minImpressions, rowLimit, ...query } = input;
  const metricFilter = minPosition !== undefined || maxPosition !== undefined || minImpressions !== undefined ? { minPosition, maxPosition, minImpressions } : null;
  const requestedLimit = rowLimit ?? GSC_DEFAULT_ROW_LIMIT;
  const fetchLimit = metricFilter ? GSC_MAX_ROW_LIMIT : requestedLimit;
  const result = await getPerformance(await connectionOf(root), { ...query, rowLimit: fetchLimit });

  const startRow = result.request.startRow ?? 0;
  const fetched = result.rows;
  const kept = metricFilter ? fetched.filter((row) => matchesMetricFilter(row, metricFilter)) : fetched;
  const rows = kept.slice(0, requestedLimit).map(roundMetrics);
  const lastReturned = kept[rows.length - 1];
  const truncated = kept.length > rows.length;
  const hasMore = truncated || fetched.length >= fetchLimit;
  const nextStartRow = truncated && lastReturned ? startRow + fetched.indexOf(lastReturned) + 1 : startRow + fetched.length;
  return {
    source: "Google Search Console",
    siteUrl: result.siteUrl,
    connectedBy: result.connectedBy,
    startDate: result.request.startDate,
    endDate: result.request.endDate,
    dimensions: result.request.dimensions ?? ["query"],
    ...(metricFilter && { filteredFrom: fetched.length }),
    rowCount: rows.length,
    rows,
    hasMore,
    nextStartRow: hasMore ? nextStartRow : undefined,
  };
}

/** OpenSEO's inspect_urls: index, crawl and canonical state for 1–10 URLs of the property. */
export async function searchConsoleInspect(root: string, input: { urls: string[]; languageCode?: string }) {
  if (input.urls.length > 10) throw new OperationError("input", "Inspect at most 10 URLs per call");
  for (const url of input.urls) {
    if (!URL.canParse(url)) throw new OperationError("input", `${url} is not an absolute URL`);
  }
  return { source: "Google Search Console", ...(await inspectUrls(await connectionOf(root), input)) };
}

// query x page fan-out needs more rows to find the 5..20 band.
const STRIKING_DISTANCE_FETCH_LIMIT = 1000;
// dimensions:["date"] returns one row per day; the longest range is ~92 days.
const DAILY_ROW_LIMIT = 200;
const COUNTRY_ROW_LIMIT = 25;
const EXPORT_ROW_LIMIT = 1000;

type ReportFilters = { dateRange: "last_7_days" | "last_28_days" | "last_3_months"; device?: string; country?: string };

/** Device applies everywhere; country everywhere except the country breakdown itself. */
function buildGscFilters(data: { device?: string; country?: string }) {
  const deviceFilters: GscPerformanceFilter[] = data.device ? [{ dimension: "device", operator: "equals", expression: data.device }] : [];
  const filters: GscPerformanceFilter[] = data.country ? [...deviceFilters, { dimension: "country", operator: "equals", expression: data.country.toLowerCase() }] : deviceFilters;
  return { deviceFilters, filters };
}

/**
 * OpenSEO's Search Performance overview: current and previous-period totals,
 * striking-distance queries (best page at positions 5–20) and the country list.
 */
export async function searchConsoleReport(root: string, input: ReportFilters) {
  const connection = await connectionOf(root);
  const { startDate, endDate } = resolveDateRange({ dateRange: input.dateRange });
  const prev = previousPeriod(startDate, endDate);
  const { deviceFilters, filters } = buildGscFilters(input);
  const [current, previous, queryPages, countries] = await Promise.all([
    getPerformance(connection, { startDate, endDate, dimensions: ["date"], filters, rowLimit: DAILY_ROW_LIMIT }),
    getPerformance(connection, { startDate: prev.startDate, endDate: prev.endDate, dimensions: ["date"], filters, rowLimit: DAILY_ROW_LIMIT }),
    getPerformance(connection, { startDate, endDate, dimensions: ["query", "page"], filters, rowLimit: STRIKING_DISTANCE_FETCH_LIMIT }),
    getPerformance(connection, { startDate, endDate, dimensions: ["country"], filters: deviceFilters, rowLimit: COUNTRY_ROW_LIMIT }),
  ]);
  return {
    source: "Google Search Console",
    siteUrl: current.siteUrl,
    range: { startDate, endDate, prevStartDate: prev.startDate, prevEndDate: prev.endDate },
    totals: sumSearchTotals(current.rows),
    prevTotals: sumSearchTotals(previous.rows),
    strikingDistance: buildStrikingDistanceRows(queryPages.rows),
    countries: toDimensionRows(countries.rows),
  };
}

/** OpenSEO's table export: the whole query or page dimension (up to 1000 rows) as CSV or JSON lines. */
export async function exportSearchConsole(root: string, input: ReportFilters & { dimension: "query" | "page"; format: "csv" | "jsonl"; out?: string }) {
  const { startDate, endDate } = resolveDateRange({ dateRange: input.dateRange });
  const result = await getPerformance(await connectionOf(root), {
    startDate,
    endDate,
    dimensions: [input.dimension],
    filters: buildGscFilters(input).filters,
    rowLimit: EXPORT_ROW_LIMIT,
  });
  const rows = toDimensionRows(result.rows);
  if (rows.length === 0) throw new OperationError("input", `Search Console has no ${input.dimension} rows for ${startDate} to ${endDate}; nothing to export`);
  const content =
    input.format === "csv"
      ? toCsv(
          [input.dimension === "query" ? "Query" : "Page", "Clicks", "Impressions", "CTR", "Position"],
          rows.map((row) => [row.key, row.clicks, row.impressions, row.ctr, row.position]),
        )
      : toJsonl(rows);
  const file = await writeExport(root, { name: `search-console-${input.dimension}`, format: input.format, content, out: input.out });
  return { source: "Google Search Console", siteUrl: result.siteUrl, startDate, endDate, dimension: input.dimension, file, format: input.format, rowCount: rows.length };
}
