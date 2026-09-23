import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { describe, it } from "node:test";

import { deflateSync, strToU8, zipSync, type Zippable } from "fflate";

import { selectSourceFiles, type SourceCandidate } from "../source-files.ts";
import {
  MAX_ARCHIVE_BYTES,
  extractSourceFiles,
  loadSourceFiles,
} from "./archive.ts";
import type { FetchLike } from "./client.ts";
import { loadRepository } from "./repository.ts";
import type { TreeEntry } from "./types.ts";

const ROOT = "vercel-ms-7f3c2a1";
const repository = { owner: "vercel", name: "ms", defaultBranch: "main" };
const ARCHIVE_URL = "https://api.github.com/repos/vercel/ms/zipball/main";

function gitBlobSha(bytes: Uint8Array) {
  return createHash("sha1").update(`blob ${bytes.length}\0`).update(bytes).digest("hex");
}

function toBytes(content: string | Uint8Array) {
  return typeof content === "string" ? strToU8(content) : content;
}

function candidate(path: string, content: string | Uint8Array = `// ${path}\n`): SourceCandidate {
  const bytes = toBytes(content);
  const isTypeScript = path.endsWith(".ts") || path.endsWith(".tsx");
  return {
    path,
    sha: gitBlobSha(bytes),
    size: bytes.length,
    extension: isTypeScript ? ".ts" : ".js",
    language: isTypeScript ? "typescript" : "javascript",
  };
}

function zip(files: Record<string, string | Uint8Array>, root = ROOT, extra: Zippable = {}) {
  const inner: Zippable = {};
  for (const [path, content] of Object.entries(files)) inner[path] = toBytes(content);
  return zipSync({ [root]: inner, ...extra });
}

function replaceAll(haystack: Uint8Array, search: Uint8Array, replacement: Uint8Array) {
  const result = haystack.slice();
  let replaced = 0;
  for (let i = 0; i <= result.length - search.length; i++) {
    if (search.every((byte, j) => result[i + j] === byte)) {
      result.set(replacement, i);
      replaced++;
    }
  }
  assert.ok(replaced > 0, "fixture bytes not found");
  return result;
}

function zipResponse(bytes: Uint8Array) {
  return new Response(Uint8Array.from(bytes), {
    status: 200,
    headers: { "content-type": "application/zip" },
  });
}

function json(body: unknown, status: number, headers: Record<string, string> = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json", ...headers },
  });
}

function fakeGitHub(routes: Record<string, () => Response>) {
  const requests: { url: string; headers: Headers }[] = [];
  const fetch: FetchLike = async (url, init) => {
    requests.push({ url, headers: new Headers(init.headers) });
    return routes[url]?.() ?? json({ message: "unexpected request" }, 500);
  };
  return { fetch, requests };
}

describe("extractSourceFiles", () => {
  it("loads selected files and strips the generated archive directory", () => {
    const index = candidate("src/index.ts", "export const ms = 1;\n");
    const util = candidate("src/lib/util.js", "module.exports = {};\n");
    const archive = zip({
      "src/index.ts": "export const ms = 1;\n",
      "src/lib/util.js": "module.exports = {};\n",
    });

    const result = extractSourceFiles(archive, [index, util]);

    assert.deepEqual(result, {
      ok: true,
      data: {
        files: [
          { ...index, content: "export const ms = 1;\n" },
          { ...util, content: "module.exports = {};\n" },
        ],
        skipped: [],
      },
    });
  });

  it("does not depend on the name of the archive directory", () => {
    const index = candidate("index.js");
    for (const root of ["owner-repo-abc1234", "x", "Some.Repo-v2-0000000"]) {
      const result = extractSourceFiles(zip({ "index.js": "// index.js\n" }, root), [index]);
      assert.ok(result.ok);
      assert.deepEqual(result.data.files.map((f) => f.path), ["index.js"]);
    }
  });

  it("keeps the SHA from the tree, which matches Git's blob ID", () => {
    const hello = { ...candidate("hello.js", "hello\n"), sha: "ce013625030ba8dba906f756967f9e9ca394464a" };
    const result = extractSourceFiles(zip({ "hello.js": "hello\n" }), [hello]);

    assert.ok(result.ok);
    assert.equal(result.data.files[0].sha, "ce013625030ba8dba906f756967f9e9ca394464a");
  });

  it("returns only selected candidates and ignores other entries", () => {
    const selected = candidate("src/a.ts");
    const archive = zip({
      "src/a.ts": "// src/a.ts\n",
      "src/unselected.ts": "export {};\n",
      "README.md": "# ms\n",
      "package.json": "{}\n",
      "node_modules/pkg/index.js": "module.exports = 1;\n",
    });

    const result = extractSourceFiles(archive, [selected]);

    assert.ok(result.ok);
    assert.deepEqual(result.data.files.map((f) => f.path), ["src/a.ts"]);
    assert.deepEqual(result.data.skipped, []);
  });

  it("does not inflate unselected entries", () => {
    const selected = candidate("src/a.ts");
    const unselectedContent = strToU8(`${"unselected ".repeat(200)}\n`);
    const archive = zip({ "src/a.ts": "// src/a.ts\n", "src/b.ts": unselectedContent });
    const corrupted = replaceAll(
      archive,
      deflateSync(unselectedContent),
      new Uint8Array(deflateSync(unselectedContent).length).fill(0xff),
    );

    assert.equal(extractSourceFiles(corrupted, [selected]).ok, true);
    assert.deepEqual(extractSourceFiles(corrupted, [selected, candidate("src/b.ts", unselectedContent)]), {
      ok: false,
      error: {
        code: "malformed_archive",
        message: "GitHub returned a repository archive Codefield could not read.",
      },
    });
  });

  it("rejects archives with path traversal", () => {
    const archive = zip({ "src/a.ts": "// src/a.ts\n", "src/../../etc/passwd.js": "x" });
    const result = extractSourceFiles(archive, [candidate("src/a.ts")]);

    assert.equal(!result.ok && result.error.code, "malformed_archive");
  });

  it("rejects archives with absolute paths", () => {
    const archive = zip({ "src/a.ts": "// src/a.ts\n" }, ROOT, { "/etc/passwd.js": strToU8("x") });
    const result = extractSourceFiles(archive, [candidate("src/a.ts")]);

    assert.equal(!result.ok && result.error.code, "malformed_archive");
  });

  it("rejects archives with more than one top-level directory", () => {
    const archive = zip({ "src/a.ts": "// src/a.ts\n" }, ROOT, {
      "other-root": { "src/a.ts": strToU8("// src/a.ts\n") },
    });
    const result = extractSourceFiles(archive, [candidate("src/a.ts")]);

    assert.equal(!result.ok && result.error.code, "malformed_archive");
  });

  it("rejects archives with duplicate paths", () => {
    const archive = zip({ "src/a.ts": "// src/a.ts\n", "src/b.ts": "// src/a.ts\n" });
    const duplicated = replaceAll(archive, strToU8(`${ROOT}/src/b.ts`), strToU8(`${ROOT}/src/a.ts`));
    const result = extractSourceFiles(duplicated, [candidate("src/a.ts")]);

    assert.equal(!result.ok && result.error.code, "malformed_archive");
  });

  it("rejects data that is not a ZIP archive", () => {
    const valid = zip({ "src/a.ts": "// src/a.ts\n" });
    for (const bytes of [
      strToU8("<!doctype html><title>Error</title>"),
      new Uint8Array(0),
      valid.subarray(0, valid.length - 30),
    ]) {
      const result = extractSourceFiles(bytes, [candidate("src/a.ts")]);
      assert.equal(!result.ok && result.error.code, "malformed_archive");
    }
  });

  it("rejects archives with too many entries", () => {
    const archive = zip({ "a.ts": "1", "b.ts": "2", "c.ts": "3" });
    const result = extractSourceFiles(archive, [candidate("a.ts", "1")], { maxEntries: 3 });

    assert.equal(!result.ok && result.error.code, "archive_too_large");
  });

  it("skips a selected file that is not in the archive", () => {
    const present = candidate("src/present.ts");
    const missing = candidate("src/missing.ts");
    const result = extractSourceFiles(zip({ "src/present.ts": "// src/present.ts\n" }), [missing, present]);

    assert.ok(result.ok);
    assert.deepEqual(result.data.files.map((f) => f.path), ["src/present.ts"]);
    assert.deepEqual(result.data.skipped, [{ path: "src/missing.ts", reason: "missing" }]);
  });

  it("skips files whose archive content differs from the tree", () => {
    const sameSize = { ...candidate("same-size.ts", "aaaa"), sha: gitBlobSha(strToU8("bbbb")) };
    const otherSize = candidate("other-size.ts", "short");
    const archive = zip({ "same-size.ts": "aaaa", "other-size.ts": "much longer content" });

    const result = extractSourceFiles(archive, [sameSize, otherSize]);

    assert.ok(result.ok);
    assert.deepEqual(result.data.files, []);
    assert.deepEqual(result.data.skipped, [
      { path: "same-size.ts", reason: "content_mismatch" },
      { path: "other-size.ts", reason: "content_mismatch" },
    ]);
  });

  it("skips files that are not valid UTF-8", () => {
    const bytes = new Uint8Array([0x63, 0x6f, 0x6e, 0x73, 0x74, 0xff, 0xfe]);
    const result = extractSourceFiles(zip({ "latin1.js": bytes }), [candidate("latin1.js", bytes)]);

    assert.ok(result.ok);
    assert.deepEqual(result.data.skipped, [{ path: "latin1.js", reason: "not_utf8" }]);
  });

  it("decodes multi-byte UTF-8", () => {
    const text = 'const label = "héllo wörld – ✓";\n';
    const result = extractSourceFiles(zip({ "label.js": text }), [candidate("label.js", text)]);

    assert.ok(result.ok);
    assert.equal(result.data.files[0].content, text);
  });
});

describe("loadSourceFiles", () => {
  const index = candidate("src/index.ts");
  const archive = zip({ "src/index.ts": "// src/index.ts\n" });

  it("downloads the default branch archive once", async () => {
    const github = fakeGitHub({ [ARCHIVE_URL]: () => zipResponse(archive) });
    const result = await loadSourceFiles(repository, [index], { fetch: github.fetch });

    assert.ok(result.ok);
    assert.deepEqual(result.data.files.map((f) => f.path), ["src/index.ts"]);
    assert.deepEqual(github.requests.map((r) => r.url), [ARCHIVE_URL]);
  });

  it("makes one request for 1 or 500 files and none for 0", async () => {
    const paths = Array.from({ length: 500 }, (_, i) => `src/f${String(i).padStart(3, "0")}.ts`);
    const many = zip(Object.fromEntries(paths.map((p) => [p, `// ${p}\n`])));
    const manyCandidates = paths.map((p) => candidate(p));

    for (const candidates of [manyCandidates.slice(0, 1), manyCandidates]) {
      const github = fakeGitHub({ [ARCHIVE_URL]: () => zipResponse(many) });
      const result = await loadSourceFiles(repository, candidates, { fetch: github.fetch });

      assert.ok(result.ok);
      assert.equal(result.data.files.length, candidates.length);
      assert.equal(github.requests.length, 1);
    }

    const github = fakeGitHub({});
    assert.deepEqual(await loadSourceFiles(repository, [], { fetch: github.fetch }), {
      ok: true,
      data: { files: [], skipped: [] },
    });
    assert.equal(github.requests.length, 0);
  });

  it("sends no Authorization header without a token", async () => {
    const github = fakeGitHub({ [ARCHIVE_URL]: () => zipResponse(archive) });
    await loadSourceFiles(repository, [index], { fetch: github.fetch });

    assert.equal(github.requests[0].headers.has("authorization"), false);
    assert.equal(github.requests[0].headers.get("user-agent"), "Codefield");
  });

  it("sends the token as a bearer header when one is set", async () => {
    const github = fakeGitHub({ [ARCHIVE_URL]: () => zipResponse(archive) });
    const result = await loadSourceFiles(repository, [index], {
      fetch: github.fetch,
      token: "secret-token",
    });

    assert.equal(github.requests[0].headers.get("authorization"), "Bearer secret-token");
    assert.equal(github.requests[0].url.includes("secret-token"), false);
    assert.equal(JSON.stringify(result).includes("secret-token"), false);
  });

  it("reports rate limits, rejected tokens and missing archives", async () => {
    const cases: [() => Response, string][] = [
      [() => json({ message: "API rate limit exceeded" }, 403, { "x-ratelimit-remaining": "0" }), "rate_limited"],
      [() => json({ message: "slow down" }, 429, { "retry-after": "30" }), "rate_limited"],
      [() => json({ message: "Bad credentials" }, 401), "unauthorized"],
      [() => json({ message: "Not Found" }, 404), "archive_unavailable"],
      [() => json({ message: "Server Error" }, 502), "upstream_error"],
    ];

    for (const [respond, code] of cases) {
      const github = fakeGitHub({ [ARCHIVE_URL]: respond });
      const result = await loadSourceFiles(repository, [index], { fetch: github.fetch });
      assert.equal(!result.ok && result.error.code, code);
    }
  });

  it("reports network failures before and during the download", async () => {
    const refused: FetchLike = async () => {
      throw new TypeError("fetch failed");
    };
    const interrupted: FetchLike = async () =>
      new Response(
        new ReadableStream({
          start(controller) {
            controller.enqueue(archive.subarray(0, 10));
            controller.error(new Error("socket hang up"));
          },
        }),
      );

    for (const fetch of [refused, interrupted]) {
      const result = await loadSourceFiles(repository, [index], { fetch });
      assert.deepEqual(result, {
        ok: false,
        error: { code: "network_error", message: "Could not reach GitHub." },
      });
    }
  });

  it("rejects an archive whose declared length is over the limit", async () => {
    const github = fakeGitHub({
      [ARCHIVE_URL]: () =>
        new Response(archive, {
          headers: { "content-length": String(MAX_ARCHIVE_BYTES + 1) },
        }),
    });
    const result = await loadSourceFiles(repository, [index], { fetch: github.fetch });

    assert.equal(!result.ok && result.error.code, "archive_too_large");
  });

  it("stops reading an archive that grows past the limit", async () => {
    const chunk = new Uint8Array(1024 * 1024);
    let sent = 0;
    const github = fakeGitHub({
      [ARCHIVE_URL]: () =>
        new Response(
          new ReadableStream({
            pull(controller) {
              sent += chunk.length;
              controller.enqueue(chunk);
            },
          }),
        ),
    });

    const result = await loadSourceFiles(repository, [index], { fetch: github.fetch });

    assert.equal(!result.ok && result.error.code, "archive_too_large");
    assert.ok(sent <= MAX_ARCHIVE_BYTES + 2 * chunk.length);
  });

  it("uses three requests for a full analysis and keeps oversized files skipped", async () => {
    const files: Record<string, string | Uint8Array> = {
      "src/index.ts": "export default 1;\n",
      "src/view.tsx": "export const View = () => null;\n",
      "src/huge.ts": new Uint8Array(600 * 1024).fill(0x61),
      "README.md": "# ms\n",
      "node_modules/pkg/index.js": "module.exports = 1;\n",
    };
    const entries: TreeEntry[] = Object.entries(files).map(([path, content]) => {
      const bytes = toBytes(content);
      return { path, type: "blob", sha: gitBlobSha(bytes), size: bytes.length };
    });

    const github = fakeGitHub({
      "https://api.github.com/repos/vercel/ms": () =>
        json(
          {
            name: "ms",
            full_name: "vercel/ms",
            owner: { login: "vercel" },
            private: false,
            archived: false,
            html_url: "https://github.com/vercel/ms",
            default_branch: "main",
            size: 100,
          },
          200,
        ),
      "https://api.github.com/repos/vercel/ms/git/trees/main?recursive=1": () =>
        json(
          {
            sha: "tree",
            truncated: false,
            tree: entries.map((e) => ({ ...e, mode: "100644" })),
          },
          200,
        ),
      [ARCHIVE_URL]: () => zipResponse(zip(files)),
    });

    const loaded = await loadRepository({ owner: "vercel", repo: "ms" }, { fetch: github.fetch });
    assert.ok(loaded.ok);
    const selection = selectSourceFiles(loaded.data.tree.entries);
    const sources = await loadSourceFiles(loaded.data.metadata, selection.candidates, {
      fetch: github.fetch,
    });

    assert.ok(sources.ok);
    assert.deepEqual(selection.skipped, [{ path: "src/huge.ts", reason: "too_large" }]);
    assert.deepEqual(sources.data.files.map((f) => f.path), ["src/index.ts", "src/view.tsx"]);
    assert.deepEqual(sources.data.skipped, []);
    assert.equal(github.requests.length, 3);
    assert.equal(github.requests.filter((r) => r.url.includes("/git/blobs/")).length, 0);
  });
});
