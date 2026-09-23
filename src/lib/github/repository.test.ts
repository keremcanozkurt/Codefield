import assert from "node:assert/strict";
import { describe, it } from "node:test";

import type { FetchLike } from "./client.ts";
import { loadRepository } from "./repository.ts";

const METADATA_URL = "https://api.github.com/repos/vercel/ms";
const TREE_URL = "https://api.github.com/repos/vercel/ms/git/trees/main?recursive=1";

const metadataBody = {
  id: 1,
  node_id: "R_1",
  name: "ms",
  full_name: "vercel/ms",
  owner: { login: "vercel", id: 14985020, type: "Organization" },
  private: false,
  archived: false,
  html_url: "https://github.com/vercel/ms",
  description: "Tiny millisecond conversion utility",
  default_branch: "main",
  size: 312,
  stargazers_count: 5000,
  visibility: "public",
};

const treeBody = {
  sha: "tree-sha",
  url: "https://api.github.com/repos/vercel/ms/git/trees/tree-sha",
  truncated: false,
  tree: [
    { path: "src", mode: "040000", type: "tree", sha: "a1", url: "https://api.github.com/a1" },
    { path: "src/index.ts", mode: "100644", type: "blob", sha: "b1", size: 4200, url: "https://api.github.com/b1" },
    { path: "package.json", mode: "100644", type: "blob", sha: "b2", size: 900, url: "https://api.github.com/b2" },
  ],
};

type Route = () => Response | Promise<Response>;

function json(body: unknown, status = 200, headers: Record<string, string> = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json", ...headers },
  });
}

function fakeGitHub(routes: Record<string, Route>) {
  const requests: { url: string; headers: Headers }[] = [];
  const fetch: FetchLike = async (url, init) => {
    requests.push({ url, headers: new Headers(init.headers) });
    const route = routes[url];
    return route ? route() : json({ message: "unexpected request" }, 500);
  };
  return { fetch, requests };
}

function okRoutes(overrides: Record<string, Route> = {}) {
  return {
    [METADATA_URL]: () => json(metadataBody),
    [TREE_URL]: () => json(treeBody),
    ...overrides,
  };
}

const ref = { owner: "vercel", repo: "ms" };

describe("loadRepository", () => {
  it("normalizes repository metadata", async () => {
    const github = fakeGitHub(okRoutes());
    const result = await loadRepository(ref, { fetch: github.fetch });

    assert.equal(result.ok, true);
    assert.deepEqual(result.ok && result.data.metadata, {
      owner: "vercel",
      name: "ms",
      fullName: "vercel/ms",
      defaultBranch: "main",
      htmlUrl: "https://github.com/vercel/ms",
      isPrivate: false,
      isArchived: false,
      sizeKb: 312,
    });
  });

  it("normalizes the recursive tree", async () => {
    const github = fakeGitHub(okRoutes());
    const result = await loadRepository(ref, { fetch: github.fetch });

    assert.deepEqual(result.ok && result.data.tree, {
      sha: "tree-sha",
      entries: [
        { path: "src", type: "tree", sha: "a1" },
        { path: "src/index.ts", type: "blob", sha: "b1", size: 4200 },
        { path: "package.json", type: "blob", sha: "b2", size: 900 },
      ],
    });
  });

  it("keeps only the expected fields", async () => {
    const github = fakeGitHub(okRoutes());
    const result = await loadRepository(ref, { fetch: github.fetch });
    assert.ok(result.ok);

    assert.deepEqual(Object.keys(result.data).sort(), ["metadata", "tree"]);
    assert.deepEqual(Object.keys(result.data.metadata).sort(), [
      "defaultBranch",
      "fullName",
      "htmlUrl",
      "isArchived",
      "isPrivate",
      "name",
      "owner",
      "sizeKb",
    ]);
    assert.deepEqual(Object.keys(result.data.tree).sort(), ["entries", "sha"]);
    for (const entry of result.data.tree.entries) {
      const expected = entry.type === "blob" ? ["path", "sha", "size", "type"] : ["path", "sha", "type"];
      assert.deepEqual(Object.keys(entry).sort(), expected);
    }
  });

  it("makes one metadata request and one tree request", async () => {
    const github = fakeGitHub(okRoutes());
    await loadRepository(ref, { fetch: github.fetch });

    assert.deepEqual(
      github.requests.map((request) => request.url),
      [METADATA_URL, TREE_URL],
    );
  });

  it("requests the tree for the default branch and canonical name from metadata", async () => {
    const treeUrl =
      "https://api.github.com/repos/Vercel/ms-renamed/git/trees/release%2Fv3?recursive=1";
    const github = fakeGitHub({
      [METADATA_URL]: () =>
        json({
          ...metadataBody,
          owner: { login: "Vercel" },
          name: "ms-renamed",
          full_name: "Vercel/ms-renamed",
          default_branch: "release/v3",
        }),
      [treeUrl]: () => json(treeBody),
    });

    const result = await loadRepository(ref, { fetch: github.fetch });

    assert.equal(result.ok, true);
    assert.equal(github.requests[1]?.url, treeUrl);
  });

  it("sends GitHub headers without Authorization when no token is set", async () => {
    const github = fakeGitHub(okRoutes());
    await loadRepository(ref, { fetch: github.fetch });

    for (const { headers } of github.requests) {
      assert.equal(headers.get("accept"), "application/vnd.github+json");
      assert.equal(headers.get("user-agent"), "Codefield");
      assert.equal(headers.get("x-github-api-version"), "2022-11-28");
      assert.equal(headers.has("authorization"), false);
    }
  });

  it("adds a bearer Authorization header when a token is set", async () => {
    const github = fakeGitHub(okRoutes());
    await loadRepository(ref, { fetch: github.fetch, token: "test-token" });

    assert.equal(github.requests.length, 2);
    for (const { headers } of github.requests) {
      assert.equal(headers.get("authorization"), "Bearer test-token");
    }
  });

  it("skips submodules and symlinks", async () => {
    const github = fakeGitHub(
      okRoutes({
        [TREE_URL]: () =>
          json({
            ...treeBody,
            tree: [
              ...treeBody.tree,
              { path: "vendor/lib", mode: "160000", type: "commit", sha: "c1" },
              { path: "link.ts", mode: "120000", type: "blob", sha: "l1", size: 12 },
            ],
          }),
      }),
    );
    const result = await loadRepository(ref, { fetch: github.fetch });

    assert.ok(result.ok);
    assert.deepEqual(
      result.data.tree.entries.map((entry) => entry.path),
      ["src", "src/index.ts", "package.json"],
    );
  });

  describe("failures", () => {
    async function load(routes: Record<string, Route>, token?: string) {
      const github = fakeGitHub(routes);
      const result = await loadRepository(ref, { fetch: github.fetch, token });
      assert.equal(result.ok, false);
      return { error: result.ok ? undefined : result.error, requests: github.requests };
    }

    it("reports a missing repository and skips the tree request", async () => {
      const { error, requests } = await load({
        [METADATA_URL]: () => json({ message: "Not Found" }, 404),
      });

      assert.equal(error?.code, "not_found");
      assert.equal(requests.length, 1);
    });

    it("rejects private repositories", async () => {
      const { error, requests } = await load(
        okRoutes({ [METADATA_URL]: () => json({ ...metadataBody, private: true }) }),
        "test-token",
      );

      assert.equal(error?.code, "repository_inaccessible");
      assert.equal(requests.length, 1);
    });

    it("reports a 403 without rate-limit signals as inaccessible", async () => {
      const { error } = await load({
        [METADATA_URL]: () =>
          json({ message: "Repository access blocked" }, 403, { "x-ratelimit-remaining": "42" }),
      });

      assert.equal(error?.code, "repository_inaccessible");
    });

    it("reports the primary rate limit with remaining count and reset time", async () => {
      const { error } = await load({
        [METADATA_URL]: () =>
          json({ message: "API rate limit exceeded" }, 403, {
            "x-ratelimit-limit": "60",
            "x-ratelimit-remaining": "0",
            "x-ratelimit-reset": "1790000000",
          }),
      });

      assert.equal(error?.code, "rate_limited");
      assert.deepEqual(error?.rateLimit, {
        limit: 60,
        remaining: 0,
        resetAt: new Date(1790000000 * 1000).toISOString(),
        authenticated: false,
      });
    });

    it("reports a secondary rate limit from retry-after", async () => {
      const before = Date.now();
      const { error } = await load(
        { [METADATA_URL]: () => json({ message: "slow down" }, 429, { "retry-after": "60" }) },
        "test-token",
      );

      assert.equal(error?.code, "rate_limited");
      assert.equal(error?.rateLimit?.authenticated, true);
      const resetAt = Date.parse(error?.rateLimit?.resetAt ?? "");
      assert.ok(resetAt >= before + 60_000 && resetAt <= Date.now() + 60_000);
    });

    it("reports a secondary rate limit identified only by its message", async () => {
      const { error } = await load({
        [METADATA_URL]: () =>
          json({ message: "You have exceeded a secondary rate limit." }, 403),
      });

      assert.equal(error?.code, "rate_limited");
    });

    it("reports a rejected token without exposing it or GitHub's message", async () => {
      const { error } = await load(
        { [METADATA_URL]: () => json({ message: "Bad credentials" }, 401) },
        "secret-token",
      );

      assert.equal(error?.code, "unauthorized");
      const serialized = JSON.stringify(error);
      assert.equal(serialized.includes("secret-token"), false);
      assert.equal(serialized.includes("Bad credentials"), false);
    });

    it("reports malformed repository metadata", async () => {
      const withoutBranch: Record<string, unknown> = { ...metadataBody };
      delete withoutBranch.default_branch;
      const cases = [
        withoutBranch,
        { ...metadataBody, private: "no" },
        { ...metadataBody, owner: null },
        { ...metadataBody, html_url: "https://example.com/vercel/ms" },
        [metadataBody],
      ];

      for (const body of cases) {
        const { error, requests } = await load({ [METADATA_URL]: () => json(body) });
        assert.equal(error?.code, "malformed_response");
        assert.equal(requests.length, 1);
      }
    });

    it("reports a metadata body that is not JSON", async () => {
      const { error } = await load({
        [METADATA_URL]: () => new Response("<html>", { status: 200 }),
      });

      assert.equal(error?.code, "malformed_response");
    });

    it("reports a malformed tree payload", async () => {
      const cases = [
        { ...treeBody, tree: "src/index.ts" },
        { ...treeBody, truncated: undefined },
        { ...treeBody, tree: [{ path: "src/index.ts", mode: "100644", type: "blob", sha: "b1" }] },
        { ...treeBody, tree: [{ mode: "100644", type: "blob", sha: "b1", size: 1 }] },
        { ...treeBody, tree: [{ path: "x", mode: "100644", type: "tag", sha: "t1" }] },
      ];

      for (const body of cases) {
        const { error } = await load(okRoutes({ [TREE_URL]: () => json(body) }));
        assert.equal(error?.code, "malformed_response");
      }
    });

    it("rejects a truncated tree", async () => {
      const { error } = await load(
        okRoutes({ [TREE_URL]: () => json({ ...treeBody, truncated: true }) }),
      );

      assert.equal(error?.code, "tree_truncated");
    });

    it("reports an unavailable tree for an empty repository", async () => {
      const { error } = await load(
        okRoutes({ [TREE_URL]: () => json({ message: "Git Repository is empty." }, 409) }),
      );

      assert.equal(error?.code, "tree_unavailable");
    });

    it("reports rate limiting on the tree request", async () => {
      const { error } = await load(
        okRoutes({
          [TREE_URL]: () => json({}, 403, { "x-ratelimit-remaining": "0" }),
        }),
      );

      assert.equal(error?.code, "rate_limited");
    });

    it("reports network failures", async () => {
      const fetch: FetchLike = async () => {
        throw new TypeError("fetch failed");
      };
      const result = await loadRepository(ref, { fetch });

      assert.deepEqual(result, {
        ok: false,
        error: { code: "network_error", message: "Could not reach GitHub." },
      });
    });

    it("reports upstream server errors", async () => {
      const { error } = await load({
        [METADATA_URL]: () => json({ message: "Server Error" }, 502),
      });

      assert.equal(error?.code, "upstream_error");
    });
  });
});
