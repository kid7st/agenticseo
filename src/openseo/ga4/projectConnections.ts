// Local stand-ins for OpenSEO's Ga4ConnectionRepository
// (src/server/features/ga4/repositories/Ga4ConnectionRepository.ts) and the
// connection half of GscService, as the ported GA4 services call them. The
// "project id" they pass is the project root, and a connection is the project's
// `analytics` or `searchConsole` entry in project.json.
import { getPerformance } from "../gsc/GscService.js";
import type { GscPerformanceInput } from "../gsc/searchAnalytics.js";
import { readProject } from "../../project.js";

export type Ga4Connection = {
  propertyId: string;
  propertyDisplayName: string;
  propertyTimeZone: string;
  propertyCurrencyCode: string;
  /** Upstream's OpenSEO user; a local grant is owned by the Google account alone. */
  connectedByUserId: string;
  ga4AccountId: string;
  connectedAccountEmail: string | null;
};

export const Ga4ConnectionRepository = {
  async getByProjectId(projectRoot: string): Promise<Ga4Connection | null> {
    const analytics = (await readProject(projectRoot)).analytics;
    if (!analytics) return null;
    const { accountId, accountEmail, ...property } = analytics;
    return { ...property, connectedByUserId: "local", ga4AccountId: accountId, connectedAccountEmail: accountEmail };
  },
};

export const GscService = {
  async getConnection(projectRoot: string) {
    return (await readProject(projectRoot)).searchConsole ?? null;
  },
  async getPerformance({ projectId, ...input }: GscPerformanceInput) {
    return getPerformance((await readProject(projectId)).searchConsole, input);
  },
};
