import assert from "node:assert/strict";
import { join, sep, win32 } from "node:path";
import { afterEach, beforeEach, describe, it } from "node:test";

import type { SourceCandidate } from "../source-files.ts";
import { isInside, readSourceFiles, readTextFile } from "./read.ts";
import { temporaryDirectory, trySymlink, writeFiles } from "./testing.ts";

let root: string;
let remove: () => Promise<void>;

beforeEach(async () => {
  ({ path: root, remove } = await temporaryDirectory());
});
afterEach(async () => {
  await remove();
});

function candidate(path: string, size = 0): SourceCandidate {
  return { path, size, extension: ".ts", language: "typescript" };
}

describe("readSourceFiles", () => {
  it("reads selected files and keeps their order", async () => {
    await writeFiles(root, { "a.ts": "a", "dir/b.ts": "b" });

    const result = await readSourceFiles(root, [candidate("a.ts"), candidate("dir/b.ts")]);

    assert.equal(result.ok, true);
    if (!result.ok) return;
    assert.deepEqual(result.files.map((file) => [file.path, file.content]), [["a.ts", "a"], ["dir/b.ts", "b"]]);
  });

  it("skips a file over the per-file limit, even if it grew after it was listed", async () => {
    await writeFiles(root, { "big.ts": "x".repeat(20), "ok.ts": "x" });

    const result = await readSourceFiles(root, [candidate("big.ts", 1), candidate("ok.ts", 1)], { maxFileBytes: 10 });

    assert.equal(result.ok, true);
    if (!result.ok) return;
    assert.deepEqual(result.skipped, [{ path: "big.ts", reason: "too_large" }]);
    assert.deepEqual(result.files.map((file) => file.path), ["ok.ts"]);
  });

  it("skips invalid UTF-8 and strips a byte order mark", async () => {
    await writeFiles(root, { "bad.ts": Uint8Array.from([0xff, 0xfe, 0x00]), "bom.ts": "﻿export {};" });

    const result = await readSourceFiles(root, [candidate("bad.ts"), candidate("bom.ts")]);

    assert.equal(result.ok, true);
    if (!result.ok) return;
    assert.deepEqual(result.skipped, [{ path: "bad.ts", reason: "not_utf8" }]);
    assert.equal(result.files[0].content, "export {};");
  });

  it("reports a file that disappeared as unreadable", async () => {
    const result = await readSourceFiles(root, [candidate("gone.ts")]);

    assert.equal(result.ok, true);
    if (!result.ok) return;
    assert.deepEqual(result.skipped, [{ path: "gone.ts", reason: "unreadable" }]);
  });

  it("stops with a resource error past the memory budget instead of truncating", async () => {
    await writeFiles(root, { "a.ts": "x".repeat(60), "b.ts": "x".repeat(60) });

    const result = await readSourceFiles(root, [candidate("a.ts"), candidate("b.ts")], { maxTotalBytes: 100 });

    assert.deepEqual(result, { ok: false, reason: "resources_exceeded" });
  });

  it("refuses a file swapped for a link that points outside the root", async (t) => {
    const outside = await temporaryDirectory();
    try {
      await writeFiles(outside.path, { "secret.ts": "secret" });
      if (!(await trySymlink(join(outside.path, "secret.ts"), join(root, "a.ts")))) {
        return t.skip("symbolic links are not available");
      }

      const read = await readTextFile(root, "a.ts", 1000);

      assert.deepEqual(read, { ok: false, reason: "symlink" });
    } finally {
      await outside.remove();
    }
  });

  it("refuses a file reached through a linked directory", async (t) => {
    const outside = await temporaryDirectory();
    try {
      await writeFiles(outside.path, { "secret.ts": "secret" });
      if (!(await trySymlink(outside.path, join(root, "linked"), "dir"))) return t.skip("symbolic links are not available");

      const read = await readTextFile(root, "linked/secret.ts", 1000);

      assert.equal(read.ok, false);
    } finally {
      await outside.remove();
    }
  });
});

describe("isInside", () => {
  it("accepts the root and paths below it", () => {
    assert.equal(isInside(root, root), true);
    assert.equal(isInside(root, join(root, "a", "b.ts")), true);
    assert.equal(isInside(root, join(root, "..hidden")), true);
  });

  it("rejects parents, siblings and other roots", () => {
    assert.equal(isInside(root, join(root, "..")), false);
    assert.equal(isInside(root, `${root}-sibling${sep}a.ts`), false);
    assert.equal(isInside(root, join(root, "..", "other", "a.ts")), false);
  });
});

describe("isInside on Windows paths", () => {
  const root = "C:\\Users\\dev\\My Project";

  it("accepts files below the root, whatever the letter case", () => {
    assert.equal(isInside(root, "C:\\Users\\dev\\My Project\\src\\a.ts", win32), true);
    assert.equal(isInside(root, "c:\\users\\DEV\\my project\\src\\a.ts", win32), true);
  });

  it("rejects other drives, parents, siblings and network paths", () => {
    assert.equal(isInside(root, "D:\\Users\\dev\\My Project\\a.ts", win32), false);
    assert.equal(isInside(root, "C:\\Users\\dev\\secret.txt", win32), false);
    assert.equal(isInside(root, "C:\\Users\\dev\\My Project2\\a.ts", win32), false);
    assert.equal(isInside(root, "\\\\server\\share\\a.ts", win32), false);
  });
});
