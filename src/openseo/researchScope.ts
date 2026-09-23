// Ported from OpenSEO src/shared/researchScope.ts at commit
// 0ffff93101043aad7600a3b6a499a0cd2887ef49 (parsing subset only; URL.parse replaces
// try/new URL).
// Copyright (c) 2026 Ben Senescu. MIT License; see LICENSES/OpenSEO.txt.
import { parse as parseTld } from "tldts";
import { z } from "zod";

/**
 * True when `host` resolves to a real registrable domain (public-suffix list),
 * rejecting IPs and fake TLDs like `example.por` before they reach DataForSEO.
 */
export function isValidDomainHost(host: string): boolean {
  const parsed = parseTld(host, { allowPrivateDomains: true });
  return (
    !parsed.isIp &&
    !!parsed.publicSuffix &&
    (parsed.isIcann === true || parsed.isPrivate === true)
  );
}

/**
 * Research scope for any URL/domain input:
 * - exact_url:  one normalized page URL only
 * - subfolder:  the selected path and its children (not similarly named siblings)
 * - domain:     the selected hostname, excluding its subdomains
 * - subdomains: the selected hostname and all of its subdomains
 */
export const RESEARCH_SCOPES = [
  "exact_url",
  "subfolder",
  "domain",
  "subdomains",
] as const;

export type ResearchScope = (typeof RESEARCH_SCOPES)[number];

export const researchScopeSchema = z.enum(RESEARCH_SCOPES);

export type ResearchTarget = {
  scope: ResearchScope;
  /** Lowercased hostname with a leading `www.` stripped. */
  hostname: string;
  /** Hostname as entered (lowercased, `www.` preserved) for building page URLs. */
  urlHostname: string;
  /**
   * Normalized path: `""` for the root, otherwise `/like/This` — casing and
   * percent-encoding preserved, trailing slashes / query / fragment stripped.
   */
  path: string;
  /** What to show users: hostname, plus the path for URL-scoped research. */
  display: string;
};

type ParseResearchTargetResult =
  | { ok: true; target: ResearchTarget }
  | { ok: false; message: string };

function normalizePath(pathname: string): string {
  if (pathname === "/") return "";
  const trimmed = pathname.replace(/\/+$/, "");
  return trimmed === "" ? "" : trimmed;
}

/** Root inputs default to subdomains scope; inputs with a path to subfolder. */
export function defaultScopeForPath(path: string): ResearchScope {
  return path === "" ? "subdomains" : "subfolder";
}

export function parseResearchTarget(
  input: string,
  requestedScope?: ResearchScope,
): ParseResearchTargetResult {
  const trimmed = input.trim();
  if (!trimmed) {
    return { ok: false, message: "Enter a domain or URL" };
  }

  const withProtocol = /^[a-zA-Z][a-zA-Z\d+.-]*:\/\//.test(trimmed)
    ? trimmed
    : `https://${trimmed}`;

  const parsed = URL.parse(withProtocol);
  if (!parsed) {
    return { ok: false, message: "Enter a valid domain like example.com" };
  }

  if (parsed.username || parsed.password) {
    return {
      ok: false,
      message: "URLs with embedded credentials are not supported",
    };
  }

  const urlHostname = parsed.hostname.toLowerCase();
  const hostname = urlHostname.replace(/^www\./, "");
  // The charset check rejects hosts like my_site.com that URL() and tldts
  // accept but DataForSEO bills and fails with an opaque "Invalid Field".
  if (
    !hostname ||
    !hostname.includes(".") ||
    !/^[a-z\d.-]+$/.test(hostname) ||
    !isValidDomainHost(hostname)
  ) {
    return { ok: false, message: "Enter a valid domain like example.com" };
  }

  // Query strings and fragments never create separate research scopes.
  const path = normalizePath(parsed.pathname);

  if (requestedScope === "subfolder" && path === "") {
    return {
      ok: false,
      message: "Add a path to use Subfolder (e.g. example.com/blog)",
    };
  }

  const scope = requestedScope ?? defaultScopeForPath(path);

  const usesPath = scope === "exact_url" || scope === "subfolder";
  return {
    ok: true,
    target: {
      scope,
      hostname,
      urlHostname,
      path,
      display: usesPath ? `${hostname}${path}` : hostname,
    },
  };
}
