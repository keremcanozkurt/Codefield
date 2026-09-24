import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { afterEach, beforeEach, describe, it } from "node:test";

import { strToU8, zipSync, type Zippable } from "fflate";

import { discoverRepository } from "./discovery.ts";

const OWNER = "octo";
const REPO = "demo";
const METADATA_URL = `https://api.github.com/repos/${OWNER}/${REPO}`;
const TREE_URL = `https://api.github.com/repos/${OWNER}/${REPO}/git/trees/main?recursive=1`;
const ARCHIVE_URL = `https://api.github.com/repos/${OWNER}/${REPO}/zipball/main`;
const ARCHIVE_ROOT = `${OWNER}-${REPO}-abc1234`;
const REPOSITORY_URL = `https://github.com/${OWNER}/${REPO}`;

function sha1(bytes: Uint8Array): string {
  return createHash("sha1").update(`blob ${bytes.length}\0`).update(bytes).digest("hex");
}

function json(body: unknown, status = 200, headers: Record<string, string> = {}) {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", ...headers } });
}

function metadataBody(overrides: Record<string, unknown> = {}) {
  return {
    id: 1,
    name: REPO,
    full_name: `${OWNER}/${REPO}`,
    owner: { login: OWNER },
    private: false,
    archived: false,
    html_url: REPOSITORY_URL,
    default_branch: "main",
    size: 10,
    ...overrides,
  };
}

type SourceFileFixture = { path: string; content: string };

function treeFor(files: SourceFileFixture[]) {
  return files.map(({ path, content }) => {
    const bytes = strToU8(content);
    return { path, mode: "100644", type: "blob", sha: sha1(bytes), size: bytes.length };
  });
}

function archiveFor(files: SourceFileFixture[]): Uint8Array {
  const inner: Zippable = {};
  for (const { path, content } of files) inner[path] = strToU8(content);
  return zipSync({ [ARCHIVE_ROOT]: inner });
}

// A fake global fetch that answers a fixed set of routes and errors on
// anything unexpected, so a test only has to state what it wants to happen.
function install(routes: Record<string, () => Response | Promise<Response>>) {
  const original = globalThis.fetch;
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    const url = typeof input === "string" ? input : input.toString();
    const route = routes[url];
    if (route === undefined) throw new Error(`unexpected request: ${url}`);
    return route();
  }) as typeof fetch;
  return () => {
    globalThis.fetch = original;
  };
}

let restore: () => void;
beforeEach(() => {
  restore = install({});
});
afterEach(() => {
  restore();
});

function routes(overrides: Record<string, () => Response | Promise<Response>>) {
  restore();
  restore = install(overrides);
}

describe("discoverRepository", () => {
  it("rejects a malformed URL without making a request", async () => {
    const result = await discoverRepository("not a url");

    assert.equal(result.status, "error");
    assert.ok(result.status === "error" && !result.error.retryable);
  });

  it("rejects non-string input", async () => {
    const result = await discoverRepository(42);
    assert.equal(result.status, "error");
  });

  it("succeeds for an ordinary repository", async () => {
    const files = [
      { path: "src/index.ts", content: "export const a = 1;\n" },
      { path: "src/util.ts", content: "export const b = 2;\n" },
    ];
    routes({
      [METADATA_URL]: () => json(metadataBody()),
      [TREE_URL]: () => json({ sha: "t", truncated: false, tree: treeFor(files) }),
      [ARCHIVE_URL]: () => new Response(Uint8Array.from(archiveFor(files)), { status: 200 }),
    });

    const result = await discoverRepository(REPOSITORY_URL);

    assert.equal(result.status, "success");
    if (result.status !== "success") return;
    assert.equal(result.repository.fullName, "octo/demo");
    assert.equal(result.repository.defaultBranch, "main");
    assert.equal(result.skippedCount, 0);
    assert.equal(result.limited, false);
    assert.equal(result.graph.nodes.length, 2);
  });

  it("reports a repository that does not exist", async () => {
    routes({ [METADATA_URL]: () => json({ message: "Not Found" }, 404) });

    const result = await discoverRepository(REPOSITORY_URL);

    assert.equal(result.status, "error");
    assert.ok(result.status === "error" && result.error.retryable === false);
    assert.match(result.status === "error" ? result.error.title : "", /not found/i);
  });

  it("reports a private repository without exposing GitHub's wording", async () => {
    routes({ [METADATA_URL]: () => json(metadataBody({ private: true })) });

    const result = await discoverRepository(REPOSITORY_URL);

    assert.equal(result.status, "error");
    if (result.status !== "error") return;
    assert.equal(result.error.retryable, false);
    assert.ok(!result.error.message.includes("not supported"));
  });

  it("reports rate limiting with a usable reset time", async () => {
    routes({
      [METADATA_URL]: () =>
        json({ message: "API rate limit exceeded" }, 403, {
          "x-ratelimit-remaining": "0",
          "x-ratelimit-reset": "1790000000",
        }),
    });

    const result = await discoverRepository(REPOSITORY_URL);

    assert.equal(result.status, "error");
    if (result.status !== "error") return;
    assert.equal(result.error.retryable, true);
    assert.equal(result.error.retryAt, new Date(1790000000 * 1000).toISOString());
  });

  it("reports rate limiting even without a reset time", async () => {
    routes({
      [METADATA_URL]: () => json({ message: "secondary rate limit" }, 403),
    });

    const result = await discoverRepository(REPOSITORY_URL);

    assert.equal(result.status, "error");
    if (result.status !== "error") return;
    assert.equal(result.error.retryAt, undefined);
    assert.equal(result.error.retryable, true);
  });

  it("does not reveal that a server token was rejected", async () => {
    routes({ [METADATA_URL]: () => json({ message: "Bad credentials" }, 401) });

    const result = await discoverRepository(REPOSITORY_URL);

    assert.equal(result.status, "error");
    if (result.status !== "error") return;
    assert.ok(!result.error.message.toLowerCase().includes("token"));
    assert.ok(!result.error.message.toLowerCase().includes("credentials"));
  });

  it("reports a network failure reaching GitHub", async () => {
    routes({
      [METADATA_URL]: () => {
        throw new Error("getaddrinfo ENOTFOUND api.github.com");
      },
    });

    const result = await discoverRepository(REPOSITORY_URL);

    assert.equal(result.status, "error");
    if (result.status !== "error") return;
    assert.equal(result.error.retryable, true);
    assert.ok(!result.error.message.includes("ENOTFOUND"));
  });

  it("reports an unexpected upstream failure", async () => {
    routes({ [METADATA_URL]: () => json({ message: "oops" }, 500) });

    const result = await discoverRepository(REPOSITORY_URL);

    assert.equal(result.status, "error");
    if (result.status !== "error") return;
    assert.equal(result.error.retryable, true);
  });

  it("reports a truncated tree instead of analyzing a partial repository", async () => {
    routes({
      [METADATA_URL]: () => json(metadataBody()),
      [TREE_URL]: () => json({ sha: "t", truncated: true, tree: [] }),
    });

    const result = await discoverRepository(REPOSITORY_URL);

    assert.equal(result.status, "error");
    if (result.status !== "error") return;
    assert.equal(result.error.retryable, true);
    assert.match(result.error.title, /tree/i);
  });

  it("treats a repository with an empty tree as empty, not an error", async () => {
    routes({
      [METADATA_URL]: () => json(metadataBody()),
      [TREE_URL]: () => json({ sha: "t", truncated: false, tree: [] }),
    });

    const result = await discoverRepository(REPOSITORY_URL);

    assert.equal(result.status, "empty");
    if (result.status !== "empty") return;
    assert.equal(result.repository.fullName, "octo/demo");
  });

  it("treats GitHub's empty-repository response (409) as empty, not an error", async () => {
    routes({
      [METADATA_URL]: () => json(metadataBody()),
      [TREE_URL]: () => json({ message: "Git Repository is empty." }, 409),
    });

    const result = await discoverRepository(REPOSITORY_URL);

    assert.equal(result.status, "empty");
  });

  it("reports a repository with no supported source files, not as an error", async () => {
    routes({
      [METADATA_URL]: () => json(metadataBody()),
      [TREE_URL]: () =>
        json({
          sha: "t",
          truncated: false,
          tree: [
            { path: "README.md", mode: "100644", type: "blob", sha: sha1(strToU8("# demo")), size: 6 },
            { path: "package.json", mode: "100644", type: "blob", sha: sha1(strToU8("{}")), size: 2 },
          ],
        }),
    });

    const result = await discoverRepository(REPOSITORY_URL);

    assert.equal(result.status, "unsupported");
  });

  it("reports an archive GitHub could not read", async () => {
    const files = [{ path: "a.ts", content: "export {};\n" }];
    routes({
      [METADATA_URL]: () => json(metadataBody()),
      [TREE_URL]: () => json({ sha: "t", truncated: false, tree: treeFor(files) }),
      [ARCHIVE_URL]: () => new Response(Uint8Array.from(strToU8("not a zip file")), { status: 200 }),
    });

    const result = await discoverRepository(REPOSITORY_URL);

    assert.equal(result.status, "error");
    if (result.status !== "error") return;
    assert.equal(result.error.retryable, true);
    assert.ok(!result.error.message.toLowerCase().includes("zip"));
  });

  it("reports skipped files without failing the analysis", async () => {
    const included = { path: "src/a.ts", content: "export {};\n" };
    const missingFromArchive = { path: "src/b.ts", content: "export {};\n" };
    routes({
      [METADATA_URL]: () => json(metadataBody()),
      [TREE_URL]: () => json({ sha: "t", truncated: false, tree: treeFor([included, missingFromArchive]) }),
      // The archive only contains one of the two selected files.
      [ARCHIVE_URL]: () => new Response(Uint8Array.from(archiveFor([included])), { status: 200 }),
    });

    const result = await discoverRepository(REPOSITORY_URL);

    assert.equal(result.status, "success");
    if (result.status !== "success") return;
    assert.equal(result.skippedCount, 1);
    assert.equal(result.graph.nodes.length, 1);
  });

  it("never lets a raw error message reach the presented result", async () => {
    const secret = "ghp_leaked_token_marker";
    routes({
      [METADATA_URL]: () => json({ message: `internal failure ${secret}` }, 500),
    });

    const result = await discoverRepository(REPOSITORY_URL);

    assert.equal(result.status, "error");
    if (result.status !== "error") return;
    assert.ok(!result.error.title.includes(secret));
    assert.ok(!result.error.message.includes(secret));
  });
});
