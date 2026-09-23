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
  | "INTERNAL_ERROR";

// INTERNAL_ERROR from provider code means DataForSEO returned something we
// cannot use (empty body, missing task or billing, bad shape): a provider failure
// from the CLI's point of view, not a local bug.
const kinds: Record<ErrorCode, OperationError["kind"]> = {
  VALIDATION_ERROR: "input",
  DATAFORSEO_AUTH_FAILED: "credentials",
  RATE_LIMITED: "provider",
  UPSTREAM_UNAVAILABLE: "provider",
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
  DATAFORSEO_API_KEY: "DATAFORSEO_API_KEY is required (base64 of DataForSEO login:password)",
} as const;

export async function getRequiredEnvValue(name: keyof typeof requiredEnv): Promise<string> {
  const value = process.env[name];
  if (!value) throw new AppError("DATAFORSEO_AUTH_FAILED", requiredEnv[name]);
  return value;
}
