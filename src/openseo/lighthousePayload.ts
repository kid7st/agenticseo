// Ported from OpenSEO src/server/lib/lighthousePayload.ts at commit
// 0ffff93101043aad7600a3b6a499a0cd2887ef49.
// Copyright (c) 2026 Ben Senescu. MIT License; see LICENSES/OpenSEO.txt.
// Local change: a native sort replaces remeda's sortBy (same keys and order).
import type { LighthouseCategory } from "./shared/lighthouse.js";
import { jsonCodec } from "./shared/json.js";
import {
  storedLighthousePayloadSchema,
  type StoredLighthouseIssue,
  type StoredLighthousePayload,
} from "./lighthouseStoredPayload.js";

const storedPayloadCodec = jsonCodec(storedLighthousePayloadSchema);

type ExportMode = "full" | "issues" | "category";

type LighthouseIssueReport = {
  issues: StoredLighthouseIssue[];
  hasIssueDetails: boolean;
};

function sortIssues(issues: StoredLighthouseIssue[]) {
  const impact = (issue: StoredLighthouseIssue) =>
    (issue.impactMs ?? 0) * 1000 + (issue.impactBytes ?? 0);
  return [...issues].sort(
    (a, b) => impact(b) - impact(a) || (a.score ?? 100) - (b.score ?? 100),
  );
}

function parseStoredLighthousePayload(
  payloadJson: string,
): StoredLighthousePayload | null {
  const storedPayload = storedPayloadCodec.safeParse(payloadJson);
  if (storedPayload.success) {
    return storedPayload.data;
  }

  try {
    JSON.parse(payloadJson);
  } catch {
    throw new Error("Invalid Lighthouse payload JSON");
  }

  return null;
}

function buildLighthouseIssueReport(
  storedPayload: StoredLighthousePayload | null,
  categoryFilter?: LighthouseCategory,
): LighthouseIssueReport {
  if (!storedPayload) {
    return {
      hasIssueDetails: false,
      issues: [],
    };
  }

  const filteredIssues = categoryFilter
    ? storedPayload.issues.filter((issue) => issue.category === categoryFilter)
    : storedPayload.issues;

  return {
    hasIssueDetails: storedPayload.hasIssueDetails,
    issues: sortIssues(filteredIssues),
  };
}

export function readStoredLighthousePayload(
  payloadJson: string,
  categoryFilter?: LighthouseCategory,
) {
  const storedPayload = parseStoredLighthousePayload(payloadJson);

  return {
    storedPayload,
    report: buildLighthouseIssueReport(storedPayload, categoryFilter),
  };
}

export function buildLighthouseExportFile(input: {
  idField: "auditId" | "resultId";
  idValue: string;
  finalUrl: string;
  strategy: "mobile" | "desktop";
  createdAt: string;
  payloadJson: string;
  mode: ExportMode;
  category?: LighthouseCategory;
}) {
  const safeDate = input.createdAt.replace(/[:.]/g, "-");
  const baseName = `lighthouse-${input.strategy}-${safeDate}`;

  if (input.mode === "full") {
    return {
      filename: `${baseName}-payload.json`,
      content: input.payloadJson,
    };
  }

  const { report } = readStoredLighthousePayload(
    input.payloadJson,
    input.category,
  );

  return {
    filename:
      input.mode === "category" && input.category
        ? `${baseName}-${input.category}-issues.json`
        : `${baseName}-issues.json`,
    content: JSON.stringify(
      {
        [input.idField]: input.idValue,
        finalUrl: input.finalUrl,
        strategy: input.strategy,
        createdAt: input.createdAt,
        category: input.category ?? "all",
        issues: report.issues,
      },
      null,
      2,
    ),
  };
}
