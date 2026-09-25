import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { deriveSessionKey, seal, unseal } from "./session.ts";

const key = deriveSessionKey("a-session-secret-that-is-long-enough-000");
const payload = { accessToken: "ghu_secret_access_token", login: "octo" };

describe("sealed cookies", () => {
  it("round-trips a payload", () => {
    assert.deepEqual(unseal(key, "cookie", seal(key, "cookie", payload)), payload);
  });

  it("does not contain the payload in readable form", () => {
    const sealed = seal(key, "cookie", payload);

    assert.ok(!sealed.includes("ghu_secret_access_token"));
    assert.ok(!Buffer.from(sealed.slice(3), "base64url").toString("latin1").includes("ghu_secret"));
    assert.notEqual(sealed, seal(key, "cookie", payload));
  });

  it("rejects a value sealed with another key", () => {
    const other = deriveSessionKey("a-different-secret-that-is-long-enough-1");

    assert.equal(unseal(other, "cookie", seal(key, "cookie", payload)), null);
  });

  it("rejects a value sealed for another cookie", () => {
    assert.equal(unseal(key, "session", seal(key, "state", payload)), null);
  });

  it("rejects modified and malformed values", () => {
    const sealed = seal(key, "cookie", payload);
    const bytes = Buffer.from(sealed.slice(3), "base64url");
    bytes[bytes.length - 20] ^= 1;

    assert.equal(unseal(key, "cookie", `v1.${bytes.toString("base64url")}`), null);
    assert.equal(unseal(key, "cookie", sealed.slice(0, -4)), null);
    assert.equal(unseal(key, "cookie", "v1."), null);
    assert.equal(unseal(key, "cookie", "not a sealed value"), null);
    assert.equal(unseal(key, "cookie", `v2.${sealed.slice(3)}`), null);
  });
});
