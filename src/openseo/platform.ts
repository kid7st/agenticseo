// Local stand-ins for the Worker-bound OpenSEO modules the ported code imports:
// src/server/lib/errors.ts (AppError), src/shared/error-codes.ts (ErrorCode) and
// src/server/lib/runtime-env.ts (getRequiredEnvValue). Ported files keep their
// upstream calls; this file decides what those mean for a local CLI.
import { OperationError } from "../errors.js";

/** The subset of OpenSEO's error codes the ported code raises. */
export type ErrorCode =
  | "VALIDATION_ERROR"
  | "DATAFORSEO_AUTH_FAILED"
  | "RATE_LIMITED"
  | "UPSTREAM_UNAVAILABLE"
  | "BACKLINKS_BILLING_ISSUE"
  | "AHREFS_AUTH_FAILED"
  | "INTERNAL_ERROR";

// INTERNAL_ERROR from provider code means DataForSEO returned something we
// cannot use (empty body, missing task or billing, bad shape): a provider failure
// from the CLI's point of view, not a local bug.
const kinds: Record<ErrorCode, OperationError["kind"]> = {
  VALIDATION_ERROR: "input",
  DATAFORSEO_AUTH_FAILED: "credentials",
  RATE_LIMITED: "provider",
  UPSTREAM_UNAVAILABLE: "provider",
  // The user's DataForSEO balance: they fix it with DataForSEO, like any provider-side failure.
  BACKLINKS_BILLING_ISSUE: "provider",
  AHREFS_AUTH_FAILED: "credentials",
  INTERNAL_ERROR: "provider",
};

export class AppError extends OperationError {
  readonly code: ErrorCode;
  readonly details?: Record<string, string>;

  constructor(code: ErrorCode, message?: string, details?: Record<string, string>) {
    super(kinds[code], message ?? code);
    this.name = "AppError";
    this.code = code;
    this.details = details;
  }
}

const requiredEnv = {
  DATAFORSEO_API_KEY: { code: "DATAFORSEO_AUTH_FAILED", message: "DATAFORSEO_API_KEY is required (base64 of DataForSEO login:password)" },
  AHREFS_API_KEY: {
    code: "AHREFS_AUTH_FAILED",
    message: "AHREFS_API_KEY is required: Ahrefs' free Domain Rating endpoint needs a free APIv3 key (free Ahrefs account, then Account settings > API keys)",
  },
} as const satisfies Record<string, { code: ErrorCode; message: string }>;

export async function getRequiredEnvValue(name: keyof typeof requiredEnv): Promise<string> {
  const value = process.env[name];
  if (!value) throw new AppError(requiredEnv[name].code, requiredEnv[name].message);
  return value;
}
