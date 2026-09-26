import assert from "node:assert/strict";
import { join } from "node:path";
import { afterEach, beforeEach, describe, it } from "node:test";

import { temporaryDirectory, trySymlink, writeFiles } from "./testing.ts";
import { listRepository } from "./walk.ts";

let root: string;
let remove: () => Promise<void>;

beforeEach(async () => {
  ({ path: root, remove } = await temporaryDirectory());
});
afterEach(async () => {
  await remove();
});

describe("listRepository", () => {
  it("lists nested files by repository-relative path with forward slashes, sorted", async () => {
    await writeFiles(root, { "b.ts": "b", "src/deep/nested/a.py": "aa", "src/c.md": "ccc" });

    const listing = await listRepository(root);

    assert.deepEqual(listing.files, [
      { path: "b.ts", size: 1 },
      { path: "src/c.md", size: 0 },
      { path: "src/deep/nested/a.py", size: 2 },
    ]);
  });

  it("reads sizes only for source and configuration files", async () => {
    await writeFiles(root, { "tsconfig.json": "{}", "image.png": "xxxx", "go.mod": "module x\n" });

    const sizes = Object.fromEntries((await listRepository(root)).files.map((file) => [file.path, file.size]));

    assert.deepEqual(sizes, { "go.mod": 9, "image.png": 0, "tsconfig.json": 2 });
  });

  it("does not descend into ignored directories", async () => {
    await writeFiles(root, {
      "node_modules/pkg/index.js": "",
      ".git/objects/ab/cdef": "",
      "target/debug/build.rs": "",
      "src/pkg.egg-info/x.py": "",
      "src/main.rs": "",
    });

    assert.deepEqual((await listRepository(root)).files.map((file) => file.path), ["src/main.rs"]);
  });

  it("keeps bin, which often holds hand-written scripts, and ignores build output", async () => {
    await writeFiles(root, { "bin/tool.rb": "", "lib/build/x.py": "" });

    assert.deepEqual((await listRepository(root)).files.map((file) => file.path), ["bin/tool.rb"]);
  });

  it("never follows a symbolic link out of the root", async (t) => {
    const outside = await temporaryDirectory();
    try {
      await writeFiles(outside.path, { "private/key.ts": "secret" });
      if (!(await trySymlink(outside.path, join(root, "escape"), "dir"))) return t.skip("symbolic links are not available");
      await writeFiles(root, { "a.ts": "" });

      const listing = await listRepository(root);

      assert.deepEqual(listing.files.map((file) => file.path), ["a.ts"]);
      assert.deepEqual(listing.skipped, []);
    } finally {
      await outside.remove();
    }
  });

  it("reports symbolic links to source files and does not loop", async (t) => {
    await writeFiles(root, { "src/a.ts": "" });
    const linked = await trySymlink(join(root, "src/a.ts"), join(root, "src/alias.ts"));
    const loop = await trySymlink(root, join(root, "src/self"), "dir");
    if (!linked || !loop) return t.skip("symbolic links are not available");

    const listing = await listRepository(root);

    assert.deepEqual(listing.files.map((file) => file.path), ["src/a.ts"]);
    assert.deepEqual(listing.skipped, [{ path: "src/alias.ts", reason: "symlink" }]);
  });

  it("counts a directory it cannot read instead of failing", async () => {
    const listing = await listRepository(join(root, "does-not-exist"));

    assert.deepEqual(listing.files, []);
    assert.equal(listing.unreadableDirectories, 1);
  });

  it("stops when aborted", async () => {
    const controller = new AbortController();
    controller.abort();
    await assert.rejects(listRepository(root, { signal: controller.signal }));
  });
});
