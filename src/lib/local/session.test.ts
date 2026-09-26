import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { isAuthorizedRequest, readLocalSession, sessionCookieName, type RequestFacts } from "./session.ts";

const TOKEN = "k".repeat(43);
const session = { root: "/home/user/project", token: TOKEN, port: 4173 };

function facts(overrides: Partial<RequestFacts> = {}): RequestFacts {
  return {
    host: "127.0.0.1:4173",
    origin: "http://127.0.0.1:4173",
    fetchSite: "same-origin",
    cookie: TOKEN,
    ...overrides,
  };
}

describe("readLocalSession", () => {
  it("reads the root, token and port the launcher set", () => {
    assert.deepEqual(
      readLocalSession({ CODEFIELD_ROOT: "/r", CODEFIELD_TOKEN: TOKEN, CODEFIELD_PORT: "4173" }),
      { root: "/r", token: TOKEN, port: 4173 },
    );
  });

  it("is off without a root, with a short token, or with a bad port", () => {
    assert.equal(readLocalSession({}), null);
    assert.equal(readLocalSession({ CODEFIELD_ROOT: "/r", CODEFIELD_TOKEN: "short", CODEFIELD_PORT: "4173" }), null);
    assert.equal(readLocalSession({ CODEFIELD_ROOT: "/r", CODEFIELD_TOKEN: TOKEN, CODEFIELD_PORT: "http" }), null);
  });
});

describe("isAuthorizedRequest", () => {
  it("accepts a same-origin request from the Codefield page", () => {
    assert.equal(isAuthorizedRequest(session, facts()), true);
    assert.equal(isAuthorizedRequest(session, facts({ host: "localhost:4173", origin: "http://localhost:4173" })), true);
  });

  it("rejects another site, including another port on localhost", () => {
    assert.equal(isAuthorizedRequest(session, facts({ origin: "https://evil.example" })), false);
    assert.equal(isAuthorizedRequest(session, facts({ origin: "http://127.0.0.1:8080" })), false);
    assert.equal(isAuthorizedRequest(session, facts({ origin: "null" })), false);
    assert.equal(isAuthorizedRequest(session, facts({ fetchSite: "cross-site", origin: null })), false);
    assert.equal(isAuthorizedRequest(session, facts({ fetchSite: "same-site", origin: null })), false);
  });

  it("rejects DNS rebinding: a non-loopback Host, even with a matching Origin", () => {
    assert.equal(
      isAuthorizedRequest(session, facts({ host: "attacker.example:4173", origin: "http://attacker.example:4173" })),
      false,
    );
    assert.equal(isAuthorizedRequest(session, facts({ host: "127.0.0.1:9999", origin: "http://127.0.0.1:9999" })), false);
    assert.equal(isAuthorizedRequest(session, facts({ host: null })), false);
  });

  it("requires the session cookie with this process's token", () => {
    assert.equal(isAuthorizedRequest(session, facts({ cookie: undefined })), false);
    assert.equal(isAuthorizedRequest(session, facts({ cookie: "x".repeat(43) })), false);
    assert.equal(isAuthorizedRequest(session, facts({ cookie: TOKEN.slice(1) })), false);
  });

  it("accepts a local non-browser client that holds the token", () => {
    assert.equal(isAuthorizedRequest(session, facts({ origin: null, fetchSite: null })), true);
  });
});

describe("sessionCookieName", () => {
  it("differs per port, since cookies ignore ports", () => {
    assert.notEqual(sessionCookieName({ port: 4173 }), sessionCookieName({ port: 4174 }));
  });
});
