import { randomBytes, timingSafeEqual } from "node:crypto";

import { parseRepositoryUrl } from "../repository-url.ts";
import { authorizeUrl, manageAccessUrl, repositoryUrl, type GitHubAppConfig } from "./app.ts";
import {
  countUserInstallations,
  exchangeCode,
  fetchUserLogin,
  refreshAccessToken,
  revokeAccessToken,
  type OAuthDeps,
  type TokenGrant,
} from "./oauth.ts";
import { seal, unseal } from "./session.ts";

export const SESSION_COOKIE = "codefield_github";
export const STATE_COOKIE = "codefield_github_state";

// A connection lasts at most this long, however long GitHub's own tokens
// would. Reconnecting is one click once the app is authorized.
export const SESSION_MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000;
export const STATE_MAX_AGE_MS = 10 * 60 * 1000;
// Tokens this close to expiring are refreshed before use.
const EXPIRY_MARGIN_MS = 60 * 1000;

export type CookieOptions = {
  httpOnly: true;
  secure: boolean;
  sameSite: "lax";
  path: "/";
  // Seconds.
  maxAge: number;
};

// The subset of a cookie store the connection needs. Deleting is a set with
// maxAge 0 and the same path, so it matches the cookie that was written.
export type CookieJar = {
  get(name: string): string | undefined;
  set(name: string, value: string, options: CookieOptions): void;
};

export type ConnectionDeps = OAuthDeps;

type Session = TokenGrant & {
  login: string;
  // Epoch milliseconds after which the connection is over, even if GitHub's
  // tokens are still valid.
  expiresAt: number;
};

type PendingAuthorization = {
  state: string;
  // A repository URL to put back in the form after returning from GitHub.
  repository: string | null;
  expiresAt: number;
};

export type ConnectionStatus = { connected: false } | { connected: true; login: string };

// "not_connected": no usable session. "expired": the session or its refresh
// token ran out. "revoked": GitHub rejected a token that had not expired.
// "unavailable": GitHub could not be reached to refresh the token.
export type UserToken =
  | { ok: true; token: string }
  | { ok: false; reason: "not_connected" | "expired" | "revoked" | "unavailable" };

export type GitHubConnection = {
  // The current user access token, refreshed first if it is about to expire.
  accessToken(): Promise<UserToken>;
  // For after GitHub rejected the token accessToken() returned: tries one
  // refresh, and ends the connection if that fails.
  renew(): Promise<UserToken>;
  disconnect(): Promise<void>;
};

function cookieOptions(config: GitHubAppConfig, maxAgeMs: number): CookieOptions {
  return {
    httpOnly: true,
    secure: config.secureCookies,
    sameSite: "lax",
    path: "/",
    maxAge: Math.max(0, Math.floor(maxAgeMs / 1000)),
  };
}

function clearCookie(jar: CookieJar, config: GitHubAppConfig, name: string) {
  jar.set(name, "", cookieOptions(config, 0));
}

function readSession(jar: CookieJar, config: GitHubAppConfig): Session | null {
  const raw = jar.get(SESSION_COOKIE);
  if (!raw) return null;
  const value = unseal(config.sessionKey, SESSION_COOKIE, raw);
  return isSession(value) ? value : null;
}

function writeSession(jar: CookieJar, config: GitHubAppConfig, session: Session, now: number) {
  jar.set(SESSION_COOKIE, seal(config.sessionKey, SESSION_COOKIE, session), cookieOptions(config, session.expiresAt - now));
}

// Reads the session without refreshing or writing anything, for rendering.
export function connectionStatus(jar: CookieJar, config: GitHubAppConfig, now = Date.now()): ConnectionStatus {
  const session = readSession(jar, config);
  if (session === null || now >= session.expiresAt) return { connected: false };
  if (session.refreshToken === null && session.accessTokenExpiresAt !== null && now >= session.accessTokenExpiresAt) {
    return { connected: false };
  }
  return { connected: true, login: session.login };
}

export function openConnection(jar: CookieJar, config: GitHubAppConfig, deps: ConnectionDeps = {}): GitHubConnection {
  const now = deps.now ?? Date.now;

  function end(reason: "not_connected" | "expired" | "revoked"): UserToken {
    clearCookie(jar, config, SESSION_COOKIE);
    return { ok: false, reason };
  }

  function current(): Session | "invalid" | null {
    const raw = jar.get(SESSION_COOKIE);
    if (!raw) return null;
    return readSession(jar, config) ?? "invalid";
  }

  async function refresh(session: Session, failure: "expired" | "revoked"): Promise<UserToken> {
    const time = now();
    if (session.refreshToken === null) return end(failure);
    if (session.refreshTokenExpiresAt !== null && time >= session.refreshTokenExpiresAt) return end("expired");

    const result = await refreshAccessToken(config, session.refreshToken, deps);
    if (!result.ok) {
      // A network failure says nothing about the tokens, so the session stays.
      if (result.reason === "unavailable") return { ok: false, reason: "unavailable" };
      return end(failure);
    }
    const next: Session = { ...result.grant, login: session.login, expiresAt: session.expiresAt };
    writeSession(jar, config, next, now());
    return { ok: true, token: next.accessToken };
  }

  return {
    async accessToken() {
      const session = current();
      if (session === null) return { ok: false, reason: "not_connected" };
      if (session === "invalid") return end("not_connected");
      const time = now();
      if (time >= session.expiresAt) return end("expired");
      if (session.accessTokenExpiresAt !== null && time >= session.accessTokenExpiresAt - EXPIRY_MARGIN_MS) {
        return refresh(session, "expired");
      }
      return { ok: true, token: session.accessToken };
    },

    async renew() {
      const session = current();
      if (session === null) return { ok: false, reason: "not_connected" };
      if (session === "invalid") return end("not_connected");
      if (now() >= session.expiresAt) return end("expired");
      return refresh(session, "revoked");
    },

    async disconnect() {
      const session = current();
      clearCookie(jar, config, SESSION_COOKIE);
      if (session !== null && session !== "invalid") await revokeAccessToken(config, session.accessToken, deps);
    },
  };
}

// Starts GitHub's web flow: remembers a random state in a sealed cookie and
// returns the GitHub URL to send the browser to.
export function startAuthorization(
  jar: CookieJar,
  config: GitHubAppConfig,
  repositoryInput: string | null,
  now = Date.now(),
): string {
  const state = randomBytes(32).toString("base64url");
  const parsed = repositoryInput === null ? null : parseRepositoryUrl(repositoryInput);
  const pending: PendingAuthorization = {
    state,
    repository: parsed?.ok ? repositoryUrl(parsed.repository) : null,
    expiresAt: now + STATE_MAX_AGE_MS,
  };
  jar.set(STATE_COOKIE, seal(config.sessionKey, STATE_COOKIE, pending), cookieOptions(config, STATE_MAX_AGE_MS));
  return authorizeUrl(config, state);
}

// Handles GitHub's redirect back to the callback URL and returns where to send
// the browser next: back to Codefield with a `github` status parameter, or on
// to GitHub to install the app when the user has no installation yet. Only
// `code`, `state` and `error` are read; an `installation_id` in the query is
// ignored, since the browser can put any value there.
export async function completeAuthorization(
  jar: CookieJar,
  config: GitHubAppConfig,
  query: URLSearchParams,
  deps: ConnectionDeps = {},
): Promise<string> {
  const now = deps.now ?? Date.now;
  const raw = jar.get(STATE_COOKIE);
  clearCookie(jar, config, STATE_COOKIE);

  const error = query.get("error");
  if (error !== null) return error === "access_denied" ? "/?github=denied" : "/?github=error";

  const pending = raw ? unseal(config.sessionKey, STATE_COOKIE, raw) : null;
  const state = query.get("state");
  const code = query.get("code");
  if (!isPending(pending) || now() >= pending.expiresAt || !state || !code || !sameString(state, pending.state)) {
    return "/?github=error";
  }

  const exchanged = await exchangeCode(config, code, deps);
  if (!exchanged.ok) return "/?github=error";
  const { grant } = exchanged;

  const login = await fetchUserLogin(grant.accessToken, deps);
  if (login === null) return "/?github=error";

  const time = now();
  writeSession(jar, config, { ...grant, login, expiresAt: time + SESSION_MAX_AGE_MS }, time);

  // Authorization and installation are separate steps on GitHub. Without an
  // installation the connection can read nothing private, so go straight on
  // to choosing repositories.
  if ((await countUserInstallations(grant.accessToken, deps)) === 0) return manageAccessUrl(config);

  const params = new URLSearchParams({ github: "connected" });
  if (pending.repository !== null) params.set("repository", pending.repository);
  return `/?${params}`;
}

function sameString(a: string, b: string): boolean {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  return left.length === right.length && timingSafeEqual(left, right);
}

function isPending(value: unknown): value is PendingAuthorization {
  return (
    isRecord(value) &&
    typeof value.state === "string" &&
    (value.repository === null || typeof value.repository === "string") &&
    typeof value.expiresAt === "number"
  );
}

function isSession(value: unknown): value is Session {
  return (
    isRecord(value) &&
    typeof value.login === "string" &&
    typeof value.accessToken === "string" &&
    value.accessToken !== "" &&
    isTimeOrNull(value.accessTokenExpiresAt) &&
    (value.refreshToken === null || typeof value.refreshToken === "string") &&
    isTimeOrNull(value.refreshTokenExpiresAt) &&
    typeof value.expiresAt === "number"
  );
}

function isTimeOrNull(value: unknown): boolean {
  return value === null || typeof value === "number";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
