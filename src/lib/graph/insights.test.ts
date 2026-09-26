import assert from "node:assert/strict";
import { describe, it } from "node:test";

import type { ReferenceKind } from "../analysis/imports.ts";
import type { ModuleRelationship } from "../analysis/relationships.ts";
import type { SourceExtension, SourceFile } from "../source-files.ts";
import { buildGraphIndex, describeFile, neighborhood, searchFiles, selectionFor } from "../visualization/inspection.ts";
import { toRenderGraph } from "../visualization/payload.ts";
import { buildDependencyGraph } from "./build.ts";
import { deriveRepositoryInsights, directoryHighlights, fileHighlights, languageBreakdown, type InsightGraph } from "./insights.ts";

function file(path: string, size = 100): Pick<SourceFile, "path" | "extension" | "language" | "size"> {
  const extension = path.slice(path.lastIndexOf(".")) as SourceExtension;
  return {
    path,
    extension,
    size,
    language: extension === ".ts" || extension === ".tsx" ? "typescript" : "javascript",
  };
}

function rel(sourcePath: string, targetPath: string, kind: ReferenceKind = "import", specifier = `./${targetPath}`): ModuleRelationship {
  return { sourcePath, targetPath, kind, specifier };
}

// src/lib/utils.ts is imported by four files; src/app/page.tsx imports three;
// src/lib/github/client.ts and src/lib/github/archive.ts import each other;
// README.js and scripts/build.js are isolated.
function sample() {
  return buildDependencyGraph(
    [
      file("src/app/page.tsx", 3_000),
      file("src/app/layout.tsx", 1_200),
      file("src/lib/utils.ts", 500),
      file("src/lib/github/client.ts", 9_000),
      file("src/lib/github/archive.ts", 14_000),
      file("README.js", 40),
      file("scripts/build.js", 2_000),
    ],
    [
      rel("src/app/page.tsx", "src/lib/utils.ts"),
      rel("src/app/page.tsx", "src/lib/github/client.ts"),
      rel("src/app/page.tsx", "src/app/layout.tsx"),
      rel("src/app/layout.tsx", "src/lib/utils.ts"),
      rel("src/lib/github/client.ts", "src/lib/utils.ts"),
      rel("src/lib/github/archive.ts", "src/lib/utils.ts"),
      rel("src/lib/github/client.ts", "src/lib/github/archive.ts"),
      rel("src/lib/github/archive.ts", "src/lib/github/client.ts"),
    ],
  );
}

function shuffled<T>(items: readonly T[], seed: number): T[] {
  const result = [...items];
  let state = seed;
  for (let i = result.length - 1; i > 0; i--) {
    state = (state * 1103515245 + 12345) % 2147483648;
    const j = state % (i + 1);
    [result[i], result[j]] = [result[j], result[i]];
  }
  return result;
}

const pathOf = (fact: { file: { path: string } } | null) => fact?.file.path ?? null;

describe("file insights", () => {
  const insights = deriveRepositoryInsights(sample());

  it("finds the most referenced file", () => {
    assert.equal(pathOf(insights.files.mostReferenced), "src/lib/utils.ts");
    assert.equal(insights.files.mostReferenced!.value, 4);
    assert.equal(insights.files.mostReferenced!.ties, 0);
  });

  it("finds the file with the most outgoing edges", () => {
    assert.equal(pathOf(insights.files.mostOutgoing), "src/app/page.tsx");
    assert.equal(insights.files.mostOutgoing!.value, 3);
  });

  it("finds the file with the highest degree", () => {
    // utils.ts: 4 incoming. client.ts: 2 out + 2 in. page.tsx: 3 out.
    assert.equal(pathOf(insights.files.highestDegree), "src/lib/github/client.ts");
    assert.equal(insights.files.highestDegree!.value, 4);
    assert.equal(insights.files.highestDegree!.ties, 1);
  });

  it("finds the largest file", () => {
    assert.equal(pathOf(insights.files.largest), "src/lib/github/archive.ts");
    assert.equal(insights.files.largest!.value, 14_000);
  });

  it("counts and lists isolated files by path", () => {
    assert.equal(insights.totals.isolatedFiles, 2);
    assert.deepEqual(insights.isolated, [
      { id: "README.js", path: "README.js", name: "README.js", directory: "" },
      { id: "scripts/build.js", path: "scripts/build.js", name: "build.js", directory: "scripts" },
    ]);
  });

  it("describes files with a name, path, directory and value", () => {
    assert.deepEqual(insights.files.mostReferenced, {
      file: { id: "src/lib/utils.ts", path: "src/lib/utils.ts", name: "utils.ts", directory: "src/lib" },
      value: 4,
      ties: 0,
    });
  });

  it("breaks ties by path, not input order", () => {
    const graph = buildDependencyGraph(
      [file("b/z.ts", 700), file("a/y.ts", 700), file("c.ts", 700), file("hub.ts", 10)],
      [rel("hub.ts", "b/z.ts"), rel("hub.ts", "a/y.ts"), rel("hub.ts", "c.ts")],
    );
    const result = deriveRepositoryInsights(graph);

    assert.equal(pathOf(result.files.mostReferenced), "a/y.ts");
    assert.equal(result.files.mostReferenced!.ties, 2);
    assert.equal(pathOf(result.files.largest), "a/y.ts");
    assert.equal(result.files.largest!.ties, 2);
  });

  it("reports no edge-based leaders for a graph without edges", () => {
    const result = deriveRepositoryInsights(buildDependencyGraph([file("a.ts", 10), file("b.ts", 20)], []));

    assert.equal(result.files.mostReferenced, null);
    assert.equal(result.files.mostOutgoing, null);
    assert.equal(result.files.highestDegree, null);
    assert.equal(pathOf(result.files.largest), "b.ts");
    assert.equal(result.totals.isolatedFiles, 2);
    assert.equal(result.totals.edges, 0);
  });

  it("handles a single isolated file", () => {
    const result = deriveRepositoryInsights(buildDependencyGraph([file("index.js", 321)], []));

    assert.deepEqual(result.totals, {
      files: 1,
      edges: 0,
      relationships: 0,
      directories: 1,
      totalBytes: 321,
      isolatedFiles: 1,
      languages: { javascript: 1 },
    });
    assert.deepEqual(fileHighlights(result), [
      { file: result.isolated[0], facts: [{ kind: "largest", value: 321, ties: 0 }] },
    ]);
  });

  it("counts both directions of a cycle", () => {
    const result = deriveRepositoryInsights(
      buildDependencyGraph(
        [file("a.ts"), file("b.ts"), file("c.ts")],
        [rel("a.ts", "b.ts"), rel("b.ts", "c.ts"), rel("c.ts", "a.ts")],
      ),
    );

    for (const fact of [result.files.mostReferenced, result.files.mostOutgoing]) {
      assert.equal(pathOf(fact), "a.ts");
      assert.equal(fact!.value, 1);
      assert.equal(fact!.ties, 2);
    }
    assert.equal(result.files.highestDegree!.value, 2);
    assert.equal(result.totals.isolatedFiles, 0);
  });
});

describe("directory metrics", () => {
  const insights = deriveRepositoryInsights(sample());
  const directory = (path: string) => insights.directories.find((d) => d.path === path)!;

  it("counts files and bytes directly in each directory", () => {
    assert.deepEqual(
      insights.directories.map((d) => [d.path, d.fileCount, d.totalBytes]),
      [
        ["", 1, 40],
        ["scripts", 1, 2_000],
        ["src/app", 2, 4_200],
        ["src/lib", 1, 500],
        ["src/lib/github", 2, 23_000],
      ],
    );
  });

  it("sums incoming, outgoing and degree over the directory's files", () => {
    assert.deepEqual(
      ["src/app", "src/lib", "src/lib/github"].map((path) => {
        const d = directory(path);
        return [path, d.incoming, d.outgoing, d.degree, d.internalEdges];
      }),
      [
        ["src/app", 1, 4, 5, 1],
        ["src/lib", 4, 0, 4, 0],
        ["src/lib/github", 3, 4, 7, 2],
      ],
    );
  });

  it("keeps root files in their own entry", () => {
    assert.deepEqual(directory(""), {
      path: "",
      fileCount: 1,
      totalBytes: 40,
      incoming: 0,
      outgoing: 0,
      degree: 0,
      internalEdges: 0,
      isolatedFiles: 1,
    });
  });

  it("treats nested directories separately from their parents", () => {
    // src/lib does not include src/lib/github's files or edges.
    assert.equal(directory("src/lib").fileCount, 1);
    assert.equal(directory("src/lib").degree, 4);
    assert.ok(!insights.directories.some((d) => d.path === "src"));
  });

  it("counts isolated files per directory", () => {
    assert.deepEqual(
      insights.directories.filter((d) => d.isolatedFiles > 0).map((d) => [d.path, d.isolatedFiles]),
      [["", 1], ["scripts", 1]],
    );
  });

  it("finds the leading directories", () => {
    assert.deepEqual(insights.directoryFacts, {
      mostFiles: { path: "src/app", value: 2, ties: 1 },
      mostIncoming: { path: "src/lib", value: 4, ties: 0 },
      mostOutgoing: { path: "src/app", value: 4, ties: 1 },
      highestDegree: { path: "src/lib/github", value: 7, ties: 0 },
    });
  });

  it("orders directories by code unit, independent of input order", () => {
    const graph = sample();
    const reordered: InsightGraph = { nodes: [...graph.nodes].reverse(), edges: [...graph.edges].reverse() };

    assert.deepEqual(deriveRepositoryInsights(reordered).directories, insights.directories);
    const upper = deriveRepositoryInsights(buildDependencyGraph([file("b/x.ts"), file("B/x.ts"), file("a/x.ts")], []));
    assert.deepEqual(upper.directories.map((d) => d.path), ["B", "a", "b"]);
  });
});

describe("relationship semantics", () => {
  it("counts unique edges for degree and relationships separately", () => {
    const graph = buildDependencyGraph(
      [file("a.ts"), file("b.ts"), file("c.ts")],
      [
        rel("a.ts", "b.ts", "import", "./b"),
        rel("a.ts", "b.ts", "reexport", "./b"),
        rel("a.ts", "b.ts", "dynamic_import", "./b.ts"),
        rel("c.ts", "b.ts"),
      ],
    );
    const result = deriveRepositoryInsights(graph);

    assert.equal(result.totals.edges, 2);
    assert.equal(result.totals.relationships, 4);
    assert.equal(result.files.mostReferenced!.value, 2);
    assert.equal(result.files.mostOutgoing!.value, 1);
    assert.equal(result.files.mostOutgoing!.ties, 1);
    assert.equal(result.directories[0].degree, 4);
  });

  it("does not let edge weight change degree leaders", () => {
    // a -> b carries five relationships, c -> d and c -> e one each.
    const graph = buildDependencyGraph(
      ["a.ts", "b.ts", "c.ts", "d.ts", "e.ts"].map((p) => file(p)),
      [
        ...["./b", "./b.ts", "./b.js", "../x/b", "./b/"].map((s) => rel("a.ts", "b.ts", "import", s)),
        rel("c.ts", "d.ts"),
        rel("c.ts", "e.ts"),
      ],
    );
    const result = deriveRepositoryInsights(graph);

    assert.equal(pathOf(result.files.mostOutgoing), "c.ts");
    assert.equal(result.files.mostOutgoing!.value, 2);
    assert.equal(pathOf(result.files.highestDegree), "c.ts");
    assert.equal(result.totals.relationships, 7);
  });

  it("ignores self relationships", () => {
    const result = deriveRepositoryInsights(
      buildDependencyGraph([file("a.ts"), file("b.ts")], [rel("a.ts", "a.ts"), rel("b.ts", "b.ts")]),
    );

    assert.equal(result.totals.edges, 0);
    assert.equal(result.totals.relationships, 0);
    assert.equal(result.totals.isolatedFiles, 2);
    assert.equal(result.files.highestDegree, null);
  });

  it("ignores self loops and edges to unknown files in a payload", () => {
    const graph = toRenderGraph(sample());
    const withNoise: InsightGraph = {
      nodes: graph.nodes,
      edges: [
        ...graph.edges,
        { source: "src/app/page.tsx", target: "src/app/page.tsx", weight: 9 },
        { source: "src/app/page.tsx", target: "node_modules/react/index.js", weight: 9 },
      ],
    };

    assert.deepEqual(deriveRepositoryInsights(withNoise), deriveRepositoryInsights(graph));
  });

  it("is unaffected by references that did not resolve to a loaded file", () => {
    // The analysis drops package imports and unresolvable specifiers before
    // the graph is built, so the graph has only these two files and one edge.
    const result = deriveRepositoryInsights(buildDependencyGraph([file("a.ts"), file("b.ts")], [rel("a.ts", "b.ts")]));

    assert.equal(result.totals.edges, 1);
    assert.equal(result.totals.relationships, 1);
    assert.equal(pathOf(result.files.mostReferenced), "b.ts");
  });

  it("produces the same insights from the dependency graph and the browser payload", () => {
    const graph = sample();
    assert.deepEqual(deriveRepositoryInsights(toRenderGraph(graph)), deriveRepositoryInsights(graph));
  });
});

describe("totals", () => {
  const insights = deriveRepositoryInsights(sample());

  it("matches the dependency graph's own statistics", () => {
    const graph = sample();

    assert.equal(insights.totals.files, graph.stats.nodes);
    assert.equal(insights.totals.edges, graph.stats.edges);
    assert.equal(insights.totals.relationships, graph.stats.relationships);
    assert.equal(insights.totals.directories, graph.stats.directories);
    assert.equal(insights.totals.totalBytes, graph.stats.totalBytes);
    assert.equal(insights.totals.isolatedFiles, graph.stats.isolatedNodes);
    assert.deepEqual(insights.totals.languages, graph.stats.languages);
  });

  it("splits languages", () => {
    assert.deepEqual(insights.totals.languages, { typescript: 5, javascript: 2 });
    assert.equal(insights.totals.totalBytes, 29_740);
  });

  it("describes directory leaders with a path and value", () => {
    assert.deepEqual(Object.keys(insights.directoryFacts.highestDegree!).sort(), ["path", "ties", "value"]);
  });
});

describe("fileHighlights", () => {
  it("lists each leading file once, in a fixed order", () => {
    const highlights = fileHighlights(deriveRepositoryInsights(sample()));

    assert.deepEqual(
      highlights.map((h) => [h.file.path, h.facts.map((f) => f.kind)]),
      [
        ["src/lib/utils.ts", ["mostReferenced"]],
        ["src/app/page.tsx", ["mostOutgoing"]],
        ["src/lib/github/client.ts", ["highestDegree"]],
        ["src/lib/github/archive.ts", ["largest"]],
      ],
    );
  });

  it("merges categories that point to the same file", () => {
    const graph = buildDependencyGraph([file("index.js", 900), file("test.js", 300)], [rel("test.js", "index.js")]);
    const highlights = fileHighlights(deriveRepositoryInsights(graph));

    assert.deepEqual(
      highlights.map((h) => [h.file.path, h.facts.map((f) => [f.kind, f.value, f.ties])]),
      [
        ["index.js", [["mostReferenced", 1, 0], ["highestDegree", 1, 1], ["largest", 900, 0]]],
        ["test.js", [["mostOutgoing", 1, 0]]],
      ],
    );
  });

  it("is empty for an empty graph", () => {
    assert.deepEqual(fileHighlights(deriveRepositoryInsights({ nodes: [], edges: [] })), []);
  });
});

describe("directoryHighlights", () => {
  it("lists each leading directory once, with its facts in a fixed order", () => {
    assert.deepEqual(
      directoryHighlights(deriveRepositoryInsights(sample())).map((h) => [h.path, h.facts.map((f) => [f.kind, f.value])]),
      [
        ["src/app", [["mostFiles", 2], ["mostOutgoing", 4]]],
        ["src/lib", [["mostIncoming", 4]]],
        ["src/lib/github", [["highestDegree", 7]]],
      ],
    );
  });

  it("shows a directory that leads everything once", () => {
    const graph = buildDependencyGraph(
      [file("src/a.ts"), file("src/b.ts"), file("src/c.ts"), file("README.js")],
      [rel("src/a.ts", "src/b.ts"), rel("src/c.ts", "src/b.ts")],
    );
    const highlights = directoryHighlights(deriveRepositoryInsights(graph));

    assert.equal(highlights.length, 1);
    assert.equal(highlights[0].path, "src");
    assert.deepEqual(highlights[0].facts.map((f) => f.kind), ["mostFiles", "mostIncoming", "mostOutgoing", "highestDegree"]);
  });

  it("is empty for an empty graph", () => {
    assert.deepEqual(directoryHighlights(deriveRepositoryInsights({ nodes: [], edges: [] })), []);
  });
});

describe("determinism", () => {
  it("returns the same insights for shuffled nodes and edges", () => {
    const graph = toRenderGraph(sample());
    const expected = deriveRepositoryInsights(graph);

    for (const seed of [1, 5, 99]) {
      assert.deepEqual(deriveRepositoryInsights({ nodes: shuffled(graph.nodes, seed), edges: graph.edges }), expected);
      assert.deepEqual(deriveRepositoryInsights({ nodes: graph.nodes, edges: shuffled(graph.edges, seed) }), expected);
    }
  });

  it("does not depend on locale-sensitive APIs", () => {
    const graph = buildDependencyGraph(
      [file("ä/x.ts"), file("Z/y.ts"), file("a/z.ts"), file("é/ß.ts")],
      [rel("ä/x.ts", "Z/y.ts"), rel("a/z.ts", "Z/y.ts")],
    );
    const expected = deriveRepositoryInsights(graph);
    const localeCompare = String.prototype.localeCompare;
    const toLocaleString = Number.prototype.toLocaleString;
    String.prototype.localeCompare = () => {
      throw new Error("localeCompare called");
    };
    Number.prototype.toLocaleString = () => {
      throw new Error("toLocaleString called");
    };
    try {
      assert.deepEqual(deriveRepositoryInsights(graph), expected);
    } finally {
      String.prototype.localeCompare = localeCompare;
      Number.prototype.toLocaleString = toLocaleString;
    }
    assert.deepEqual(expected.directories.map((d) => d.path), ["Z", "a", "ä", "é"]);
  });

  it("does not modify its input", () => {
    const graph = sample();
    const copy = structuredClone(graph);

    deriveRepositoryInsights(graph);
    assert.deepEqual(graph, copy);
  });
});

describe("boundaries", () => {
  it("handles an empty graph", () => {
    const result = deriveRepositoryInsights({ nodes: [], edges: [] });

    assert.deepEqual(result.totals, {
      files: 0,
      edges: 0,
      relationships: 0,
      directories: 0,
      totalBytes: 0,
      isolatedFiles: 0,
      languages: {},
    });
    assert.deepEqual(result.files, { mostReferenced: null, mostOutgoing: null, highestDegree: null, largest: null });
    assert.deepEqual(result.directoryFacts, { mostFiles: null, mostIncoming: null, mostOutgoing: null, highestDegree: null });
    assert.deepEqual(result.isolated, []);
  });

  it("handles a repository with only root files", () => {
    const result = deriveRepositoryInsights(
      buildDependencyGraph([file("index.js"), file("test.js"), file("cli.js")], [rel("test.js", "index.js"), rel("cli.js", "index.js")]),
    );

    assert.deepEqual(result.directories.map((d) => [d.path, d.fileCount, d.internalEdges]), [["", 3, 2]]);
    assert.deepEqual(result.directoryFacts.highestDegree, { path: "", value: 4, ties: 0 });
  });

  it("handles 500 files", () => {
    const files = Array.from({ length: 500 }, (_, i) =>
      file(`packages/p${i % 7}/src/m${i}.${i % 4 === 0 ? "js" : "ts"}`, 100 + ((i * 7919) % 90_000)),
    );
    const relationships = files.slice(1).flatMap((f, i) => [rel(f.path, files[i].path), rel(f.path, files[Math.floor(i / 3)].path, "reexport")]);
    const graph = buildDependencyGraph(files, relationships);
    const started = performance.now();
    const result = deriveRepositoryInsights(toRenderGraph(graph));
    const elapsed = performance.now() - started;

    assert.equal(result.totals.files, 500);
    assert.equal(result.totals.edges, graph.stats.edges);
    assert.equal(result.totals.relationships, graph.stats.relationships);
    assert.equal((result.totals.languages.javascript ?? 0) + (result.totals.languages.typescript ?? 0), 500);
    assert.equal(result.directories.reduce((sum, d) => sum + d.fileCount, 0), 500);
    assert.equal(
      result.directories.reduce((sum, d) => sum + d.degree, 0),
      2 * graph.stats.edges,
    );
    assert.ok(elapsed < 1_000, `${elapsed}ms`);
  });
});

describe("navigation from insights", () => {
  const graph = toRenderGraph(sample());
  const insights = deriveRepositoryInsights(graph);
  const index = buildGraphIndex(graph);

  it("gives file insights IDs that select the file and open its details", () => {
    for (const highlight of fileHighlights(insights)) {
      assert.equal(selectionFor(index, highlight.file.id), highlight.file.id);
      assert.equal(describeFile(index, highlight.file.id)!.path, highlight.file.path);
    }
    for (const isolated of insights.isolated) {
      const focus = neighborhood(index, isolated.id)!;
      assert.equal(focus.selected, isolated.id);
      assert.equal(focus.neighbors.size, 0);
    }
  });

  it("replaces one insight's selection with the next and clears on reset", () => {
    const first = neighborhood(index, insights.files.mostReferenced!.file.id)!;
    const second = neighborhood(index, insights.files.largest!.file.id)!;

    assert.equal(first.selected, "src/lib/utils.ts");
    assert.equal(second.selected, "src/lib/github/archive.ts");
    assert.equal(selectionFor(index, null), null);
  });

  it("finds the same files through search", () => {
    assert.equal(searchFiles(index, insights.files.largest!.file.name)[0].id, insights.files.largest!.file.id);
  });
});

describe("languages", () => {
  it("counts every language present and orders them by file count", () => {
    assert.deepEqual(languageBreakdown({ typescript: 10, python: 42, rust: 18, go: 0 }), [
      { language: "python", files: 42 },
      { language: "rust", files: 18 },
      { language: "typescript", files: 10 },
    ]);
    assert.deepEqual(languageBreakdown({ cpp: 3, c: 3 }), [
      { language: "c", files: 3 },
      { language: "cpp", files: 3 },
    ]);
    assert.deepEqual(languageBreakdown({}), []);
  });
});
