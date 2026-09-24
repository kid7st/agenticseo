// Google Analytics commands. Property discovery and selection follow OpenSEO's
// src/server/features/ga4/services/Ga4Service.ts, and each report maps its options
// onto the report kinds as src/server/mcp/tools/google-analytics-tools.ts does, at
// commit 0ffff93101043aad7600a3b6a499a0cd2887ef49 (Copyright (c) 2026 Ben
// Senescu, MIT; see LICENSES/OpenSEO.txt). Local changes: the connection is the
// project's `analytics` entry in project.json; failures exit with a code instead
// of returning `status: "error"`; an account whose properties cannot be listed
// carries the reason instead of a log line.
import { listGoogleAccounts } from "./google.js";
import { OperationError } from "./errors.js";
import { createGa4AdminClient } from "./openseo/ga4/ga4Client.js";
import { Ga4AdminApiError } from "./openseo/ga4/ga4Errors.js";
import { Ga4MeasurementHealthService } from "./openseo/ga4/Ga4MeasurementHealthService.js";
import { Ga4OrganicOverviewService } from "./openseo/ga4/Ga4OrganicOverviewService.js";
import { Ga4ReportingService, mapGa4ReportError, type Ga4ReportInput } from "./openseo/ga4/Ga4ReportingService.js";
import { SearchOpportunityService } from "./openseo/ga4/SearchOpportunityService.js";
import { readProject, writeProject } from "./project.js";

const analyticsAccounts = async () => (await listGoogleAccounts()).filter((account) => account.products.includes("analytics"));

/** Every connected account's GA4 properties, with the reason when an account cannot list them. */
export async function analyticsProperties() {
  const accounts = await analyticsAccounts();
  if (accounts.length === 0) throw new OperationError("credentials", "No Google account is connected for Google Analytics; run agenticseo google connect --for analytics");
  return {
    accounts: await Promise.all(
      accounts.map(async (account) => {
        try {
          const properties = await createGa4AdminClient({ userId: "local", ga4AccountId: account.accountId }).listProperties();
          return { accountId: account.accountId, email: account.email, requiresReconnect: false, properties };
        } catch (error) {
          const requiresReconnect = (error instanceof OperationError && error.kind === "credentials") || (error instanceof Ga4AdminApiError && error.status === 401);
          return { accountId: account.accountId, email: account.email, requiresReconnect, error: error instanceof Error ? error.message : String(error), properties: [] };
        }
      }),
    ),
  };
}

/** Map a GA4 property (properties/123 or 123) to this project, recording its time zone and currency. */
export async function useAnalyticsProperty(root: string, input: { propertyId: string; account?: string }) {
  const propertyId = /^\d+$/.test(input.propertyId) ? `properties/${input.propertyId}` : input.propertyId;
  const accounts = (await analyticsAccounts()).filter(
    (account) => !input.account || account.accountId === input.account || account.email?.toLowerCase() === input.account.toLowerCase(),
  );
  if (accounts.length === 0) {
    throw new OperationError("credentials", `No Google account${input.account ? ` ${input.account}` : ""} is connected for Google Analytics; run agenticseo google connect --for analytics`);
  }
  const holders = [];
  for (const account of accounts) {
    const client = createGa4AdminClient({ userId: "local", ga4AccountId: account.accountId });
    if ((await client.listProperties()).some((property) => property.propertyId === propertyId)) holders.push({ account, client });
  }
  if (holders.length === 0) throw new OperationError("input", `${propertyId} isn't available on the connected Google account(s); run agenticseo ga4 properties`);
  if (holders.length > 1) {
    throw new OperationError("input", `Several connected accounts can read ${propertyId} (${holders.map((holder) => holder.account.email ?? holder.account.accountId).join(", ")}); pass --account`);
  }
  const [{ account, client }] = holders;
  let property;
  try {
    property = await client.getProperty(propertyId);
  } catch (error) {
    mapGa4ReportError(error);
  }
  const analytics = {
    propertyId: property.name,
    propertyDisplayName: property.displayName,
    propertyTimeZone: property.timeZone,
    propertyCurrencyCode: property.currencyCode,
    accountId: account.accountId,
    accountEmail: account.email,
  };
  await writeProject(root, { ...(await readProject(root)), analytics });
  return { analytics };
}

export async function disconnectAnalytics(root: string) {
  const { analytics, ...project } = await readProject(root);
  if (!analytics) throw new OperationError("input", "Google Analytics is not connected for this project");
  await writeProject(root, project);
  return { disconnected: analytics.propertyId };
}

export const GA4_REPORTS = ["landing-pages", "page-performance", "key-events", "traffic-acquisition", "ecommerce", "site-search", "audience"] as const;
export type Ga4Report = (typeof GA4_REPORTS)[number];

type ReportOptions = {
  startDate?: string;
  endDate?: string;
  limit?: number;
  offset?: number;
  channel?: "organic_search" | "all";
  breakdown?: string;
  includeDate?: boolean;
  compare?: boolean;
  onlyWithTransactions?: boolean;
};

const BREAKDOWNS: Partial<Record<Ga4Report, readonly string[]>> = {
  "key-events": ["event", "event_and_landing_page"],
  "traffic-acquisition": ["channel_group", "source_medium", "campaign"],
  ecommerce: ["item", "landing_page"],
  audience: ["device", "country", "new_vs_returning"],
};

/** The report kind and options each OpenSEO GA4 tool sends, with the tools' defaults. */
function reportInput(report: Ga4Report, options: ReportOptions): Omit<Ga4ReportInput, "projectId"> {
  const allowed = BREAKDOWNS[report];
  if (options.breakdown !== undefined && !allowed?.includes(options.breakdown)) {
    throw new OperationError("input", allowed ? `--breakdown for ${report} must be one of ${allowed.join(", ")}` : `${report} has no --breakdown`);
  }
  const channelled = report === "page-performance" || report === "key-events" || report === "ecommerce" || report === "audience";
  if (options.channel && !channelled) throw new OperationError("input", `${report} has no --channel`);
  if (options.includeDate && report !== "page-performance") throw new OperationError("input", "--include-date is only for page-performance");
  if (options.onlyWithTransactions && report !== "ecommerce") throw new OperationError("input", "--only-with-transactions is only for ecommerce");
  const common = { startDate: options.startDate, endDate: options.endDate, limit: options.limit ?? 100, offset: options.offset ?? 0 };
  const channel = options.channel ?? "organic_search";
  const comparePreviousPeriod = options.compare ?? false;
  switch (report) {
    case "landing-pages":
      return { ...common, kind: "landing_pages", channel: "organic_search" };
    case "page-performance":
      return { ...common, kind: "page_performance", channel, includeDate: options.includeDate ?? false };
    case "key-events":
      return { ...common, kind: "key_events", channel, breakdown: (options.breakdown ?? "event") as Ga4ReportInput["breakdown"], comparePreviousPeriod };
    case "traffic-acquisition":
      return { ...common, kind: "traffic_acquisition", channel: "all", acquisitionBreakdown: (options.breakdown ?? "channel_group") as Ga4ReportInput["acquisitionBreakdown"], comparePreviousPeriod };
    case "ecommerce":
      return {
        ...common,
        kind: "ecommerce_performance",
        channel,
        ecommerceBreakdown: (options.breakdown ?? "item") as Ga4ReportInput["ecommerceBreakdown"],
        ecommerceOnlyWithTransactions: options.onlyWithTransactions ?? false,
      };
    case "site-search":
      return { ...common, kind: "site_search", channel: "all" };
    case "audience":
      return { ...common, kind: "audience_breakdown", channel, audienceBreakdown: (options.breakdown ?? "device") as Ga4ReportInput["audienceBreakdown"], comparePreviousPeriod };
  }
}

/** One of OpenSEO's GA4 reports for the project's property. */
export async function analyticsReport(root: string, report: Ga4Report, options: ReportOptions) {
  return Ga4ReportingService.runReport({ projectId: root, ...reportInput(report, options) });
}

/** get_google_analytics_organic_overview: organic totals against the previous period, a trend and diagnostics. */
export async function analyticsOverview(root: string, input: { startDate?: string; endDate?: string; trend?: "daily" | "weekly" }) {
  return Ga4OrganicOverviewService.getOrganicOverview({ projectId: root, ...input });
}

/** get_google_analytics_measurement_health: data streams, enhanced measurement, key events and custom definitions. */
export async function analyticsHealth(root: string) {
  return Ga4MeasurementHealthService.getMeasurementHealth(root);
}

/** get_search_opportunities: Search Console demand joined with GA4 engagement per landing page. */
export async function searchOpportunities(root: string, input: { startDate?: string; endDate?: string; limit?: number }) {
  return SearchOpportunityService.getOpportunities({ projectId: root, ...input });
}
