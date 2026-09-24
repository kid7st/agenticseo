// Ported from OpenSEO src/server/lib/gscErrors.ts at commit
// 0ffff93101043aad7600a3b6a499a0cd2887ef49.
// Copyright (c) 2026 Ben Senescu. MIT License; see LICENSES/OpenSEO.txt.
// Local change: the errors are OperationErrors, so each exits with the code an
// agent branches on (credentials for denied access, input for not connected).
import { OperationError } from "../../errors.js";

/** Denied access (401/403) is a credentials problem; a bad request or missing
 *  property is the caller's; anything else is Google's. */
function kindForStatus(status: number): OperationError["kind"] {
  if (status === 401 || status === 403) return "credentials";
  if (status === 400 || status === 404) return "input";
  return "provider";
}

export class GscApiError extends OperationError {
  constructor(
    public readonly status: number,
    message: string,
    public readonly body?: string,
  ) {
    super(kindForStatus(status), message);
    this.name = "GscApiError";
  }
}

export class GscTokenError extends OperationError {
  constructor(
    message: string,
    public readonly cause?: unknown,
  ) {
    super("credentials", message);
    this.name = "GscTokenError";
  }
}

export class GscNotConnectedError extends OperationError {
  constructor() {
    super("input", "Search Console is not connected for this project; run agenticseo gsc sites, then agenticseo gsc use SITE_URL");
    this.name = "GscNotConnectedError";
  }
}
