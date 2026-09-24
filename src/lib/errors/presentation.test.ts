import assert from "node:assert/strict";
import { describe, it } from "node:test";

import type { GitHubError, GitHubErrorCode, RateLimit } from "../github/types.ts";
import { EMPTY_REPOSITORY, NO_SUPPORTED_SOURCE_FILES, presentGitHubError } from "./presentation.ts";

const CODES: GitHubErrorCode[] = [
  "not_found",
  "repository_inaccessible",
  "rate_limited",
  "unauthorized",
  "malformed_response",
  "tree_unavailable",
  "tree_truncated",
  "archive_unavailable",
  "archive_too_large",
  "malformed_archive",
  "network_error",
  "upstream_error",
];

const SECRET = "ghp_super_secret_token_value";

function errorOf(code: GitHubErrorCode, rateLimit?: RateLimit): GitHubError {
  // The internal message intentionally carries something that must never
  // reach a component: presentGitHubError should never read it.
  return { code, message: `internal detail ${SECRET}`, rateLimit };
}

describe("presentGitHubError", () => {
  it("produces a non-empty title and message for every known code", () => {
    for (const code of CODES) {
      const presented = presentGitHubError(errorOf(code));
      assert.ok(presented.title.length > 0, code);
      assert.ok(presented.message.length > 0, code);
      assert.equal(typeof presented.retryable, "boolean", code);
    }
  });

  it("never includes the internal GitHubError message", () => {
    for (const code of CODES) {
      const presented = presentGitHubError(errorOf(code));
      assert.ok(!presented.title.includes(SECRET), code);
      assert.ok(!presented.message.includes(SECRET), code);
    }
  });

  it("never mentions the token, headers or internal endpoints", () => {
    const forbidden = ["token", "authorization", "api.github.com", "bearer", "stack"];
    for (const code of CODES) {
      const presented = presentGitHubError(errorOf(code));
      const text = `${presented.title} ${presented.message}`.toLowerCase();
      for (const word of forbidden) {
        assert.ok(!text.includes(word), `${code} should not mention "${word}"`);
      }
    }
  });

  it("marks not found, private, too-large and unauthorized as non-retryable", () => {
    assert.equal(presentGitHubError(errorOf("not_found")).retryable, false);
    assert.equal(presentGitHubError(errorOf("repository_inaccessible")).retryable, false);
    assert.equal(presentGitHubError(errorOf("archive_too_large")).retryable, false);
    assert.equal(presentGitHubError(errorOf("unauthorized")).retryable, false);
  });

  it("marks network, upstream and rate-limit failures as retryable", () => {
    assert.equal(presentGitHubError(errorOf("network_error")).retryable, true);
    assert.equal(presentGitHubError(errorOf("upstream_error")).retryable, true);
    assert.equal(presentGitHubError(errorOf("rate_limited")).retryable, true);
  });

  it("does not expose that a server token was rejected", () => {
    const presented = presentGitHubError(errorOf("unauthorized"));
    assert.ok(!presented.message.toLowerCase().includes("token"));
    assert.ok(!presented.title.toLowerCase().includes("token"));
  });

  describe("rate limiting", () => {
    it("includes a reset time when GitHub provided one", () => {
      const rateLimit: RateLimit = { limit: 60, remaining: 0, resetAt: "2026-09-24T09:42:00.000Z", authenticated: false };
      const presented = presentGitHubError(errorOf("rate_limited", rateLimit));

      assert.equal(presented.retryAt, "2026-09-24T09:42:00.000Z");
      assert.equal(presented.retryable, true);
      assert.match(presented.title, /anonymous/i);
    });

    it("has no retryAt when GitHub did not provide a reset time", () => {
      const rateLimit: RateLimit = { limit: 60, remaining: 0, resetAt: null, authenticated: false };
      const presented = presentGitHubError(errorOf("rate_limited", rateLimit));

      assert.equal(presented.retryAt, undefined);
      assert.equal(presented.retryable, true);
    });

    it("distinguishes authenticated from anonymous limits", () => {
      const rateLimit: RateLimit = { limit: 5000, remaining: 0, resetAt: null, authenticated: true };
      const presented = presentGitHubError(errorOf("rate_limited", rateLimit));

      assert.doesNotMatch(presented.title, /anonymous/i);
    });

    it("still presents a rate limit with no rateLimit metadata at all", () => {
      const presented = presentGitHubError(errorOf("rate_limited", undefined));
      assert.equal(presented.retryAt, undefined);
      assert.equal(presented.retryable, true);
    });
  });
});

describe("non-error notices", () => {
  it("describes an empty repository without calling it an error", () => {
    assert.ok(!EMPTY_REPOSITORY.title.toLowerCase().includes("error"));
    assert.ok(EMPTY_REPOSITORY.message.length > 0);
  });

  it("describes a repository with no supported files without calling it an error", () => {
    assert.ok(!NO_SUPPORTED_SOURCE_FILES.title.toLowerCase().includes("error"));
    assert.ok(NO_SUPPORTED_SOURCE_FILES.message.length > 0);
  });
});
