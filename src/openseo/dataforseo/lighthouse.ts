// Ported from OpenSEO src/server/lib/dataforseo/lighthouse.ts at commit
// 0ffff93101043aad7600a3b6a499a0cd2887ef49.
// Copyright (c) 2026 Ben Senescu. MIT License; see LICENSES/OpenSEO.txt.
// Local change: the response is read with dataforseoPost. Upstream reads the
// multi-MB body behind a parse lock with its own timeout to fit Worker memory;
// a local process has no such limit.
import { dataforseoPost } from "./core.js";
import {
  assertOk,
  buildTaskBilling,
  DataforseoChargedTaskError,
  type DataforseoApiResponse,
} from "./envelope.js";
import {
  parseDataforseoLighthousePayload,
  requestCategories,
  type LighthouseStrategy,
} from "../dataforseoLighthousePayload.js";
import type { StoredLighthousePayload } from "../lighthouseStoredPayload.js";

const LIGHTHOUSE_PATH = "/v3/on_page/lighthouse/live/json";

export async function fetchLighthouseResult(input: {
  url: string;
  strategy: LighthouseStrategy;
}): Promise<DataforseoApiResponse<StoredLighthousePayload>> {
  // Billed, non-idempotent POST: a 5xx does not prove the provider skipped
  // the charge, so never replay it.
  const body = await dataforseoPost(
    LIGHTHOUSE_PATH,
    [
      {
        url: input.url,
        for_mobile: input.strategy === "mobile",
        categories: [...requestCategories],
      },
    ],
    { maxServerErrorRetries: 0 },
  );
  // Build the metering envelope before parsing. The provider has already
  // charged a successful task, so a malformed payload must carry its
  // billing metadata out to the metered client instead of looking
  // retryable.
  const task = assertOk(body);
  const billing = buildTaskBilling(task);
  try {
    const data = parseDataforseoLighthousePayload(body, input);
    return { data, billing };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new DataforseoChargedTaskError(message, billing);
  }
}
