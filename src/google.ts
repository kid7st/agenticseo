// Google authorization for Search Console and Analytics on the user's machine.
// OpenSEO links a Google grant to a web session with a hosted OAuth client; here
// the user's own Desktop OAuth client runs Google's loopback flow (PKCE and a
// one-time 127.0.0.1 redirect). Grants are stored per Google account in the
// user's config directory, never in a project. The scopes match OpenSEO's
// src/shared/gsc.ts and src/shared/ga4.ts.
import { createHash, randomBytes, randomUUID } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { homedir } from "node:os";
import { join } from "node:path";
import { z } from "zod";
import { OperationError } from "./errors.js";

const GOOGLE_AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth";
const GOOGLE_TOKEN_URL = "https://oauth2.googleapis.com/token";
const GOOGLE_REVOKE_URL = "https://oauth2.googleapis.com/revoke";
const AUTHORIZATION_TIMEOUT_MS = 5 * 60_000;

export const GOOGLE_PRODUCT_SCOPES = {
  searchConsole: "https://www.googleapis.com/auth/webmasters.readonly",
  analytics: "https://www.googleapis.com/auth/analytics.readonly",
} as const;
export type GoogleProduct = keyof typeof GOOGLE_PRODUCT_SCOPES;
const PRODUCT_NAMES: Record<GoogleProduct, string> = { searchConsole: "Search Console", analytics: "Google Analytics" };

const storedAccountSchema = z.object({
  accountId: z.string(),
  email: z.string().nullable(),
  scopes: z.array(z.string()),
  clientId: z.string(),
  clientSecret: z.string(),
  refreshToken: z.string(),
  accessToken: z.string().optional(),
  accessTokenExpiresAt: z.number().optional(),
  connectedAt: z.string(),
});
type StoredAccount = z.infer<typeof storedAccountSchema>;
const storeSchema = z.object({ accounts: z.array(storedAccountSchema) });

const tokenResponseSchema = z.object({
  access_token: z.string().min(1),
  expires_in: z.number().optional(),
  refresh_token: z.string().optional(),
  scope: z.string().optional(),
  id_token: z.string().optional(),
});

/** $XDG_CONFIG_HOME/agenticseo, ~/.config/agenticseo, or %APPDATA%\agenticseo on Windows. */
export function configDirectory() {
  const base = process.env.XDG_CONFIG_HOME || (process.platform === "win32" && process.env.APPDATA) || join(homedir(), ".config");
  return join(base, "agenticseo");
}

const storeFile = () => join(configDirectory(), "google-accounts.json");

async function readStore(): Promise<StoredAccount[]> {
  let text: string;
  try {
    text = await readFile(storeFile(), "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw error;
  }
  const parsed = storeSchema.safeParse(JSON.parse(text));
  if (!parsed.success) throw new OperationError("input", `${storeFile()} is not a valid AgenticSEO Google account file: ${z.prettifyError(parsed.error)}`);
  return parsed.data.accounts;
}

/** Owner-only file in an owner-only directory: it holds refresh tokens. */
async function writeStore(accounts: StoredAccount[]) {
  await mkdir(configDirectory(), { recursive: true, mode: 0o700 });
  const temporary = `${storeFile()}.${randomUUID()}.tmp`;
  await writeFile(temporary, `${JSON.stringify({ accounts }, null, 2)}\n`, { mode: 0o600 });
  await rename(temporary, storeFile());
}

const base64Url = (bytes: Buffer) => bytes.toString("base64url");

function decodeIdToken(idToken: string) {
  const payload = idToken.split(".")[1];
  const claims = z.object({ sub: z.string().min(1), email: z.string().optional() }).safeParse(JSON.parse(Buffer.from(payload ?? "", "base64url").toString("utf8")));
  if (!claims.success) throw new OperationError("provider", "Google returned an ID token without an account id");
  return claims.data;
}

function oauthClient() {
  const clientId = process.env.GOOGLE_CLIENT_ID?.trim();
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET?.trim();
  if (!clientId || !clientSecret) {
    throw new OperationError(
      "credentials",
      "GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET are required: create a Desktop OAuth client in Google Cloud (see README, Google Search Console and Analytics)",
    );
  }
  // Google answers a wrong client id only on its consent page ("Error 401: invalid_client");
  // catch the usual slips (a placeholder, the secret, quotes) before opening it.
  if (!/^[\w-]+\.apps\.googleusercontent\.com$/.test(clientId)) {
    throw new OperationError(
      "credentials",
      `GOOGLE_CLIENT_ID "${clientId.slice(0, 12)}…" is not an OAuth client id: copy the Client ID of the Desktop client (it ends with .apps.googleusercontent.com), not the secret or project number`,
    );
  }
  return { clientId, clientSecret };
}

/**
 * Ask Google whether it knows this client before sending the user to its consent
 * page, which is the only other place a wrong client shows up. Exchanging a bogus
 * code reaches the client check first: an unknown client or wrong secret answers
 * invalid_client, a valid pair answers invalid_grant for the code.
 */
async function assertClientKnown(clientId: string, clientSecret: string) {
  const response = await fetch(GOOGLE_TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ client_id: clientId, client_secret: clientSecret, grant_type: "authorization_code", code: "agenticseo-client-check", redirect_uri: "http://127.0.0.1" }),
  });
  const body = z.object({ error: z.string().optional(), error_description: z.string().optional() }).catch({}).parse(await response.json().catch(() => ({})));
  if (body.error !== "invalid_client") return;
  const reason = body.error_description ?? "invalid client";
  throw new OperationError(
    "credentials",
    /not found/i.test(reason)
      ? `Google does not know the OAuth client ${clientId} (${reason}). A new client can take minutes to hours to take effect; otherwise copy the Client ID again from the Desktop client in the same Google Cloud project`
      : `Google rejected the OAuth client secret (${reason}); copy the Client secret of the same Desktop client`,
  );
}

/** Wait for Google to redirect the browser back to the loopback address with a code. */
function awaitRedirect(state: string, onListening: (redirectUri: string) => Promise<void>) {
  return new Promise<{ code: string; redirectUri: string }>((resolve, reject) => {
    let redirectUri = "";
    const server = createServer((req, res) => {
      const url = new URL(req.url ?? "/", redirectUri);
      if (url.pathname !== "/") {
        res.writeHead(404).end();
        return;
      }
      const finish = (status: number, message: string, outcome: () => void) => {
        res.writeHead(status, { "Content-Type": "text/plain; charset=utf-8" }).end(message);
        clearTimeout(timer);
        server.close();
        outcome();
      };
      if (url.searchParams.get("state") !== state) {
        finish(400, "AgenticSEO: this authorization does not match the one started; run agenticseo google connect again.", () =>
          reject(new OperationError("input", "Google redirected with an unexpected state; run agenticseo google connect again")),
        );
        return;
      }
      const error = url.searchParams.get("error");
      const code = url.searchParams.get("code");
      if (error || !code) {
        finish(400, `AgenticSEO: Google authorization failed (${error ?? "no code"}). You can close this tab.`, () =>
          reject(new OperationError("credentials", `Google authorization was not granted (${error ?? "no code returned"})`)),
        );
        return;
      }
      finish(200, "AgenticSEO is connected to your Google account. You can close this tab.", () => resolve({ code, redirectUri }));
    });
    const timer = setTimeout(() => {
      server.close();
      reject(new OperationError("input", "No Google authorization arrived within 5 minutes; run agenticseo google connect again"));
    }, AUTHORIZATION_TIMEOUT_MS);
    server.on("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      if (!address || typeof address === "string") return reject(new Error("The loopback server has no port"));
      redirectUri = `http://127.0.0.1:${address.port}`;
      onListening(redirectUri).catch((error: unknown) => {
        clearTimeout(timer);
        server.close();
        reject(error);
      });
    });
  });
}

/**
 * Google's installed-app flow: send the user to Google's consent page, receive the
 * code on a one-time loopback address, and store the account's refresh token.
 * `openUrl` shows the consent page (a browser, or a test that follows the redirect).
 */
export async function connectGoogle(input: { products: GoogleProduct[]; openUrl: (url: string) => Promise<void> }) {
  const { clientId, clientSecret } = oauthClient();
  await assertClientKnown(clientId, clientSecret);
  const verifier = base64Url(randomBytes(32));
  const state = base64Url(randomBytes(16));
  const requested = ["openid", "email", ...input.products.map((product) => GOOGLE_PRODUCT_SCOPES[product])];

  const { code, redirectUri } = await awaitRedirect(state, async (redirectUri) => {
    const url = new URL(GOOGLE_AUTH_URL);
    url.searchParams.set("client_id", clientId);
    url.searchParams.set("redirect_uri", redirectUri);
    url.searchParams.set("response_type", "code");
    url.searchParams.set("scope", requested.join(" "));
    url.searchParams.set("access_type", "offline");
    // consent: Google only returns a refresh token when the user is asked again.
    url.searchParams.set("prompt", "select_account consent");
    url.searchParams.set("state", state);
    url.searchParams.set("code_challenge", base64Url(createHash("sha256").update(verifier).digest()));
    url.searchParams.set("code_challenge_method", "S256");
    await input.openUrl(url.toString());
  });

  const response = await fetch(GOOGLE_TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ code, client_id: clientId, client_secret: clientSecret, redirect_uri: redirectUri, grant_type: "authorization_code", code_verifier: verifier }),
  });
  if (!response.ok) throw new OperationError("credentials", `Google rejected the authorization code (HTTP ${response.status}): ${(await response.text()).slice(0, 300)}`);
  const tokens = tokenResponseSchema.parse(await response.json());
  if (!tokens.refresh_token) throw new OperationError("provider", "Google returned no refresh token; remove AgenticSEO's access at myaccount.google.com/permissions and connect again");
  if (!tokens.id_token) throw new OperationError("provider", "Google returned no ID token");
  const { sub, email } = decodeIdToken(tokens.id_token);
  const scopes = tokens.scope?.split(/\s+/).filter(Boolean) ?? requested;
  // The consent page lets the user untick a product; say so instead of failing later.
  const missing = input.products.filter((product) => !scopes.includes(GOOGLE_PRODUCT_SCOPES[product]));

  const account: StoredAccount = {
    accountId: sub,
    email: email ?? null,
    scopes,
    clientId,
    clientSecret,
    refreshToken: tokens.refresh_token,
    accessToken: tokens.access_token,
    accessTokenExpiresAt: Date.now() + (tokens.expires_in ?? 3600) * 1000,
    connectedAt: new Date().toISOString(),
  };
  const accounts = (await readStore()).filter((existing) => existing.accountId !== sub);
  await writeStore([...accounts, account]);
  return {
    accountId: sub,
    email: account.email,
    products: (Object.keys(GOOGLE_PRODUCT_SCOPES) as GoogleProduct[]).filter((product) => scopes.includes(GOOGLE_PRODUCT_SCOPES[product])),
    ...(missing.length > 0 && { notGranted: missing.map((product) => PRODUCT_NAMES[product]) }),
    credentialsFile: storeFile(),
  };
}

/** Connected accounts and what each may read; tokens are never printed. */
export async function listGoogleAccounts() {
  return (await readStore()).map((account) => ({
    accountId: account.accountId,
    email: account.email,
    products: (Object.keys(GOOGLE_PRODUCT_SCOPES) as GoogleProduct[]).filter((product) => account.scopes.includes(GOOGLE_PRODUCT_SCOPES[product])),
    connectedAt: account.connectedAt,
  }));
}

async function findAccount(reference: string) {
  const accounts = await readStore();
  const account = accounts.find((candidate) => candidate.accountId === reference || candidate.email?.toLowerCase() === reference.toLowerCase());
  return { accounts, account };
}

/** The account to use: the one named, or the only one granted for the product. */
export async function resolveGoogleAccount(product: GoogleProduct, reference?: string) {
  const accounts = (await readStore()).filter((account) => account.scopes.includes(GOOGLE_PRODUCT_SCOPES[product]));
  const matches = reference
    ? accounts.filter((candidate) => candidate.accountId === reference || candidate.email?.toLowerCase() === reference.toLowerCase())
    : accounts;
  if (matches.length === 0) {
    throw new OperationError("credentials", `No Google account${reference ? ` ${reference}` : ""} is connected for ${PRODUCT_NAMES[product]}; run agenticseo google connect`);
  }
  if (matches.length > 1) {
    throw new OperationError("input", `Several Google accounts can read ${PRODUCT_NAMES[product]} (${matches.map((account) => account.email ?? account.accountId).join(", ")}); pass --account`);
  }
  return { accountId: matches[0].accountId, email: matches[0].email };
}

/** A current access token for the account, refreshed and stored when it is about to expire. */
export async function googleAccessToken(accountId: string, product: GoogleProduct) {
  const { accounts, account } = await findAccount(accountId);
  const reconnect = `run agenticseo google connect${product === "analytics" ? " --for analytics" : ""}`;
  if (!account) throw new OperationError("credentials", `The Google account for ${PRODUCT_NAMES[product]} is no longer connected; ${reconnect}`);
  if (!account.scopes.includes(GOOGLE_PRODUCT_SCOPES[product])) {
    throw new OperationError("credentials", `${account.email ?? account.accountId} has not granted ${PRODUCT_NAMES[product]} access; ${reconnect}`);
  }
  if (account.accessToken && (account.accessTokenExpiresAt ?? 0) > Date.now() + 60_000) return account.accessToken;

  const response = await fetch(GOOGLE_TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ client_id: account.clientId, client_secret: account.clientSecret, refresh_token: account.refreshToken, grant_type: "refresh_token" }),
  });
  if (!response.ok) {
    const body = await response.text();
    // invalid_grant: the user revoked access, or a Testing-mode app's grant expired after 7 days.
    if (response.status === 400 || response.status === 401) {
      throw new OperationError("credentials", `Google access for ${account.email ?? account.accountId} was revoked or has expired (${body.slice(0, 200)}); ${reconnect}`);
    }
    throw new OperationError("provider", `Google token refresh failed (HTTP ${response.status}): ${body.slice(0, 200)}`);
  }
  const tokens = tokenResponseSchema.parse(await response.json());
  const refreshed: StoredAccount = {
    ...account,
    accessToken: tokens.access_token,
    accessTokenExpiresAt: Date.now() + (tokens.expires_in ?? 3600) * 1000,
    // Google may rotate the refresh token; keep the old one when it does not.
    refreshToken: tokens.refresh_token ?? account.refreshToken,
  };
  await writeStore(accounts.map((candidate) => (candidate.accountId === account.accountId ? refreshed : candidate)));
  return refreshed.accessToken!;
}

/** Revoke the grant at Google and forget it; a grant Google already dropped is still removed here. */
export async function disconnectGoogle(reference: string) {
  const { accounts, account } = await findAccount(reference);
  if (!account) throw new OperationError("input", `No connected Google account ${reference}; see agenticseo google accounts`);
  const response = await fetch(`${GOOGLE_REVOKE_URL}?${new URLSearchParams({ token: account.refreshToken })}`, { method: "POST" });
  await writeStore(accounts.filter((candidate) => candidate.accountId !== account.accountId));
  return {
    accountId: account.accountId,
    email: account.email,
    removed: true,
    revokedAtGoogle: response.ok,
    ...(!response.ok && { revokeResponse: `HTTP ${response.status}: ${(await response.text()).slice(0, 200)}` }),
  };
}
