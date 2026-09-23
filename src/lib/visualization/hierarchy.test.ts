import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { buildDirectoryTree, flattenGroups, type DirectoryGroup } from "./hierarchy.ts";

// Group paths with their direct files, in tree order.
function outline(group: DirectoryGroup): [string, string[]][] {
  return flattenGroups(group).map((g) => [g.path, g.files]);
}

function find(root: DirectoryGroup, path: string): DirectoryGroup {
  const group = flattenGroups(root).find((g) => g.path === path);
  assert.ok(group, `missing group ${path}`);
  return group;
}

describe("buildDirectoryTree", () => {
  it("keeps root-level files in a root group", () => {
    const tree = buildDirectoryTree(["next.config.ts", "eslint.config.js"]);

    assert.equal(tree.path, "");
    assert.deepEqual(tree.files, ["eslint.config.js", "next.config.ts"]);
    assert.deepEqual(tree.children, []);
    assert.equal(tree.fileCount, 2);
  });

  it("uses a single top-level directory as the top group", () => {
    const tree = buildDirectoryTree(["src/a.ts", "src/b.ts"]);

    assert.equal(tree.path, "src");
    assert.deepEqual(tree.files, ["src/a.ts", "src/b.ts"]);
    assert.deepEqual(tree.merged, []);
  });

  it("keeps the root when it has files next to one directory", () => {
    const tree = buildDirectoryTree(["next.config.ts", "src/app/page.tsx", "src/lib/a.ts"]);

    assert.deepEqual(outline(tree), [
      ["", ["next.config.ts"]],
      ["src", []],
      ["src/app", ["src/app/page.tsx"]],
      ["src/lib", ["src/lib/a.ts"]],
    ]);
  });

  it("groups multiple top-level directories under the root", () => {
    const tree = buildDirectoryTree(["lib/a.ts", "app/page.tsx", "components/button.tsx"]);

    assert.equal(tree.path, "");
    assert.deepEqual(
      tree.children.map((child) => child.path),
      ["app", "components", "lib"],
    );
  });

  it("nests directories", () => {
    const tree = buildDirectoryTree([
      "src/index.ts",
      "src/lib/util.ts",
      "src/lib/github/client.ts",
      "src/lib/github/archive.ts",
    ]);

    assert.deepEqual(outline(tree), [
      ["src", ["src/index.ts"]],
      ["src/lib", ["src/lib/util.ts"]],
      ["src/lib/github", ["src/lib/github/archive.ts", "src/lib/github/client.ts"]],
    ]);
    assert.equal(tree.fileCount, 4);
    assert.equal(find(tree, "src/lib").fileCount, 3);
  });

  it("keeps every level of deep directories that branch", () => {
    const paths = ["a/x.ts"];
    let directory = "a";
    for (let depth = 0; depth < 12; depth++) {
      directory = `${directory}/d${depth}`;
      paths.push(`${directory}/f.ts`);
    }
    const tree = buildDirectoryTree(paths);

    assert.equal(flattenGroups(tree).length, 13);
    assert.equal(tree.fileCount, 13);
    assert.deepEqual(flattenGroups(tree).at(-1)!.files, [`${directory}/f.ts`]);
  });

  it("merges single-child directory chains", () => {
    const tree = buildDirectoryTree([
      "src/application/server/internal/thing.ts",
      "src/application/server/internal/other.ts",
      "src/index.ts",
    ]);

    assert.deepEqual(outline(tree), [
      ["src", ["src/index.ts"]],
      [
        "src/application/server/internal",
        ["src/application/server/internal/other.ts", "src/application/server/internal/thing.ts"],
      ],
    ]);
    assert.deepEqual(find(tree, "src/application/server/internal").merged, [
      "src/application",
      "src/application/server",
    ]);
  });

  it("merges a chain that starts at the root", () => {
    const tree = buildDirectoryTree(["packages/core/src/a.ts", "packages/core/src/b.ts"]);

    assert.equal(tree.path, "packages/core/src");
    assert.deepEqual(tree.merged, ["packages", "packages/core"]);
    assert.equal(tree.fileCount, 2);
  });

  it("does not merge a directory that has files of its own", () => {
    const tree = buildDirectoryTree(["src/a.ts", "src/lib/b.ts", "src/lib/c.ts", "x/y.ts"]);

    assert.deepEqual(
      flattenGroups(tree).map((g) => g.path),
      ["", "src", "src/lib", "x"],
    );
  });

  it("keeps sibling directories apart", () => {
    const tree = buildDirectoryTree(["src/a/one.ts", "src/b/two.ts", "src/c/three.ts"]);

    assert.equal(tree.path, "src");
    assert.deepEqual(
      tree.children.map((child) => [child.path, child.files]),
      [
        ["src/a", ["src/a/one.ts"]],
        ["src/b", ["src/b/two.ts"]],
        ["src/c", ["src/c/three.ts"]],
      ],
    );
  });

  it("distinguishes directories with the same name under different parents", () => {
    const tree = buildDirectoryTree([
      "app/utils/a.ts",
      "app/utils/b.ts",
      "lib/utils/a.ts",
      "lib/x.ts",
    ]);

    assert.deepEqual(find(tree, "app/utils").files, ["app/utils/a.ts", "app/utils/b.ts"]);
    assert.deepEqual(find(tree, "lib/utils").files, ["lib/utils/a.ts"]);
  });

  it("splits paths on forward slashes only", () => {
    const tree = buildDirectoryTree(["src\\windows.ts", "src/posix.ts", "src/dir\\name/file.ts"]);

    assert.deepEqual(outline(tree), [
      ["", ["src\\windows.ts"]],
      ["src", ["src/posix.ts"]],
      ["src/dir\\name", ["src/dir\\name/file.ts"]],
    ]);
  });

  it("does not depend on input order", () => {
    const paths = [
      "README.js",
      "src/lib/github/client.ts",
      "src/app/page.tsx",
      "src/lib/a.ts",
      "src/lib/github/archive.ts",
      "src/app/layout.tsx",
      "Z.ts",
      "a.ts",
    ];

    const expected = buildDirectoryTree(paths);
    assert.deepEqual(buildDirectoryTree([...paths].reverse()), expected);
    assert.deepEqual(buildDirectoryTree([...paths].sort()), expected);
    // Code-unit order puts uppercase names first.
    assert.deepEqual(expected.files, ["README.js", "Z.ts", "a.ts"]);
  });

  it("handles no paths", () => {
    const tree = buildDirectoryTree([]);

    assert.deepEqual(tree, { path: "", merged: [], files: [], children: [], fileCount: 0 });
  });
});
