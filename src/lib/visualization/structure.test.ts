import assert from "node:assert/strict";
import { describe, it } from "node:test";

import type { LanguageId } from "../languages/registry.ts";
import {
  ancestorPaths,
  buildStructureTree,
  canonicalFocus,
  chainEnd,
  childSteps,
  nearestDirectory,
  survivingFocus,
  trail,
  visibleFileCounts,
  type StructureTree,
} from "./structure.ts";
import type { RenderGraph } from "./types.ts";

const LANGUAGES: Record<string, LanguageId> = { ts: "typescript", py: "python", rs: "rust", go: "go" };

function graphOf(paths: string[], edges: [string, string][] = []): RenderGraph {
  return {
    nodes: paths.map((path) => {
      const slash = path.lastIndexOf("/");
      return {
        id: path,
        path,
        directory: slash === -1 ? "" : path.slice(0, slash),
        language: LANGUAGES[path.slice(path.lastIndexOf(".") + 1)],
        size: 10,
        incoming: 0,
        outgoing: 0,
        degree: 0,
      };
    }),
    edges: edges.map(([source, target]) => ({ id: `${source}->${target}`, source, target, weight: 1, kinds: ["import"] })),
  };
}

function directory(tree: StructureTree, path: string) {
  const found = tree.directories.get(path);
  assert.ok(found, `missing directory ${JSON.stringify(path)}`);
  return found;
}

describe("buildStructureTree", () => {
  it("builds a root with its files when everything is at the top level", () => {
    const tree = buildStructureTree(graphOf(["b.ts", "a.ts"]));

    assert.deepEqual([...tree.directories.keys()], [""]);
    assert.deepEqual(directory(tree, "").files, ["a.ts", "b.ts"]);
    assert.equal(directory(tree, "").fileCount, 2);
    assert.equal(directory(tree, "").parent, null);
  });

  it("nests directories and keeps files and subdirectories apart, sorted", () => {
    const tree = buildStructureTree(graphOf(["src/lib/z.ts", "src/app/page.ts", "src/index.ts", "README.py"]));

    assert.deepEqual(directory(tree, "").directories, ["src"]);
    assert.deepEqual(directory(tree, "").files, ["README.py"]);
    assert.deepEqual(directory(tree, "src").directories, ["src/app", "src/lib"]);
    assert.deepEqual(directory(tree, "src").files, ["src/index.ts"]);
    assert.equal(directory(tree, "src/lib").name, "lib");
    assert.equal(directory(tree, "src/lib").parent, "src");
    assert.equal(directory(tree, "src").fileCount, 3);
    assert.equal(directory(tree, "").fileCount, 4);
  });

  it("does not confuse directories that share a prefix", () => {
    const tree = buildStructureTree(
      graphOf(["src/lib/a.ts", "src/library/b.ts", "src/lib.ts"], [["src/lib/a.ts", "src/library/b.ts"]]),
    );

    assert.deepEqual(directory(tree, "src").directories, ["src/lib", "src/library"]);
    assert.deepEqual(directory(tree, "src").files, ["src/lib.ts"]);
    assert.equal(directory(tree, "src/lib").fileCount, 1);
    assert.equal(directory(tree, "src/lib").internalEdges, 0);
    assert.equal(directory(tree, "src").internalEdges, 1);
  });

  it("preserves case and treats backslashes as part of a name", () => {
    const tree = buildStructureTree(graphOf(["Src/App.ts", "src/app.ts", "weird\\name.ts"]));

    assert.deepEqual(directory(tree, "").directories, ["Src", "src"]);
    assert.deepEqual(directory(tree, "").files, ["weird\\name.ts"]);
  });

  it("counts languages below each directory, most files first", () => {
    const tree = buildStructureTree(graphOf(["x/a.py", "x/b.py", "x/y/c.rs", "x/y/d.ts"]));

    assert.deepEqual(directory(tree, "x").languages, [
      { language: "python", files: 2 },
      { language: "typescript", files: 1 },
      { language: "rust", files: 1 },
    ]);
  });

  it("counts an edge in every directory that contains both of its files", () => {
    const tree = buildStructureTree(
      graphOf(["a/b/one.ts", "a/b/two.ts", "a/c/three.ts", "top.ts"], [
        ["a/b/one.ts", "a/b/two.ts"],
        ["a/b/one.ts", "a/c/three.ts"],
        ["top.ts", "a/c/three.ts"],
      ]),
    );

    assert.equal(directory(tree, "a/b").internalEdges, 1);
    assert.equal(directory(tree, "a/c").internalEdges, 0);
    assert.equal(directory(tree, "a").internalEdges, 2);
    assert.equal(directory(tree, "").internalEdges, 3);
  });

  it("gives the same result whatever order the files arrive in", () => {
    const paths = ["m/z.ts", "a/b.ts", "m/a/c.ts", "b.ts", "a/a.ts"];
    const first = buildStructureTree(graphOf(paths));
    const second = buildStructureTree(graphOf([...paths].reverse()));

    assert.deepEqual([...first.directories.entries()].sort(), [...second.directories.entries()].sort());
  });

  it("handles deep paths and large repositories", () => {
    const deep = "a/b/c/d/e/f/g/h/i/j/k/l/file.ts";
    const paths = [deep];
    for (let i = 0; i < 12_000; i++) paths.push(`pkg${i % 40}/mod${i % 7}/file${i}.ts`);
    const tree = buildStructureTree(graphOf(paths));

    assert.equal(directory(tree, "").fileCount, 12_001);
    assert.equal(directory(tree, "a/b/c/d/e/f/g/h/i/j/k/l").files.length, 1);
    assert.equal(directory(tree, "pkg0").directories.length, 7);
  });
});

describe("path helpers", () => {
  it("lists ancestors from the root down", () => {
    assert.deepEqual(ancestorPaths("src/lib/visualization"), ["", "src", "src/lib", "src/lib/visualization"]);
    assert.deepEqual(ancestorPaths(""), [""]);
  });
});

describe("navigation", () => {
  const tree = buildStructureTree(
    graphOf([
      "README.py",
      "src/index.ts",
      "src/lib/visualization/path.ts",
      "src/lib/visualization/impact.ts",
      "src/lib/local/walk.ts",
      "app/src/main/java/com/acme/App.go",
      "app/src/main/java/com/acme/util/Strings.go",
      "app/build.go",
    ]),
  );

  it("reveals the directory of a file and climbs to the nearest survivor", () => {
    assert.equal(nearestDirectory(tree, "src/lib/visualization"), "src/lib/visualization");
    assert.equal(nearestDirectory(tree, "src/lib/removed/deeper"), "src/lib");
    assert.equal(nearestDirectory(tree, "gone"), "");
  });

  it("climbs out of a deleted directory instead of jumping sideways", () => {
    const next = buildStructureTree(graphOf(["src/lib/local/walk.ts", "src/index.ts"]));

    assert.equal(survivingFocus(next, "src/lib/visualization"), "src");
    assert.equal(survivingFocus(next, "src/lib/local"), "src/lib/local");
  });

  it("passes through directories that only hold one directory", () => {
    assert.equal(chainEnd(tree, "app/src"), "app/src/main/java/com/acme");
    assert.equal(canonicalFocus(tree, "app/src/main"), "app/src/main/java/com/acme");
    assert.equal(canonicalFocus(tree, "src/lib"), "src/lib");
    assert.equal(canonicalFocus(tree, ""), "");
  });

  it("shows subdirectories as steps to the end of each chain", () => {
    assert.deepEqual(childSteps(tree, "app"), [{ path: "app/src/main/java/com/acme", label: "src/main/java/com/acme" }]);
    assert.deepEqual(childSteps(tree, "src/lib"), [
      { path: "src/lib/local", label: "local" },
      { path: "src/lib/visualization", label: "visualization" },
    ]);
  });

  it("builds a breadcrumb trail that groups pass-through directories", () => {
    assert.deepEqual(trail(tree, "src/lib/visualization"), [
      { path: "", label: "" },
      { path: "src", label: "src" },
      { path: "src/lib", label: "lib" },
      { path: "src/lib/visualization", label: "visualization" },
    ]);
    assert.deepEqual(trail(tree, "app/src/main/java/com/acme/util"), [
      { path: "", label: "" },
      { path: "app", label: "app" },
      { path: "app/src/main/java/com/acme", label: "src/main/java/com/acme" },
      { path: "app/src/main/java/com/acme/util", label: "util" },
    ]);
    assert.deepEqual(trail(tree, ""), [{ path: "", label: "" }]);
  });
});

describe("visibleFileCounts", () => {
  const tree = buildStructureTree(graphOf(["a/x.ts", "a/y.py", "b/z.py"]));

  it("is null without active filters", () => {
    assert.equal(visibleFileCounts(tree, null), null);
  });

  it("counts visible files below every directory and keeps empty directories", () => {
    const counts = visibleFileCounts(tree, new Set(["a/y.py", "b/z.py"]))!;

    assert.equal(counts.get(""), 2);
    assert.equal(counts.get("a"), 1);
    assert.equal(counts.get("b"), 1);

    const none = visibleFileCounts(tree, new Set())!;
    assert.equal(none.get("a"), 0);
    assert.ok(tree.directories.has("a"));
  });
});
