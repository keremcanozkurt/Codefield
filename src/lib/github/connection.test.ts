import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { readGitHubAppConfig, type GitHubAppConfig } from "./app.ts";
import {
  completeAuthorization,
  connectionStatus,
  openConnection,
  SESSION_COOKIE,
  SESSION_MAX_AGE_MS,
  startAuthorization,
  STATE_COOKIE,
  STATE_MAX_AGE_MS,
  type CookieJar,
  type CookieOptions,
} from "./connection.ts";
import { seal, unseal } from "./session.ts";

const config: GitHubAppConfig = readGitHubAppConfig({
  GITHUB_APP_CLIENT_ID: "Iv23client",
  GITHUB_APP_CLIENT_SECRET: "client-secret-value",
  GITHUB_APP_SLUG: "codefield-local",
  GITHUB_SESSION_SECRET: "s".repeat(40),
  NODE_ENV: "production",
})!;

const NOW = 1_800_000_000_000;
const HOUR = 60 * 60 * 1000;

class MemoryJar implements CookieJar {
  values = new Map<string, string>();
  writes: { name: string; value: string; options: CookieOptions }[] = [];
  get(name: string) {
    return this.values.get(name);
  }
  set(name: string, value: string, options: CookieOptions) {
    this.writes.push({ name, value, options });
    if (options.maxAge === 0) this.values.delete(name);
    else this.values.set(name, value);
  }
}

type Call = { method: string; url: string; headers: Record<string, string>; body: string };
type Handler = (call: Call) => Response;

function fakeGitHub(handlers: Record<string, Handler>) {
  const calls: Call[] = [];
  const fetch = async (url: string, init: RequestInit) => {
    const call: Call = {
      method: init.method ?? "GET",
      url,
      headers: (init.headers ?? {}) as Record<string, string>,
      body: typeof init.body === "string" ? init.body : "",
    };
    calls.push(call);
    const handler = handlers[`${call.method} ${url}`];
    if (handler === undefined) throw new Error(`unexpected request: ${call.method} ${url}`);
    return handler(call);
  };
  return { fetch, calls };
}

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

const TOKEN_URL = "POST https://github.com/login/oauth/access_token";
const USER_URL = "GET https://api.github.com/user";
const INSTALLATIONS_URL = "GET https://api.github.com/user/installations?per_page=1";
const REVOKE_URL = "DELETE https://api.github.com/applications/Iv23client/token";

const grantBody = {
  access_token: "ghu_access_one",
  expires_in: 8 * 60 * 60,
  refresh_token: "ghr_refresh_one",
  refresh_token_expires_in: 180 * 24 * 60 * 60,
  token_type: "bearer",
  scope: "",
};

function signedInHandlers(installations = 1): Record<string, Handler> {
  return {
    [TOKEN_URL]: () => json(grantBody),
    [USER_URL]: () => json({ login: "octo", id: 1 }),
    [INSTALLATIONS_URL]: () => json({ total_count: installations, installations: [] }),
  };
}

function startedJar(repository: string | null = null) {
  const jar = new MemoryJar();
  const location = new URL(startAuthorization(jar, config, repository, NOW));
  return { jar, state: location.searchParams.get("state")!, location };
}

function sessionJar(overrides: Record<string, unknown> = {}) {
  const jar = new MemoryJar();
  jar.values.set(
    SESSION_COOKIE,
    seal(config.sessionKey, SESSION_COOKIE, {
      login: "octo",
      accessToken: "ghu_access_one",
      accessTokenExpiresAt: NOW + 8 * HOUR,
      refreshToken: "ghr_refresh_one",
      refreshTokenExpiresAt: NOW + 180 * 24 * HOUR,
      expiresAt: NOW + SESSION_MAX_AGE_MS,
      ...overrides,
    }),
  );
  return jar;
}

describe("startAuthorization", () => {
  it("redirects to GitHub with a random state kept in a sealed, HttpOnly cookie", () => {
    const { jar, state, location } = startedJar();
    const second = startedJar();

    assert.equal(location.origin + location.pathname, "https://github.com/login/oauth/authorize");
    assert.equal(location.searchParams.get("client_id"), "Iv23client");
    assert.ok(state.length >= 43);
    assert.notEqual(state, second.state);

    const [write] = jar.writes;
    assert.equal(write.name, STATE_COOKIE);
    assert.ok(!write.value.includes(state));
    assert.deepEqual(write.options, {
      httpOnly: true,
      secure: true,
      sameSite: "lax",
      path: "/",
      maxAge: STATE_MAX_AGE_MS / 1000,
    });
  });

  it("keeps only a valid repository URL to return to", () => {
    const valid = startedJar("github.com/octo/private-demo");
    const invalid = startedJar("javascript:alert(1)");

    const read = (jar: MemoryJar) => unseal(config.sessionKey, STATE_COOKIE, jar.values.get(STATE_COOKIE)!) as { repository: string | null };
    assert.equal(read(valid.jar).repository, "https://github.com/octo/private-demo");
    assert.equal(read(invalid.jar).repository, null);
  });
});

describe("completeAuthorization", () => {
  it("stores the tokens only inside the sealed session cookie", async () => {
    const { jar, state } = startedJar("https://github.com/octo/private-demo");
    const github = fakeGitHub(signedInHandlers());

    const location = await completeAuthorization(jar, config, new URLSearchParams({ code: "code-1", state }), {
      fetch: github.fetch,
      now: () => NOW,
    });

    assert.equal(location, "/?github=connected&repository=https%3A%2F%2Fgithub.com%2Focto%2Fprivate-demo");
    assert.equal(jar.values.has(STATE_COOKIE), false);
    const session = jar.writes.find((write) => write.name === SESSION_COOKIE)!;
    assert.ok(!session.value.includes("ghu_") && !session.value.includes("ghr_"));
    assert.equal(session.options.httpOnly, true);
    assert.equal(session.options.maxAge, SESSION_MAX_AGE_MS / 1000);
    assert.ok(!location.includes("ghu_") && !location.includes("code-1"));

    const exchange = github.calls[0];
    assert.deepEqual(JSON.parse(exchange.body), { client_id: "Iv23client", client_secret: "client-secret-value", code: "code-1" });
    assert.equal(github.calls[1].headers.Authorization, "Bearer ghu_access_one");
    assert.deepEqual(connectionStatus(jar, config, NOW), { connected: true, login: "octo" });
  });

  it("rejects a missing or different state without exchanging the code", async () => {
    const github = fakeGitHub(signedInHandlers());
    const deps = { fetch: github.fetch, now: () => NOW };

    const noCookie = await completeAuthorization(new MemoryJar(), config, new URLSearchParams({ code: "c", state: "s" }), deps);
    const { jar, state } = startedJar();
    const wrong = await completeAuthorization(jar, config, new URLSearchParams({ code: "c", state: `${state}x` }), deps);
    const again = startedJar();
    const missing = await completeAuthorization(again.jar, config, new URLSearchParams({ code: "c" }), deps);

    assert.deepEqual([noCookie, wrong, missing], ["/?github=error", "/?github=error", "/?github=error"]);
    assert.equal(github.calls.length, 0);
    assert.equal(jar.values.has(SESSION_COOKIE), false);
  });

  it("does not accept a state twice", async () => {
    const { jar, state } = startedJar();
    const saved = jar.values.get(STATE_COOKIE)!;
    const github = fakeGitHub(signedInHandlers());
    const deps = { fetch: github.fetch, now: () => NOW };

    await completeAuthorization(jar, config, new URLSearchParams({ code: "c", state }), deps);
    const replay = new MemoryJar();
    replay.values.set(STATE_COOKIE, saved);
    const later = await completeAuthorization(replay, config, new URLSearchParams({ code: "c", state }), {
      ...deps,
      now: () => NOW + STATE_MAX_AGE_MS,
    });

    assert.equal(jar.values.has(STATE_COOKIE), false);
    assert.equal(later, "/?github=error");
  });

  it("reports a cancelled authorization", async () => {
    const { jar, state } = startedJar();

    assert.equal(
      await completeAuthorization(jar, config, new URLSearchParams({ error: "access_denied", state })),
      "/?github=denied",
    );
    assert.equal(jar.values.has(STATE_COOKIE), false);
  });

  it("reports a code GitHub rejects without storing anything", async () => {
    const { jar, state } = startedJar();
    const github = fakeGitHub({
      [TOKEN_URL]: () => json({ error: "bad_verification_code", error_description: "The code passed is incorrect or expired." }),
    });

    const location = await completeAuthorization(jar, config, new URLSearchParams({ code: "c", state }), {
      fetch: github.fetch,
      now: () => NOW,
    });

    assert.equal(location, "/?github=error");
    assert.equal(jar.values.has(SESSION_COOKIE), false);
  });

  it("sends a user without an installation on to install the app", async () => {
    const { jar, state } = startedJar();
    const github = fakeGitHub(signedInHandlers(0));

    const location = await completeAuthorization(jar, config, new URLSearchParams({ code: "c", state }), {
      fetch: github.fetch,
      now: () => NOW,
    });

    assert.equal(location, "https://github.com/apps/codefield-local/installations/new");
    assert.equal(jar.values.has(SESSION_COOKIE), true);
  });

  it("ignores an installation_id in the callback", async () => {
    const { jar, state } = startedJar();
    const github = fakeGitHub(signedInHandlers());

    await completeAuthorization(
      jar,
      config,
      new URLSearchParams({ code: "c", state, installation_id: "999", setup_action: "install" }),
      { fetch: github.fetch, now: () => NOW },
    );

    assert.ok(github.calls.every((call) => !call.url.includes("999") && !call.url.includes("/app/")));
  });
});

describe("openConnection", () => {
  it("returns the stored token while it is valid", async () => {
    const connection = openConnection(sessionJar(), config, { now: () => NOW });

    assert.deepEqual(await connection.accessToken(), { ok: true, token: "ghu_access_one" });
  });

  it("reports no connection without a cookie, and clears an unreadable one", async () => {
    assert.deepEqual(await openConnection(new MemoryJar(), config).accessToken(), { ok: false, reason: "not_connected" });

    const jar = new MemoryJar();
    jar.values.set(SESSION_COOKIE, "v1.garbage");
    assert.deepEqual(await openConnection(jar, config).accessToken(), { ok: false, reason: "not_connected" });
    assert.equal(jar.values.has(SESSION_COOKIE), false);
  });

  it("refreshes an expired access token and stores the new one", async () => {
    const jar = sessionJar({ accessTokenExpiresAt: NOW - 1 });
    const github = fakeGitHub({
      [TOKEN_URL]: () => json({ ...grantBody, access_token: "ghu_access_two", refresh_token: "ghr_refresh_two" }),
    });

    const token = await openConnection(jar, config, { fetch: github.fetch, now: () => NOW }).accessToken();

    assert.deepEqual(token, { ok: true, token: "ghu_access_two" });
    assert.deepEqual(JSON.parse(github.calls[0].body), {
      client_id: "Iv23client",
      client_secret: "client-secret-value",
      grant_type: "refresh_token",
      refresh_token: "ghr_refresh_one",
    });
    assert.deepEqual(await openConnection(jar, config, { now: () => NOW }).accessToken(), token);
  });

  it("ends the connection when the refresh token has expired", async () => {
    const jar = sessionJar({ accessTokenExpiresAt: NOW - 1, refreshTokenExpiresAt: NOW - 1 });

    assert.deepEqual(await openConnection(jar, config, { now: () => NOW }).accessToken(), { ok: false, reason: "expired" });
    assert.equal(jar.values.has(SESSION_COOKIE), false);
  });

  it("ends the connection after its maximum age", async () => {
    const jar = sessionJar();
    const later = NOW + SESSION_MAX_AGE_MS;

    assert.deepEqual(connectionStatus(jar, config, later), { connected: false });
    assert.deepEqual(await openConnection(jar, config, { now: () => later }).accessToken(), { ok: false, reason: "expired" });
    assert.equal(jar.values.has(SESSION_COOKIE), false);
  });

  it("treats a rejected refresh after a rejected token as revoked", async () => {
    const jar = sessionJar();
    const github = fakeGitHub({ [TOKEN_URL]: () => json({ error: "bad_refresh_token" }) });

    const token = await openConnection(jar, config, { fetch: github.fetch, now: () => NOW }).renew();

    assert.deepEqual(token, { ok: false, reason: "revoked" });
    assert.equal(jar.values.has(SESSION_COOKIE), false);
  });

  it("keeps the session when GitHub cannot be reached to refresh", async () => {
    const jar = sessionJar({ accessTokenExpiresAt: NOW - 1 });
    const github = fakeGitHub({ [TOKEN_URL]: () => json({ message: "unavailable" }, 503) });

    const token = await openConnection(jar, config, { fetch: github.fetch, now: () => NOW }).accessToken();

    assert.deepEqual(token, { ok: false, reason: "unavailable" });
    assert.equal(jar.values.has(SESSION_COOKIE), true);
  });

  it("uses tokens that never expire without refreshing", async () => {
    const jar = sessionJar({ accessTokenExpiresAt: null, refreshToken: null, refreshTokenExpiresAt: null });

    assert.deepEqual(await openConnection(jar, config, { now: () => NOW + 10 * 24 * HOUR }).accessToken(), {
      ok: true,
      token: "ghu_access_one",
    });
  });

  it("disconnects by clearing the cookie and revoking the token", async () => {
    const jar = sessionJar();
    const github = fakeGitHub({ [REVOKE_URL]: () => new Response(null, { status: 204 }) });

    await openConnection(jar, config, { fetch: github.fetch, now: () => NOW }).disconnect();

    assert.equal(jar.values.has(SESSION_COOKIE), false);
    const cleared = jar.writes.at(-1)!;
    assert.deepEqual([cleared.name, cleared.value, cleared.options.maxAge, cleared.options.path], [SESSION_COOKIE, "", 0, "/"]);
    assert.deepEqual(JSON.parse(github.calls[0].body), { access_token: "ghu_access_one" });
    assert.equal(
      github.calls[0].headers.Authorization,
      `Basic ${Buffer.from("Iv23client:client-secret-value").toString("base64")}`,
    );
    assert.deepEqual(await openConnection(jar, config, { now: () => NOW }).accessToken(), { ok: false, reason: "not_connected" });
  });

  it("still disconnects locally when revoking fails", async () => {
    const jar = sessionJar();
    const github = fakeGitHub({
      [REVOKE_URL]: () => {
        throw new Error("offline");
      },
    });

    await openConnection(jar, config, { fetch: github.fetch, now: () => NOW }).disconnect();

    assert.equal(jar.values.has(SESSION_COOKIE), false);
  });
});
