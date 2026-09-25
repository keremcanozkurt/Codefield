import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { authorizeUrl, connectPath, manageAccessUrl, readGitHubAppConfig } from "./app.ts";

const env = {
  GITHUB_APP_CLIENT_ID: "Iv23client",
  GITHUB_APP_CLIENT_SECRET: "client-secret",
  GITHUB_APP_SLUG: "codefield-local",
  GITHUB_SESSION_SECRET: "x".repeat(32),
};

describe("readGitHubAppConfig", () => {
  it("reads a complete configuration", () => {
    const config = readGitHubAppConfig(env);

    assert.ok(config !== null);
    assert.equal(config.clientId, "Iv23client");
    assert.equal(config.slug, "codefield-local");
    assert.equal(config.sessionKey.length, 32);
    assert.equal(config.secureCookies, false);
    assert.equal(readGitHubAppConfig({ ...env, NODE_ENV: "production" })!.secureCookies, true);
  });

  it("turns private access off when anything is missing or unsafe", () => {
    for (const name of Object.keys(env)) {
      assert.equal(readGitHubAppConfig({ ...env, [name]: "" }), null, name);
    }
    assert.equal(readGitHubAppConfig({ ...env, GITHUB_SESSION_SECRET: "too-short" }), null);
    assert.equal(readGitHubAppConfig({ ...env, GITHUB_APP_SLUG: "../evil" }), null);
  });

  it("does not use the server's GITHUB_TOKEN", () => {
    assert.equal(readGitHubAppConfig({ GITHUB_TOKEN: "ghp_server" }), null);
  });
});

describe("GitHub App URLs", () => {
  const config = readGitHubAppConfig(env)!;

  it("builds the authorization URL with the client ID and state only", () => {
    const url = new URL(authorizeUrl(config, "state-value"));

    assert.equal(url.origin + url.pathname, "https://github.com/login/oauth/authorize");
    assert.deepEqual([...url.searchParams], [["client_id", "Iv23client"], ["state", "state-value"]]);
    assert.ok(!url.href.includes("client-secret"));
  });

  it("links to the app's installation page", () => {
    assert.equal(manageAccessUrl(config), "https://github.com/apps/codefield-local/installations/new");
  });

  it("remembers the repository to return to", () => {
    assert.equal(connectPath(), "/api/github/connect");
    assert.equal(
      connectPath({ owner: "octo", repo: "demo" }),
      "/api/github/connect?repository=https%3A%2F%2Fgithub.com%2Focto%2Fdemo",
    );
  });
});
