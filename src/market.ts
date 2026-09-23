import { OperationError } from "./errors.js";
import {
  getIsoCountryCode,
  getLanguageCode,
  isSupportedLanguageCode,
  isSupportedLocationCode,
  LOCATION_OPTIONS,
  resolveMarket,
} from "./openseo/keyword-locations.js";
import { assertLanguageForLocation } from "./openseo/market.js";

export type Market = { locationCode: number; languageCode: string };

/**
 * A DataForSEO country location code, or its two-letter country code ("US", "GB";
 * "UK" also works). OpenSEO's UI picks from the same country table.
 */
function parseLocation(value: string): number {
  const code = /^\d+$/.test(value)
    ? Number(value)
    : LOCATION_OPTIONS.find((option) => getIsoCountryCode(option.code) === value.toLowerCase() || option.shortLabel === value.toUpperCase())?.code;
  if (code === undefined || !isSupportedLocationCode(code)) {
    throw new OperationError("input", `Unsupported location "${value}": use a DataForSEO country location code such as 2840, or a two-letter country code such as US`);
  }
  return code;
}

function parseLanguage(value: string) {
  if (!isSupportedLanguageCode(value)) throw new OperationError("input", `Unsupported language code "${value}"`);
  return value;
}

/**
 * OpenSEO's resolveMarketInput for a new project: the language defaults to the
 * country's and must be one DataForSEO serves there, checked before any paid call.
 */
export function marketForNewProject(location: string | undefined, language: string | undefined): Market {
  if (!location) throw new OperationError("input", "--location is required: a DataForSEO country location code such as 2840, or a two-letter country code such as US");
  const locationCode = parseLocation(location);
  const languageCode = language ? parseLanguage(language) : getLanguageCode(locationCode);
  assertLanguageForLocation(locationCode, languageCode);
  return { locationCode, languageCode };
}

/**
 * OpenSEO's resolveMarket for a per-call override: changing only the location
 * snaps the language to that country's default instead of keeping the project's.
 */
export function marketForCall(project: Market, overrides: { location?: string; language?: string }): Market {
  const market = resolveMarket(
    {
      locationCode: overrides.location ? parseLocation(overrides.location) : undefined,
      languageCode: overrides.language ? parseLanguage(overrides.language) : undefined,
    },
    project,
  );
  assertLanguageForLocation(market.locationCode, market.languageCode);
  return market;
}
