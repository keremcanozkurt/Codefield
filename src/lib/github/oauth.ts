import { requestGitHub, type FetchLike } from "./client.ts";
import type { GitHubAppConfig } from "./app.ts";

const TOKEN_URL = "https://github.com/login/oauth/access_token";
const REQUEST_TIMEOUT_MS = 15_000;

export type TokenGrant = {
  accessToken: string;
  // Epoch milliseconds. null when the app issues tokens that do not expire,
  // which also means GitHub sends no refresh token.
  accessTokenExpiresAt: number | null;
  refreshToken: string | null;
  refreshTokenExpiresAt: number | null;
};

// "rejected": GitHub refused the code or refresh token. "unavailable": GitHub
// could not be reached or answered with a server error; worth retrying.
export type TokenResult = { ok: true; grant: TokenGrant } | { ok: false; reason: "rejected" | "unavailable" };

export type OAuthDeps = { fetch?: FetchLike; now?: () => number };

export function exchangeCode(config: GitHubAppConfig, code: string, deps: OAuthDeps = {}): Promise<TokenResult> {
  return requestToken(config, { code }, deps);
}

export function refreshAccessToken(
  config: GitHubAppConfig,
  refreshToken: string,
  deps: OAuthDeps = {},
): Promise<TokenResult> {
  return requestToken(config, { grant_type: "refresh_token", refresh_token: refreshToken }, deps);
}

async function requestToken(
  config: GitHubAppConfig,
  params: Record<string, string>,
  { fetch: fetchImpl = fetch, now = Date.now }: OAuthDeps,
): Promise<TokenResult> {
  let response: Response;
  try {
    response = await fetchImpl(TOKEN_URL, {
      method: "POST",
      headers: { Accept: "application/json", "Content-Type": "application/json", "User-Agent": "Codefield" },
      body: JSON.stringify({ client_id: config.clientId, client_secret: config.clientSecret, ...params }),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
  } catch {
    return { ok: false, reason: "unavailable" };
  }
  if (response.status >= 500) return { ok: false, reason: "unavailable" };
  if (!response.ok) return { ok: false, reason: "rejected" };

  let body: unknown;
  try {
    body = await response.json();
  } catch {
    return { ok: false, reason: "unavailable" };
  }
  // GitHub reports a bad code or refresh token with status 200 and an
  // `error` field, so the body decides, not the status.
  if (!isRecord(body) || typeof body.access_token !== "string" || body.access_token === "") {
    return { ok: false, reason: "rejected" };
  }

  const issuedAt = now();
  const expiresAt = (seconds: unknown) =>
    typeof seconds === "number" && seconds > 0 ? issuedAt + seconds * 1000 : null;
  const refreshToken = typeof body.refresh_token === "string" && body.refresh_token !== "" ? body.refresh_token : null;

  return {
    ok: true,
    grant: {
      accessToken: body.access_token,
      accessTokenExpiresAt: expiresAt(body.expires_in),
      refreshToken,
      refreshTokenExpiresAt: refreshToken === null ? null : expiresAt(body.refresh_token_expires_in),
    },
  };
}

// Revokes one user access token. Best effort: the local session is cleared
// whether or not GitHub confirms.
export async function revokeAccessToken(
  config: GitHubAppConfig,
  accessToken: string,
  { fetch: fetchImpl = fetch }: OAuthDeps = {},
): Promise<void> {
  const credentials = Buffer.from(`${config.clientId}:${config.clientSecret}`).toString("base64");
  try {
    await fetchImpl(`https://api.github.com/applications/${encodeURIComponent(config.clientId)}/token`, {
      method: "DELETE",
      headers: {
        Accept: "application/vnd.github+json",
        Authorization: `Basic ${credentials}`,
        "Content-Type": "application/json",
        "User-Agent": "Codefield",
        "X-GitHub-Api-Version": "2022-11-28",
      },
      body: JSON.stringify({ access_token: accessToken }),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
  } catch {
    // Ignored; see above.
  }
}

export async function fetchUserLogin(token: string, deps: OAuthDeps = {}): Promise<string | null> {
  const response = await requestGitHub("/user", { token, fetch: deps.fetch });
  if (!response.ok || !isRecord(response.data)) return null;
  const login = response.data.login;
  return typeof login === "string" && login !== "" ? login : null;
}

// Installations of this app the user can see. Used only to tell "not
// installed anywhere" apart from "installed, but not for this repository";
// Codefield never acts on an installation directly.
export async function countUserInstallations(token: string, deps: OAuthDeps = {}): Promise<number | null> {
  const response = await requestGitHub("/user/installations?per_page=1", { token, fetch: deps.fetch });
  if (!response.ok || !isRecord(response.data)) return null;
  const count = response.data.total_count;
  return typeof count === "number" && Number.isInteger(count) && count >= 0 ? count : null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
