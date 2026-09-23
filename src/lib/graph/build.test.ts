import assert from "node:assert/strict";
import { describe, it } from "node:test";

import type { ReferenceKind } from "../analysis/imports.ts";
import { analyzeModuleRelationships, type ModuleRelationship } from "../analysis/relationships.ts";
import type { SourceExtension } from "../source-files.ts";
import { buildDependencyGraph, edgeId, type GraphSource } from "./build.ts";

function file(path: string, size = 100): GraphSource {
  const extension = path.slice(path.lastIndexOf(".")) as SourceExtension;
  const language = extension === ".ts" || extension === ".tsx" ? "typescript" : "javascript";
  return { path, extension, language, size };
}

function rel(
  sourcePath: string,
  targetPath: string,
  kind: ReferenceKind = "import",
  specifier = `./${targetPath.slice(targetPath.lastIndexOf("/") + 1).replace(/\.[jt]sx?$/, "")}`,
): ModuleRelationship {
  return { sourcePath, targetPath, kind, specifier };
}

function counts(partial: Partial<Record<ReferenceKind, number>> = {}) {
  return { import: 0, reexport: 0, dynamic_import: 0, require: 0, ...partial };
}

function node(graph: ReturnType<typeof buildDependencyGraph>, path: string) {
  const found = graph.nodes.find((n) => n.id === path);
  assert.ok(found, `missing node ${path}`);
  return found;
}

function edgeSummary(graph: ReturnType<typeof buildDependencyGraph>) {
  return graph.edges.map((e) => `${e.source} -> ${e.target} (${e.weight})`);
}

function shuffled<T>(items: T[], seed: number): T[] {
  const result = [...items];
  let state = seed;
  for (let i = result.length - 1; i > 0; i--) {
    state = (state * 1103515245 + 12345) % 2147483648;
    const j = state % (i + 1);
    [result[i], result[j]] = [result[j], result[i]];
  }
  return result;
}

describe("buildDependencyGraph", () => {
  describe("nodes", () => {
    it("creates one node for one source file", () => {
      const graph = buildDependencyGraph([file("src/lib/parser.ts", 420)], []);

      assert.deepEqual(graph.nodes, [
        {
          id: "src/lib/parser.ts",
          path: "src/lib/parser.ts",
          name: "parser.ts",
          directory: "src/lib",
          extension: ".ts",
          language: "typescript",
          size: 420,
          incoming: 0,
          outgoing: 0,
          degree: 0,
          incomingByKind: counts(),
          outgoingByKind: counts(),
        },
      ]);
      assert.deepEqual(graph.edges, []);
    });

    it("uses the repository-relative path as the node ID", () => {
      const graph = buildDependencyGraph([file("packages/ui/src/button.tsx")], []);
      assert.equal(graph.nodes[0].id, "packages/ui/src/button.tsx");
      assert.equal(graph.nodes[0].id, graph.nodes[0].path);
    });

    it("uses an empty directory for root-level files", () => {
      const { nodes } = buildDependencyGraph([file("next.config.ts")], []);
      assert.equal(nodes[0].name, "next.config.ts");
      assert.equal(nodes[0].directory, "");
    });

    it("splits nested paths into name and directory", () => {
      const { nodes } = buildDependencyGraph([file("app/(docs)/[...slug]/page.tsx")], []);
      assert.equal(nodes[0].name, "page.tsx");
      assert.equal(nodes[0].directory, "app/(docs)/[...slug]");
    });

    it("keeps extension, language and size from the source file", () => {
      const { nodes } = buildDependencyGraph(
        [file("a.ts", 1), file("b.tsx", 2), file("c.js", 3), file("d.jsx", 0)],
        [],
      );

      assert.deepEqual(
        nodes.map((n) => [n.extension, n.language, n.size]),
        [
          [".ts", "typescript", 1],
          [".tsx", "typescript", 2],
          [".js", "javascript", 3],
          [".jsx", "javascript", 0],
        ],
      );
    });

    it("keeps language as given rather than inferring it again", () => {
      const source: GraphSource = { path: "a.js", extension: ".js", language: "typescript", size: 1 };
      assert.equal(buildDependencyGraph([source], []).nodes[0].language, "typescript");
    });

    it("keeps files without relationships", () => {
      const graph = buildDependencyGraph(
        [file("src/a.ts"), file("src/b.ts"), file("src/isolated.ts")],
        [rel("src/a.ts", "src/b.ts")],
      );

      assert.deepEqual(graph.nodes.map((n) => n.id), ["src/a.ts", "src/b.ts", "src/isolated.ts"]);
      assert.equal(node(graph, "src/isolated.ts").degree, 0);
    });

    it("rejects duplicate source paths", () => {
      assert.throws(
        () => buildDependencyGraph([file("src/a.ts", 1), file("src/b.ts"), file("src/a.ts", 2)], []),
        { message: "Duplicate source file: src/a.ts" },
      );
    });

    it("rejects paths that are not normalized repository paths", () => {
      for (const path of ["", "/src/a.ts", "./src/a.ts", "src//a.ts", "src/../a.ts", "src/a.ts/"]) {
        assert.throws(() => buildDependencyGraph([file("src/a.ts"), { ...file("x.ts"), path }], []), {
          message: `Invalid source path: ${JSON.stringify(path)}`,
        });
      }
    });

    it("does not create nodes for relationship specifiers or packages", () => {
      const graph = buildDependencyGraph(
        [file("src/a.ts"), file("src/b.ts")],
        [rel("src/a.ts", "src/b.ts", "import", "@/b")],
      );
      assert.deepEqual(graph.nodes.map((n) => n.id), ["src/a.ts", "src/b.ts"]);
    });
  });

  describe("edges", () => {
    it("creates one directed edge from source to target", () => {
      const graph = buildDependencyGraph([file("src/a.ts"), file("src/b.ts")], [rel("src/a.ts", "src/b.ts")]);

      assert.deepEqual(graph.edges, [
        {
          id: '["src/a.ts","src/b.ts"]',
          source: "src/a.ts",
          target: "src/b.ts",
          weight: 1,
          kinds: counts({ import: 1 }),
          specifiers: ["./b"],
        },
      ]);
      assert.equal(node(graph, "src/a.ts").outgoing, 1);
      assert.equal(node(graph, "src/a.ts").incoming, 0);
      assert.equal(node(graph, "src/b.ts").incoming, 1);
      assert.equal(node(graph, "src/b.ts").outgoing, 0);
    });

    for (const kind of ["import", "reexport", "dynamic_import", "require"] as const) {
      it(`counts ${kind} relationships`, () => {
        const graph = buildDependencyGraph([file("a.js"), file("b.js")], [rel("a.js", "b.js", kind)]);
        assert.deepEqual(graph.edges[0].kinds, counts({ [kind]: 1 }));
        assert.deepEqual(node(graph, "a.js").outgoingByKind, counts({ [kind]: 1 }));
        assert.deepEqual(node(graph, "b.js").incomingByKind, counts({ [kind]: 1 }));
      });
    }

    it("merges relationships between the same pair into one edge", () => {
      const graph = buildDependencyGraph(
        [file("src/index.ts"), file("src/util.ts")],
        [
          rel("src/index.ts", "src/util.ts", "import", "./util"),
          rel("src/index.ts", "src/util.ts", "import", "./util.ts"),
          rel("src/index.ts", "src/util.ts", "reexport", "./util"),
          rel("src/index.ts", "src/util.ts", "dynamic_import", "./util.js"),
          rel("src/index.ts", "src/util.ts", "require", "./util"),
        ],
      );

      assert.equal(graph.edges.length, 1);
      assert.deepEqual(graph.edges[0], {
        id: edgeId("src/index.ts", "src/util.ts"),
        source: "src/index.ts",
        target: "src/util.ts",
        weight: 5,
        kinds: counts({ import: 2, reexport: 1, dynamic_import: 1, require: 1 }),
        specifiers: ["./util", "./util.js", "./util.ts"],
      });
    });

    it("keeps a single edge for one import and one re-export of the same target", () => {
      const graph = buildDependencyGraph(
        [file("a.ts"), file("b.ts")],
        [rel("a.ts", "b.ts", "import", "./b"), rel("a.ts", "b.ts", "reexport", "./b")],
      );

      assert.equal(graph.edges.length, 1);
      assert.equal(graph.edges[0].weight, 2);
      assert.deepEqual(graph.edges[0].kinds, counts({ import: 1, reexport: 1 }));
      assert.deepEqual(graph.edges[0].specifiers, ["./b"]);
    });

    it("sorts specifiers by code unit", () => {
      const specifiers = ["./b", "@/b", "../src/b", "./B", "./b.ts"];
      const graph = buildDependencyGraph(
        [file("src/a.ts"), file("src/b.ts")],
        specifiers.map((specifier) => rel("src/a.ts", "src/b.ts", "import", specifier)),
      );

      assert.deepEqual(graph.edges[0].specifiers, ["../src/b", "./B", "./b", "./b.ts", "@/b"]);
    });

    it("counts a repeated identical relationship once", () => {
      const graph = buildDependencyGraph([file("a.ts"), file("b.ts")], [rel("a.ts", "b.ts"), rel("a.ts", "b.ts")]);
      assert.equal(graph.edges[0].weight, 1);
      assert.equal(graph.stats.relationships, 1);
    });

    it("ignores self relationships, as the analysis does", () => {
      const graph = buildDependencyGraph(
        [file("src/a.ts"), file("src/b.ts")],
        [rel("src/a.ts", "src/a.ts", "import", "./a"), rel("src/a.ts", "src/b.ts")],
      );

      assert.deepEqual(edgeSummary(graph), ["src/a.ts -> src/b.ts (1)"]);
      assert.equal(node(graph, "src/a.ts").incoming, 0);
      assert.equal(graph.stats.relationships, 1);
    });

    it("rejects a relationship from a file that is not loaded", () => {
      assert.throws(() => buildDependencyGraph([file("src/b.ts")], [rel("src/missing.ts", "src/b.ts")]), {
        message: "Relationship source is not a loaded source file: src/missing.ts",
      });
    });

    it("rejects a relationship to a file that is not loaded", () => {
      assert.throws(() => buildDependencyGraph([file("src/a.ts")], [rel("src/a.ts", "src/missing.ts")]), {
        message: "Relationship target is not a loaded source file: src/missing.ts",
      });
    });

    it("rejects unknown relationship kinds", () => {
      const relationship = { ...rel("a.ts", "b.ts"), kind: "link" as ReferenceKind };
      assert.throws(() => buildDependencyGraph([file("a.ts"), file("b.ts")], [relationship]), {
        message: 'Unknown relationship kind: "link"',
      });
    });

    it("builds edge IDs that cannot collide across path pairs", () => {
      assert.equal(edgeId("src/a.ts", "src/b.ts"), '["src/a.ts","src/b.ts"]');
      assert.notEqual(edgeId("a -> b", "c"), edgeId("a", "b -> c"));
      assert.notEqual(edgeId("a\",\"b", "c"), edgeId("a", "b\",\"c"));
    });
  });

  describe("node counts", () => {
    const graph = buildDependencyGraph(
      [file("src/app.ts"), file("src/lib.ts"), file("src/types.ts"), file("src/page.ts")],
      [
        rel("src/app.ts", "src/lib.ts", "import", "./lib"),
        rel("src/app.ts", "src/lib.ts", "import", "@/lib"),
        rel("src/app.ts", "src/lib.ts", "reexport", "./lib"),
        rel("src/app.ts", "src/lib.ts", "require", "./lib"),
        rel("src/app.ts", "src/types.ts", "import", "./types"),
        rel("src/page.ts", "src/lib.ts", "dynamic_import", "./lib"),
        rel("src/lib.ts", "src/types.ts", "reexport", "./types"),
      ],
    );

    it("counts outgoing as unique edges", () => {
      assert.equal(node(graph, "src/app.ts").outgoing, 2);
      assert.equal(node(graph, "src/lib.ts").outgoing, 1);
      assert.equal(node(graph, "src/types.ts").outgoing, 0);
    });

    it("counts incoming as unique edges", () => {
      assert.equal(node(graph, "src/lib.ts").incoming, 2);
      assert.equal(node(graph, "src/types.ts").incoming, 2);
      assert.equal(node(graph, "src/app.ts").incoming, 0);
    });

    it("sets degree to incoming plus outgoing", () => {
      for (const n of graph.nodes) assert.equal(n.degree, n.incoming + n.outgoing, n.id);
      assert.equal(node(graph, "src/lib.ts").degree, 3);
    });

    it("does not let edge weight inflate degree", () => {
      const heavy = graph.edges.find((e) => e.id === edgeId("src/app.ts", "src/lib.ts"));
      assert.equal(heavy?.weight, 4);
      assert.equal(node(graph, "src/app.ts").degree, 2);
    });

    it("counts incoming edges per kind", () => {
      assert.deepEqual(node(graph, "src/lib.ts").incomingByKind, counts({ import: 1, reexport: 1, require: 1, dynamic_import: 1 }));
      assert.deepEqual(node(graph, "src/types.ts").incomingByKind, counts({ import: 1, reexport: 1 }));
    });

    it("counts outgoing edges per kind", () => {
      // import is 2 because of two edges (to lib and types), not because of
      // the two import relationships to lib.
      assert.deepEqual(node(graph, "src/app.ts").outgoingByKind, counts({ import: 2, reexport: 1, require: 1 }));
      assert.deepEqual(node(graph, "src/page.ts").outgoingByKind, counts({ dynamic_import: 1 }));
    });
  });

  describe("stats", () => {
    const graph = buildDependencyGraph(
      [
        file("src/a.ts", 10),
        file("src/b.tsx", 20),
        file("src/c.js", 30),
        file("lib/d.jsx", 40),
        file("index.js", 5),
        file("scripts/tool.ts", 7),
      ],
      [
        rel("src/a.ts", "src/b.tsx", "import", "./b"),
        rel("src/a.ts", "src/b.tsx", "reexport", "./b"),
        rel("src/b.tsx", "lib/d.jsx", "import", "../lib/d"),
        rel("index.js", "src/c.js", "require", "./src/c"),
      ],
    );

    it("reports graph totals", () => {
      assert.deepEqual(graph.stats, {
        nodes: 6,
        edges: 3,
        isolatedNodes: 1,
        relationships: 4,
        totalBytes: 112,
        directories: 4,
        languages: { typescript: 3, javascript: 3 },
      });
    });

    it("reports zeros for an empty graph", () => {
      assert.deepEqual(buildDependencyGraph([], []), {
        nodes: [],
        edges: [],
        directories: [],
        stats: {
          nodes: 0,
          edges: 0,
          isolatedNodes: 0,
          relationships: 0,
          totalBytes: 0,
          directories: 0,
          languages: { typescript: 0, javascript: 0 },
        },
      });
    });
  });

  describe("directories", () => {
    it("summarizes files directly in each directory, with the root as an empty path", () => {
      const graph = buildDependencyGraph(
        [
          file("package.js", 3),
          file("next.config.ts", 4),
          file("src/index.ts", 10),
          file("src/lib/a.ts", 100),
          file("src/lib/b.js", 50),
          file("src/lib/deep/c.ts", 7),
        ],
        [],
      );

      assert.deepEqual(graph.directories, [
        { path: "", fileCount: 2, totalBytes: 7 },
        { path: "src", fileCount: 1, totalBytes: 10 },
        { path: "src/lib", fileCount: 2, totalBytes: 150 },
        { path: "src/lib/deep", fileCount: 1, totalBytes: 7 },
      ]);
    });

    it("does not list directories that only contain other directories", () => {
      const graph = buildDependencyGraph([file("packages/ui/src/button.tsx")], []);
      assert.deepEqual(graph.directories.map((d) => d.path), ["packages/ui/src"]);
    });
  });

  describe("determinism", () => {
    const files = [
      file("src/z.ts", 1),
      file("src/a.ts", 2),
      file("src/B.ts", 3),
      file("lib/m.js", 4),
      file("index.ts", 5),
      file("src/lib/x.tsx", 6),
    ];
    const relationships = [
      rel("src/z.ts", "src/a.ts", "import", "./a"),
      rel("src/z.ts", "src/a.ts", "reexport", "./a"),
      rel("src/a.ts", "src/z.ts", "dynamic_import", "./z"),
      rel("index.ts", "src/B.ts", "import", "./src/B"),
      rel("index.ts", "lib/m.js", "require", "./lib/m"),
      rel("src/lib/x.tsx", "src/a.ts", "import", "../a"),
      rel("src/lib/x.tsx", "src/a.ts", "import", "@/a"),
      rel("src/B.ts", "src/a.ts", "import", "./a"),
    ];
    const expected = buildDependencyGraph(files, relationships);

    it("does not depend on file or relationship input order", () => {
      for (let seed = 1; seed <= 20; seed++) {
        const graph = buildDependencyGraph(shuffled(files, seed), shuffled(relationships, seed * 7));
        assert.deepEqual(graph, expected);
      }
    });

    it("orders nodes, edges and directories by code unit", () => {
      assert.deepEqual(expected.nodes.map((n) => n.id), [
        "index.ts",
        "lib/m.js",
        "src/B.ts",
        "src/a.ts",
        "src/lib/x.tsx",
        "src/z.ts",
      ]);
      assert.deepEqual(edgeSummary(expected), [
        "index.ts -> lib/m.js (1)",
        "index.ts -> src/B.ts (1)",
        "src/B.ts -> src/a.ts (1)",
        "src/a.ts -> src/z.ts (1)",
        "src/lib/x.tsx -> src/a.ts (2)",
        "src/z.ts -> src/a.ts (2)",
      ]);
      assert.deepEqual(expected.directories.map((d) => d.path), ["", "lib", "src", "src/lib"]);
    });

    it("produces the same edge IDs when rebuilt", () => {
      const rebuilt = buildDependencyGraph([...files].reverse(), [...relationships].reverse());
      assert.deepEqual(rebuilt.edges.map((e) => e.id), expected.edges.map((e) => e.id));
      assert.equal(expected.edges[0].id, '["index.ts","lib/m.js"]');
    });

    it("does not share count objects between nodes and edges", () => {
      const graph = buildDependencyGraph([file("a.ts"), file("b.ts")], [rel("a.ts", "b.ts")]);
      graph.nodes[0].outgoingByKind.import = 99;
      assert.equal(graph.nodes[1].incomingByKind.import, 1);
      assert.equal(graph.edges[0].kinds.import, 1);
    });
  });

  describe("realistic graphs", () => {
    it("connects a barrel file to its modules", () => {
      const graph = buildDependencyGraph(
        [
          file("src/components/index.ts"),
          file("src/components/Button.tsx"),
          file("src/components/Card.tsx"),
          file("src/page.tsx"),
        ],
        [
          rel("src/components/index.ts", "src/components/Button.tsx", "reexport", "./Button"),
          rel("src/components/index.ts", "src/components/Card.tsx", "reexport", "./Card"),
          rel("src/page.tsx", "src/components/index.ts", "import", "./components"),
        ],
      );

      const barrel = node(graph, "src/components/index.ts");
      assert.deepEqual([barrel.incoming, barrel.outgoing], [1, 2]);
      assert.deepEqual(barrel.outgoingByKind, counts({ reexport: 2 }));
      assert.equal(graph.stats.isolatedNodes, 0);
    });

    it("gives a file that imports several files one edge per target", () => {
      const graph = buildDependencyGraph(
        [file("src/app.ts"), file("src/a.ts"), file("src/b.ts"), file("src/c.ts")],
        [rel("src/app.ts", "src/a.ts"), rel("src/app.ts", "src/b.ts"), rel("src/app.ts", "src/c.ts")],
      );

      assert.equal(node(graph, "src/app.ts").outgoing, 3);
      assert.deepEqual(edgeSummary(graph), [
        "src/app.ts -> src/a.ts (1)",
        "src/app.ts -> src/b.ts (1)",
        "src/app.ts -> src/c.ts (1)",
      ]);
    });

    it("counts each importer of a shared target once", () => {
      const graph = buildDependencyGraph(
        [file("src/utils.ts"), file("src/a.ts"), file("src/b.ts"), file("src/c.ts")],
        [
          rel("src/a.ts", "src/utils.ts"),
          rel("src/b.ts", "src/utils.ts"),
          rel("src/b.ts", "src/utils.ts", "import", "@/utils"),
          rel("src/c.ts", "src/utils.ts", "require"),
        ],
      );

      const utils = node(graph, "src/utils.ts");
      assert.equal(utils.incoming, 3);
      assert.deepEqual(utils.incomingByKind, counts({ import: 2, require: 1 }));
    });

    it("keeps both directions of a cycle", () => {
      const graph = buildDependencyGraph(
        [file("src/a.ts"), file("src/b.ts")],
        [rel("src/a.ts", "src/b.ts"), rel("src/b.ts", "src/a.ts")],
      );

      assert.deepEqual(edgeSummary(graph), ["src/a.ts -> src/b.ts (1)", "src/b.ts -> src/a.ts (1)"]);
      for (const n of graph.nodes) assert.deepEqual([n.incoming, n.outgoing, n.degree], [1, 1, 2]);
    });

    it("mixes JavaScript and TypeScript files", () => {
      const graph = buildDependencyGraph(
        [file("src/index.ts"), file("src/legacy.js"), file("src/view.tsx"), file("src/Old.jsx")],
        [
          rel("src/index.ts", "src/legacy.js"),
          rel("src/legacy.js", "src/view.tsx", "require"),
          rel("src/view.tsx", "src/Old.jsx"),
        ],
      );

      assert.deepEqual(graph.stats.languages, { typescript: 2, javascript: 2 });
      assert.equal(graph.stats.edges, 3);
    });

    it("accepts the output of analyzeModuleRelationships", () => {
      const contents: Record<string, string> = {
        "src/app.ts": 'import { util } from "./lib";\nexport * from "./lib";\nimport "react";\nimport "./missing";\n',
        "src/lib/index.ts": 'export * from "./util";\nimport "../app";\n',
        "src/lib/util.js": 'module.exports = require("./util");\n',
        "src/unused.jsx": "export default () => null;\n",
      };
      const sources = Object.entries(contents).map(([path, content]) => ({ ...file(path, content.length), content }));
      const analysis = analyzeModuleRelationships(sources);
      const graph = buildDependencyGraph(sources, analysis.relationships);

      assert.equal(analysis.stats.relationships, 4);
      assert.deepEqual(edgeSummary(graph), [
        "src/app.ts -> src/lib/index.ts (2)",
        "src/lib/index.ts -> src/app.ts (1)",
        "src/lib/index.ts -> src/lib/util.js (1)",
      ]);
      assert.equal(graph.stats.relationships, analysis.stats.relationships);
      assert.equal(graph.stats.isolatedNodes, 1);
    });

    it("keeps isolated config and test files", () => {
      const graph = buildDependencyGraph(
        [file("next.config.js"), file("src/app.ts"), file("src/lib.ts"), file("src/app.test.ts")],
        [rel("src/app.ts", "src/lib.ts")],
      );

      assert.deepEqual(
        graph.nodes.filter((n) => n.degree === 0).map((n) => n.id),
        ["next.config.js", "src/app.test.ts"],
      );
      assert.equal(graph.stats.isolatedNodes, 2);
      assert.equal(graph.stats.nodes, 4);
    });
  });
});
