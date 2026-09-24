// Ported from OpenSEO src/server/lib/ga4Errors.ts at commit
// 0ffff93101043aad7600a3b6a499a0cd2887ef49.
// Copyright (c) 2026 Ben Senescu. MIT License; see LICENSES/OpenSEO.txt.
// Local change: Ga4ReportError is an OperationError whose exit code follows its
// code, and its message names the command that resolves it.
import { OperationError } from "../../errors.js";
export class Ga4AdminApiError extends Error {
  constructor(
    public readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = "Ga4AdminApiError";
  }
}

export class Ga4TokenError extends Error {
  constructor(
    message: string,
    public readonly cause?: unknown,
  ) {
    super(message);
    this.name = "Ga4TokenError";
  }
}

export class Ga4DataApiError extends Error {
  constructor(
    public readonly status: number,
    message: string,
    public readonly retryAfterSeconds: number | null = null,
    public readonly upstreamReason: string | null = null,
  ) {
    super(message);
    this.name = "Ga4DataApiError";
  }
}

export class Ga4MalformedResponseError extends Error {
  constructor() {
    super("Google Analytics returned an invalid reporting response.");
    this.name = "Ga4MalformedResponseError";
  }
}

type Ga4ReportErrorCode =
  | "validation_error"
  | "ga4_not_connected"
  | "ga4_reconnect_required"
  | "ga4_property_inaccessible"
  | "ga4_report_incompatible"
  | "ga4_quota_exhausted"
  | "ga4_upstream_unavailable"
  | "ga4_malformed_response";

// How each report failure exits: reconnecting or regaining property access is a
// credentials problem, a bad request or missing connection the caller's, and
// the rest Google's.
const KINDS: Record<Ga4ReportErrorCode, OperationError["kind"]> = {
  validation_error: "input",
  ga4_not_connected: "input",
  ga4_reconnect_required: "credentials",
  ga4_property_inaccessible: "credentials",
  ga4_report_incompatible: "input",
  ga4_quota_exhausted: "provider",
  ga4_upstream_unavailable: "provider",
  ga4_malformed_response: "provider",
};

const HINTS: Partial<Record<Ga4ReportErrorCode, string>> = {
  ga4_not_connected: " Run agenticseo ga4 properties, then agenticseo ga4 use PROPERTY_ID.",
  ga4_reconnect_required: " Run agenticseo google connect --for analytics.",
};

export class Ga4ReportError extends OperationError {
  constructor(
    public readonly code: Ga4ReportErrorCode,
    message: string,
    public readonly retryAfterSeconds: number | null = null,
  ) {
    super(KINDS[code], `${message}${HINTS[code] ?? ""}${retryAfterSeconds ? ` Retry after ${retryAfterSeconds} s.` : ""}`);
    this.name = "Ga4ReportError";
  }
}
