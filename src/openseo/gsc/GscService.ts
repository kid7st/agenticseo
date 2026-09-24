// Adapted from OpenSEO src/server/features/gsc/services/GscService.ts at commit
// 0ffff93101043aad7600a3b6a499a0cd2887ef49.
// Copyright (c) 2026 Ben Senescu. MIT License; see LICENSES/OpenSEO.txt.
// Local changes: the connection is the project's `searchConsole` entry in
// project.json and the grant is a locally stored Google account; the account
// email comes from the stored grant instead of a userinfo call; an account whose
// properties cannot be listed carries the reason instead of a log line; when no
// account is named, the property is looked up across connected accounts; a denied
// URL inspection (401/403) stops the batch like an expired grant, as the
// Search Console spec says connection-level failures should.
import { listGoogleAccounts } from "../../google.js";
import { OperationError } from "../../errors.js";
import { AppError } from "../platform.js";
import { createGscClient, type GscSearchAnalyticsRequest, type GscSearchAnalyticsRow, type GscSite, type UrlInspectionResult } from "./gscClient.js";
import { GscNotConnectedError, GscTokenError } from "./gscErrors.js";
import { buildSearchAnalyticsRequest, type GscPerformanceInput } from "./searchAnalytics.js";

const SITE_UNVERIFIED_PERMISSION = "siteUnverifiedUser";

export type GscConnection = { siteUrl: string; accountId: string; accountEmail: string | null };

/** Expected ways a stored grant fails to reach Search Console: no token could be
 *  minted (refresh token revoked or expired), or Google rejected the call
 *  (401/403). These call for reconnecting rather than a retry. */
export function isExpectedGrantFailure(error: unknown): boolean {
  // GscApiError carries its kind: 401/403 are credentials, except an API not
  // enabled in the Cloud project, which reconnecting would not fix.
  return error instanceof GscTokenError || (error instanceof OperationError && error.kind === "credentials");
}

const searchConsoleAccounts = async () => (await listGoogleAccounts()).filter((account) => account.products.includes("searchConsole"));

/** Every connected account's Search Console properties, with the reason when an account cannot list them. */
export async function listSites() {
  const accounts = await searchConsoleAccounts();
  if (accounts.length === 0) throw new OperationError("credentials", "No Google account is connected for Search Console; run agenticseo google connect");
  const failures: unknown[] = [];
  const listed = await Promise.all(
    accounts.map(async (account) => {
      try {
        return { accountId: account.accountId, email: account.email, requiresReconnect: false, sites: await createGscClient({ accountId: account.accountId }).listSites() };
      } catch (error) {
        failures.push(error);
        return {
          accountId: account.accountId,
          email: account.email,
          requiresReconnect: isExpectedGrantFailure(error),
          error: error instanceof Error ? error.message : String(error),
          sites: [] as GscSite[],
        };
      }
    }),
  );
  // One account failing among others is reported per account; when none can
  // list anything, the command fails with the reason instead of an empty list.
  if (failures.length === accounts.length) throw failures[0];
  return { accounts: listed };
}

/** Pick a verified property for the project. Rejects unverified properties and ones no connected account can read. */
export async function resolveSite(input: { siteUrl: string; account?: string }): Promise<GscConnection> {
  const accounts = (await searchConsoleAccounts()).filter(
    (account) => !input.account || account.accountId === input.account || account.email?.toLowerCase() === input.account.toLowerCase(),
  );
  if (accounts.length === 0) {
    throw new OperationError("credentials", `No Google account${input.account ? ` ${input.account}` : ""} is connected for Search Console; run agenticseo google connect`);
  }
  const holders: Array<{ account: (typeof accounts)[number]; site: GscSite }> = [];
  for (const account of accounts) {
    const site = (await createGscClient({ accountId: account.accountId }).listSites()).find((candidate) => candidate.siteUrl === input.siteUrl);
    if (site) holders.push({ account, site });
  }
  const verified = holders.filter((holder) => holder.site.permissionLevel !== SITE_UNVERIFIED_PERMISSION);
  if (holders.length === 0) {
    throw new AppError("VALIDATION_ERROR", `${input.siteUrl} isn't available on the connected Google account(s); run agenticseo gsc sites for exact property names (URL-prefix properties end with /, domain properties start with sc-domain:)`);
  }
  if (verified.length === 0) throw new OperationError("credentials", `You don't have verified access to the Search Console property ${input.siteUrl}`);
  if (verified.length > 1) {
    throw new AppError("VALIDATION_ERROR", `Several connected accounts can read ${input.siteUrl} (${verified.map((holder) => holder.account.email ?? holder.account.accountId).join(", ")}); pass --account`);
  }
  return { siteUrl: input.siteUrl, accountId: verified[0].account.accountId, accountEmail: verified[0].account.email };
}

type GscPerformanceResult = {
  siteUrl: string;
  connectedBy: string | null;
  request: GscSearchAnalyticsRequest;
  rows: GscSearchAnalyticsRow[];
};

/** Pass-through of GSC `searchAnalytics.query` for a project's connected property. */
export async function getPerformance(connection: GscConnection | undefined, input: Omit<GscPerformanceInput, "projectId">): Promise<GscPerformanceResult> {
  if (!connection) throw new GscNotConnectedError();
  const request = buildSearchAnalyticsRequest({ projectId: "local", ...input });
  const rows = await createGscClient({ accountId: connection.accountId }).querySearchAnalytics(connection.siteUrl, request);
  return { siteUrl: connection.siteUrl, connectedBy: connection.accountEmail, request, rows };
}

type GscUrlInspection = {
  url: string;
  result: UrlInspectionResult | null;
  error?: string;
};

/** Inspect 1–N URLs against a project's connected property. Per-URL failures
 *  are captured inline so one bad URL doesn't fail the batch; a grant or access
 *  failure stops the batch so the caller can reconnect. */
export async function inspectUrls(connection: GscConnection | undefined, input: { urls: string[]; languageCode?: string }) {
  if (!connection) throw new GscNotConnectedError();
  const client = createGscClient({ accountId: connection.accountId });
  const results: GscUrlInspection[] = [];
  for (const url of input.urls) {
    try {
      results.push({ url, result: await client.inspectUrl(connection.siteUrl, url, input.languageCode) });
    } catch (error) {
      if (isExpectedGrantFailure(error)) throw error;
      results.push({ url, result: null, error: error instanceof Error ? error.message : "Inspection failed" });
    }
  }
  return { siteUrl: connection.siteUrl, connectedBy: connection.accountEmail, results };
}
