import assert from "node:assert/strict";
import { describe, it } from "node:test";

import type { ReferenceKind } from "../analysis/imports.ts";
import { edgeId } from "../graph/build.ts";
import {
  buildGraphIndex,
  describeFile,
  formatBytes,
  kindName,
  languageName,
  neighborhood,
  searchFiles,
  selectionFor,
  SEARCH_LIMIT,
} from "./inspection.ts";
import type { RenderEdge, RenderGraph, RenderNode } from "./types.ts";

function node(path: string, size = 1_000): RenderNode {
  const slash = path.lastIndexOf("/");
  return {
    id: path,
    path,
    directory: slash === -1 ? "" : path.slice(0, slash),
    language: /\.tsx?$/.test(path) ? "typescript" : "javascript",
    size,
    incoming: 0,
    outgoing: 0,
    degree: 0,
  };
}

function edge(source: string, target: string, kinds: ReferenceKind[] = ["import"]): RenderEdge {
  return { id: edgeId(source, target), source, target, weight: kinds.length, kinds };
}

// Sets edge counts on nodes the way the dependency graph does.
function graphOf(nodes: RenderNode[], edges: RenderEdge[] = []): RenderGraph {
  const count = (id: string, key: "source" | "target") => edges.filter((e) => e[key] === id).length;
  return {
    nodes: nodes.map((n) => {
      const outgoing = count(n.id, "source");
      const incoming = count(n.id, "target");
      return { ...n, outgoing, incoming, degree: outgoing + incoming };
    }),
    edges,
  };
}

// app/page imports lib/github/client and lib/utils, which import each other;
// lib/github/archive re-exports client; README.js stands alone.
function sample(): RenderGraph {
  return graphOf(
    [
      node("src/app/page.tsx", 2_400),
      node("src/lib/github/client.ts", 6_300),
      node("src/lib/github/archive.ts", 842),
      node("src/lib/utils.ts", 130_000),
      node("README.js", 10),
    ],
    [
      edge("src/app/page.tsx", "src/lib/github/client.ts"),
      edge("src/app/page.tsx", "src/lib/utils.ts"),
      edge("src/lib/github/client.ts", "src/lib/utils.ts"),
      edge("src/lib/utils.ts", "src/lib/github/client.ts", ["dynamic_import"]),
      edge("src/lib/github/archive.ts", "src/lib/github/client.ts", ["import", "reexport"]),
    ],
  );
}

const ids = (relations: { id: string }[] | undefined) => relations?.map((r) => r.id);

describe("buildGraphIndex", () => {
  it("lists the files each file references", () => {
    const index = buildGraphIndex(sample());

    assert.deepEqual(ids(index.outgoing.get("src/app/page.tsx")), [
      "src/lib/github/client.ts",
      "src/lib/utils.ts",
    ]);
    assert.deepEqual(ids(index.outgoing.get("src/lib/github/archive.ts")), ["src/lib/github/client.ts"]);
  });

  it("lists the files that reference each file", () => {
    const index = buildGraphIndex(sample());

    assert.deepEqual(ids(index.incoming.get("src/lib/github/client.ts")), [
      "src/app/page.tsx",
      "src/lib/github/archive.ts",
      "src/lib/utils.ts",
    ]);
    assert.deepEqual(ids(index.incoming.get("src/app/page.tsx")), []);
  });

  it("keeps both directions of a pair of files that reference each other", () => {
    const index = buildGraphIndex(sample());

    assert.deepEqual(ids(index.outgoing.get("src/lib/utils.ts")), ["src/lib/github/client.ts"]);
    assert.deepEqual(ids(index.incoming.get("src/lib/utils.ts")), [
      "src/app/page.tsx",
      "src/lib/github/client.ts",
    ]);
    assert.deepEqual(index.outgoing.get("src/lib/utils.ts")![0].kinds, ["dynamic_import"]);
    assert.deepEqual(index.incoming.get("src/lib/utils.ts")![1].kinds, ["import"]);
  });

  it("handles longer cycles", () => {
    const index = buildGraphIndex(
      graphOf([node("a.ts"), node("b.ts"), node("c.ts")], [edge("a.ts", "b.ts"), edge("b.ts", "c.ts"), edge("c.ts", "a.ts")]),
    );

    for (const [id, next, previous] of [["a.ts", "b.ts", "c.ts"], ["b.ts", "c.ts", "a.ts"], ["c.ts", "a.ts", "b.ts"]]) {
      assert.deepEqual(ids(index.outgoing.get(id)), [next]);
      assert.deepEqual(ids(index.incoming.get(id)), [previous]);
    }
  });

  it("gives isolated files empty lists", () => {
    const index = buildGraphIndex(sample());

    assert.deepEqual(index.outgoing.get("README.js"), []);
    assert.deepEqual(index.incoming.get("README.js"), []);
  });

  it("orders related files by path regardless of input order", () => {
    const graph = sample();
    const reversed = { nodes: [...graph.nodes].reverse(), edges: [...graph.edges].reverse() };

    assert.deepEqual(buildGraphIndex(reversed), buildGraphIndex(graph));
    assert.deepEqual(
      buildGraphIndex(graph).entries.map((e) => e.path),
      ["README.js", "src/app/page.tsx", "src/lib/github/archive.ts", "src/lib/github/client.ts", "src/lib/utils.ts"],
    );
  });

  it("lists a file once when the same pair appears in several edges", () => {
    const graph = sample();
    graph.edges.push({ ...edge("src/app/page.tsx", "src/lib/utils.ts", ["require"]), id: "duplicate" });
    const index = buildGraphIndex(graph);

    assert.deepEqual(ids(index.outgoing.get("src/app/page.tsx")), ["src/lib/github/client.ts", "src/lib/utils.ts"]);
    assert.deepEqual(index.outgoing.get("src/app/page.tsx")![1].kinds, ["import", "require"]);
    assert.deepEqual(ids(index.incoming.get("src/lib/utils.ts")), ["src/app/page.tsx", "src/lib/github/client.ts"]);
  });

  it("ignores self loops and edges to unknown files", () => {
    const graph = graphOf([node("a.ts"), node("b.ts")], [edge("a.ts", "a.ts"), edge("a.ts", "missing.ts"), edge("a.ts", "b.ts")]);
    const index = buildGraphIndex(graph);

    assert.deepEqual(ids(index.outgoing.get("a.ts")), ["b.ts"]);
    assert.deepEqual(ids(index.incoming.get("a.ts")), []);
    assert.ok(!index.nodeById.has("missing.ts"));
  });

  it("does not modify the graph", () => {
    const graph = sample();
    const copy = structuredClone(graph);

    buildGraphIndex(graph);
    assert.deepEqual(graph, copy);
  });
});

describe("searchFiles", () => {
  const index = buildGraphIndex(sample());
  const paths = (query: string, limit?: number) => searchFiles(index, query, limit).map((r) => r.path);

  it("matches file names", () => {
    assert.deepEqual(paths("archive"), ["src/lib/github/archive.ts"]);
  });

  it("matches full paths", () => {
    assert.deepEqual(paths("github/archive"), ["src/lib/github/archive.ts"]);
    assert.deepEqual(paths("src/app/page.tsx"), ["src/app/page.tsx"]);
  });

  it("ignores case and surrounding whitespace", () => {
    assert.deepEqual(paths("  ARCHIVE.TS "), ["src/lib/github/archive.ts"]);
    assert.deepEqual(paths("Github/"), ["src/lib/github/client.ts", "src/lib/github/archive.ts"]);
  });

  it("matches parts of names and paths", () => {
    assert.deepEqual(paths("li"), ["src/lib/github/client.ts", "src/lib/utils.ts", "src/lib/github/archive.ts"]);
    assert.deepEqual(paths("github/arch"), ["src/lib/github/archive.ts"]);
    // ".tsx" contains ".ts" too.
    assert.deepEqual(paths(".ts"), [
      "src/app/page.tsx",
      "src/lib/utils.ts",
      "src/lib/github/client.ts",
      "src/lib/github/archive.ts",
    ]);
  });

  it("returns nothing for no match or an empty query", () => {
    assert.deepEqual(paths("constellation.tsx"), []);
    assert.deepEqual(paths(""), []);
    assert.deepEqual(paths("   "), []);
  });

  it("ranks exact names, then name prefixes, then names, then paths, shorter names first", () => {
    const ranked = buildGraphIndex(
      graphOf([
        node("src/client/index.ts"),
        node("src/api-client.ts"),
        node("src/client.ts"),
        node("lib/client.test.ts"),
        node("src/client"),
      ]),
    );

    assert.deepEqual(
      searchFiles(ranked, "client").map((r) => r.path),
      ["src/client", "src/client.ts", "lib/client.test.ts", "src/api-client.ts", "src/client/index.ts"],
    );
  });

  it("prefers the shorter of two names that match equally", () => {
    const pair = buildGraphIndex(graphOf([node("src/archive.test.ts"), node("src/archive.ts")]));

    assert.deepEqual(
      searchFiles(pair, "src/arch").map((r) => r.path),
      ["src/archive.ts", "src/archive.test.ts"],
    );
  });

  it("orders matches of the same rank by path, independent of input order", () => {
    const graph = graphOf(Array.from({ length: 12 }, (_, i) => node(`src/m${(i * 7) % 12}/util.ts`)));
    const forward = searchFiles(buildGraphIndex(graph), "util");
    const reversed = searchFiles(buildGraphIndex({ ...graph, nodes: [...graph.nodes].reverse() }), "util");

    assert.deepEqual(reversed, forward);
    assert.deepEqual(
      forward.map((r) => r.path),
      [...forward.map((r) => r.path)].sort(),
    );
  });

  it("returns at most the limit", () => {
    const many = buildGraphIndex(graphOf(Array.from({ length: 30 }, (_, i) => node(`src/file-${i}.ts`))));

    assert.equal(searchFiles(many, "file").length, SEARCH_LIMIT);
    assert.equal(searchFiles(many, "file", 3).length, 3);
    assert.equal(searchFiles(many, "file", 0).length, 0);
  });

  it("returns the IDs and names needed to select a result", () => {
    const [result] = searchFiles(index, "client");

    assert.deepEqual(result, {
      id: "src/lib/github/client.ts",
      path: "src/lib/github/client.ts",
      name: "client.ts",
      directory: "src/lib/github",
    });
    assert.equal(neighborhood(index, result.id)!.selected, "src/lib/github/client.ts");
  });
});

describe("selection", () => {
  const index = buildGraphIndex(sample());

  it("identifies the selected file and its direct neighbours by direction", () => {
    const focus = neighborhood(index, "src/lib/github/client.ts")!;

    assert.equal(focus.selected, "src/lib/github/client.ts");
    assert.deepEqual([...focus.outgoing], ["src/lib/utils.ts"]);
    assert.deepEqual([...focus.incoming], ["src/app/page.tsx", "src/lib/github/archive.ts", "src/lib/utils.ts"]);
    assert.deepEqual(
      [...focus.neighbors].sort(),
      ["src/app/page.tsx", "src/lib/github/archive.ts", "src/lib/utils.ts"],
    );
  });

  it("leaves unrelated files and files two edges away out", () => {
    const focus = neighborhood(index, "src/lib/github/archive.ts")!;

    // page.tsx and utils.ts are reachable only through client.ts.
    assert.deepEqual([...focus.neighbors], ["src/lib/github/client.ts"]);
    assert.ok(!focus.neighbors.has("src/app/page.tsx"));
    assert.ok(!focus.neighbors.has("src/lib/utils.ts"));
    assert.ok(!focus.neighbors.has("README.js"));
    assert.ok(!focus.neighbors.has(focus.selected));
  });

  it("selects an isolated file without neighbours", () => {
    const focus = neighborhood(index, "README.js")!;

    assert.equal(focus.selected, "README.js");
    assert.equal(focus.neighbors.size, 0);
  });

  it("clears the selection", () => {
    assert.equal(neighborhood(index, null), null);
    assert.equal(selectionFor(index, null), null);
  });

  it("replaces one selection with the next", () => {
    const first = neighborhood(index, "src/app/page.tsx")!;
    const second = neighborhood(index, "README.js")!;

    assert.equal(first.selected, "src/app/page.tsx");
    assert.equal(second.selected, "README.js");
    assert.equal(second.neighbors.size, 0);
  });

  it("drops a selection that is not in the current graph", () => {
    const next = buildGraphIndex(graphOf([node("src/other.ts")]));

    assert.equal(selectionFor(next, "src/app/page.tsx"), null);
    assert.equal(neighborhood(next, "src/app/page.tsx"), null);
    assert.equal(describeFile(next, "src/app/page.tsx"), null);
    assert.equal(selectionFor(next, "src/other.ts"), "src/other.ts");
  });

  it("never selects anything in an empty graph", () => {
    const empty = buildGraphIndex({ nodes: [], edges: [] });

    assert.equal(selectionFor(empty, ""), null);
    assert.equal(neighborhood(empty, "a.ts"), null);
    assert.deepEqual(searchFiles(empty, "a"), []);
  });
});

describe("describeFile", () => {
  const index = buildGraphIndex(sample());

  it("describes the selected file", () => {
    const details = describeFile(index, "src/lib/github/client.ts")!;

    assert.equal(details.name, "client.ts");
    assert.equal(details.path, "src/lib/github/client.ts");
    assert.equal(details.directory, "src/lib/github");
    assert.equal(details.language, "TypeScript");
    assert.equal(details.size, "6.2 KB");
    assert.equal(details.outgoing, 1);
    assert.equal(details.incoming, 3);
    assert.equal(details.degree, 4);
  });

  it("lists referenced and referencing files with their kinds", () => {
    const details = describeFile(index, "src/lib/github/client.ts")!;

    assert.deepEqual(details.references, [
      { id: "src/lib/utils.ts", name: "utils.ts", directory: "src/lib", kinds: ["import"] },
    ]);
    assert.deepEqual(details.referencedBy, [
      { id: "src/app/page.tsx", name: "page.tsx", directory: "src/app", kinds: ["import"] },
      { id: "src/lib/github/archive.ts", name: "archive.ts", directory: "src/lib/github", kinds: ["import", "reexport"] },
      { id: "src/lib/utils.ts", name: "utils.ts", directory: "src/lib", kinds: ["dynamic_import"] },
    ]);
  });

  it("keeps counts and lists consistent", () => {
    for (const n of sample().nodes) {
      const details = describeFile(index, n.id)!;
      assert.equal(details.references.length, details.outgoing, n.id);
      assert.equal(details.referencedBy.length, details.incoming, n.id);
      assert.equal(details.degree, details.outgoing + details.incoming, n.id);
    }
  });

  it("describes root-level and JavaScript files", () => {
    const details = describeFile(index, "README.js")!;

    assert.equal(details.name, "README.js");
    assert.equal(details.directory, "");
    assert.equal(details.language, "JavaScript");
    assert.equal(details.size, "10 B");
    assert.deepEqual(details.references, []);
    assert.deepEqual(details.referencedBy, []);
  });
});

describe("formatting", () => {
  it("formats byte counts", () => {
    assert.equal(formatBytes(0), "0 B");
    assert.equal(formatBytes(842), "842 B");
    assert.equal(formatBytes(1023), "1023 B");
    assert.equal(formatBytes(1024), "1.0 KB");
    assert.equal(formatBytes(3_482), "3.4 KB");
    assert.equal(formatBytes(10_188), "9.9 KB");
    assert.equal(formatBytes(10_230), "10 KB");
    assert.equal(formatBytes(130_000), "127 KB");
    assert.equal(formatBytes(1_048_000), "1023 KB");
    assert.equal(formatBytes(1_048_500), "1.0 MB");
    assert.equal(formatBytes(52_428_800), "50 MB");
  });

  it("handles values that are not byte counts", () => {
    assert.equal(formatBytes(-1), "0 B");
    assert.equal(formatBytes(Number.NaN), "0 B");
    assert.equal(formatBytes(Number.POSITIVE_INFINITY), "0 B");
  });

  it("names languages and relationship kinds", () => {
    assert.equal(languageName("typescript"), "TypeScript");
    assert.equal(languageName("javascript"), "JavaScript");
    assert.deepEqual(
      (["import", "reexport", "dynamic_import", "require"] as const).map(kindName),
      ["import", "re-export", "dynamic import", "require"],
    );
  });
});
