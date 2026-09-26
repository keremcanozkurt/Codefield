import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import { afterEach, beforeEach, describe, it } from "node:test";

import { discoverRepository, type DiscoveryProgress } from "./discovery.ts";
import { temporaryDirectory, trySymlink, writeFiles } from "./local/testing.ts";
import { MAX_SOURCE_FILE_BYTES } from "./resources.ts";

let root: string;
let remove: () => Promise<void>;

beforeEach(async () => {
  ({ path: root, remove } = await temporaryDirectory());
});
afterEach(async () => {
  await remove();
});

function edgesOf(graph: { edges: { source: string; target: string }[] }) {
  return graph.edges.map((edge) => `${edge.source} -> ${edge.target}`);
}

describe("discoverRepository", () => {
  it("analyzes a local folder into a dependency graph", async () => {
    await writeFiles(root, {
      "src/index.ts": 'import { helper } from "./util";\nexport const x = helper();\n',
      "src/util.ts": "export const helper = () => 1;\n",
      "README.md": "# demo\n",
    });

    const result = await discoverRepository(root);

    assert.equal(result.status, "success");
    if (result.status !== "success") return;
    assert.deepEqual(edgesOf(result.graph), ["src/index.ts -> src/util.ts"]);
    assert.equal(result.repository.fileCount, 3);
    assert.equal(result.skippedCount, 0);
    assert.deepEqual(result.skipped, { tooLarge: 0, symlinks: 0, unreadable: 0, parseFailed: 0, unreadableDirectories: 0 });
  });

  it("names the repository after its folder and never sends the absolute path", async () => {
    await writeFiles(root, { "a.py": "import b\n", "b.py": "" });

    const result = await discoverRepository(root);

    assert.equal(result.status, "success");
    if (result.status !== "success") return;
    assert.equal(result.repository.name, root.split(/[\\/]/).at(-1));
    assert.ok(!JSON.stringify(result).includes(root));
  });

  it("reports an empty folder as empty", async () => {
    assert.equal((await discoverRepository(root)).status, "empty");
  });

  it("reports a folder without supported files as unsupported, with nothing skipped", async () => {
    await writeFiles(root, { "README.md": "# demo", "package.json": "{}" });

    const result = await discoverRepository(root);

    assert.equal(result.status, "unsupported");
    if (result.status !== "unsupported") return;
    assert.equal(result.skippedCount, 0);
  });

  it("counts supported files that are all too large instead of calling them unsupported", async () => {
    await writeFiles(root, { "src/generated.ts": "x".repeat(MAX_SOURCE_FILE_BYTES + 1) });

    const result = await discoverRepository(root);

    assert.equal(result.status, "unsupported");
    if (result.status !== "unsupported") return;
    assert.equal(result.skipped.tooLarge, 1);
    assert.equal(result.skippedCount, 1);
  });

  it("skips files that are not UTF-8 and analyzes the rest", async () => {
    await writeFiles(root, {
      "a.ts": 'import "./b";\n',
      "b.ts": "",
      "latin1.ts": Uint8Array.from([0x2f, 0x2f, 0x20, 0xe9, 0x0a]),
    });

    const result = await discoverRepository(root);

    assert.equal(result.status, "success");
    if (result.status !== "success") return;
    assert.deepEqual(result.graph.nodes.map((node) => node.id), ["a.ts", "b.ts"]);
    assert.equal(result.skipped.unreadable, 1);
  });

  it("leaves out dependency, build and version control directories", async () => {
    await writeFiles(root, {
      "src/a.js": 'require("lodash");\n',
      "node_modules/lodash/index.js": "",
      "dist/bundle.js": "",
      ".git/hooks/pre-commit.py": "",
    });

    const result = await discoverRepository(root);

    assert.equal(result.status, "success");
    if (result.status !== "success") return;
    assert.deepEqual(result.graph.nodes.map((node) => node.id), ["src/a.js"]);
  });

  it("analyzes every file, with no cap on the number of files", async () => {
    const files: Record<string, string> = {};
    for (let i = 0; i < 1500; i++) files[`src/m${i}.ts`] = i === 0 ? "" : `import "./m${i - 1}";\n`;
    await writeFiles(root, files);

    const result = await discoverRepository(root);

    assert.equal(result.status, "success");
    if (result.status !== "success") return;
    assert.equal(result.graph.nodes.length, 1500);
    assert.equal(result.graph.edges.length, 1499);
  });

  it("does not follow symbolic links, and reports linked source files", async (t) => {
    const outside = await temporaryDirectory();
    try {
      await writeFiles(outside.path, { "secret.ts": "export const secret = 1;\n" });
      await writeFiles(root, { "a.ts": "" });
      const linkedFile = await trySymlink(join(outside.path, "secret.ts"), join(root, "linked.ts"));
      const linkedDir = await trySymlink(outside.path, join(root, "outside"), "dir");
      if (!linkedFile || !linkedDir) return t.skip("symbolic links are not available");

      const result = await discoverRepository(root);

      assert.equal(result.status, "success");
      if (result.status !== "success") return;
      assert.deepEqual(result.graph.nodes.map((node) => node.id), ["a.ts"]);
      assert.equal(result.skipped.symlinks, 1);
    } finally {
      await outside.remove();
    }
  });

  it("survives a symbolic link loop", async (t) => {
    await writeFiles(root, { "src/a.ts": "" });
    if (!(await trySymlink(root, join(root, "src/loop"), "dir"))) return t.skip("symbolic links are not available");

    const result = await discoverRepository(root);

    assert.equal(result.status, "success");
  });

  it("reports progress through each stage with real counts", async () => {
    await writeFiles(root, { "a.go": "package a\n", "b.go": "package a\n" });
    const stages: DiscoveryProgress[] = [];

    await discoverRepository(root, { onProgress: (progress) => stages.push(progress) });

    assert.deepEqual([...new Set(stages.map((progress) => progress.stage))], ["discover", "read", "analysis", "graph"]);
    assert.deepEqual(stages.at(-1), { stage: "graph", files: 2 });
  });

  it("stops when aborted", async () => {
    await writeFiles(root, { "a.ts": "" });
    const controller = new AbortController();
    controller.abort();

    await assert.rejects(discoverRepository(root, { signal: controller.signal }));
  });

  it("reports a missing folder and a file as errors", async () => {
    const missing = await discoverRepository(join(root, "missing"));
    assert.equal(missing.status, "error");

    await writeFiles(root, { "file.ts": "" });
    const file = await discoverRepository(join(root, "file.ts"));
    assert.equal(file.status, "error");
    if (file.status !== "error") return;
    assert.equal(file.error.title, "Not a folder");
  });

  it("reads the branch and origin from the Git metadata, without credentials", async () => {
    await writeFiles(root, {
      "a.rs": "",
      ".git/HEAD": "ref: refs/heads/feature/local\n",
      ".git/config": '[core]\n\tbare = false\n[remote "origin"]\n\turl = https://user:secret-token@git.example.com/team/project.git\n',
    });

    const result = await discoverRepository(root);

    assert.equal(result.status, "success");
    if (result.status !== "success") return;
    assert.equal(result.repository.branch, "feature/local");
    assert.equal(result.repository.remote, "git.example.com/team/project");
    assert.ok(!JSON.stringify(result).includes("secret-token"));
  });

  it("analyzes a folder that is not a Git repository", async () => {
    await mkdir(join(root, "plain"));
    await writeFiles(root, { "plain/main.c": '#include "util.h"\n', "plain/util.h": "" });

    const result = await discoverRepository(join(root, "plain"));

    assert.equal(result.status, "success");
    if (result.status !== "success") return;
    assert.equal(result.repository.remote, null);
    assert.deepEqual(edgesOf(result.graph), ["main.c -> util.h"]);
  });
});
