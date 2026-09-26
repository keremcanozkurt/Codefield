import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { edgeId } from "../graph/build.ts";
import type { SourceLanguage } from "../source-files.ts";
import {
  activeFilterCount,
  ALL_DIRECTORIES,
  DEFAULT_FILTERS,
  directoryOptions,
  filterCounts,
  isDefaultFilters,
  isEdgeVisible,
  languageOptions,
  resolveSelection,
  visibleNodeIds,
  withinVisible,
  type FilterState,
} from "./filters.ts";
import { buildGraphIndex, searchFiles } from "./inspection.ts";
import type { RenderEdge, RenderGraph, RenderNode } from "./types.ts";

function node(path: string, language: SourceLanguage, size = 1_000): Omit<RenderNode, "incoming" | "outgoing" | "degree"> {
  const slash = path.lastIndexOf("/");
  return { id: path, path, directory: slash === -1 ? "" : path.slice(0, slash), language, size };
}

function edge(source: string, target: string): RenderEdge {
  return { id: edgeId(source, target), source, target, weight: 1, kinds: ["import"] };
}

// Sets node degree from the edge list, the way buildDependencyGraph does.
function graphOf(
  nodes: Omit<RenderNode, "incoming" | "outgoing" | "degree">[],
  edges: RenderEdge[] = [],
): RenderGraph {
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

// A: src/app/page.tsx (ts, degree 1) -> B: src/lib/util.ts (ts, degree 3)
// B -> C: src/lib/legacy.js (js, degree 1)
// E: lib/helper.js (js, degree 1) -> B
// D: src/lib/sub/deep.ts (ts, isolated), F: README.js (js, isolated, root)
function sample(): RenderGraph {
  return graphOf(
    [
      node("src/app/page.tsx", "typescript"),
      node("src/lib/util.ts", "typescript"),
      node("src/lib/legacy.js", "javascript"),
      node("src/lib/sub/deep.ts", "typescript"),
      node("lib/helper.js", "javascript"),
      node("README.js", "javascript"),
    ],
    [edge("src/app/page.tsx", "src/lib/util.ts"), edge("src/lib/util.ts", "src/lib/legacy.js"), edge("lib/helper.js", "src/lib/util.ts")],
  );
}

const A = "src/app/page.tsx";
const B = "src/lib/util.ts";
const C = "src/lib/legacy.js";
const D = "src/lib/sub/deep.ts";
const E = "lib/helper.js";
const F = "README.js";

function ids(set: Set<string> | null): string[] {
  return set === null ? [] : [...set].sort();
}

function filters(partial: Partial<FilterState> = {}): FilterState {
  return { ...DEFAULT_FILTERS, ...partial };
}

describe("visibleNodeIds", () => {
  const index = buildGraphIndex(sample());

  describe("language filter", () => {
    it("all includes every file", () => {
      assert.equal(visibleNodeIds(index, filters({ language: "all" })), null);
    });

    it("typescript only", () => {
      assert.deepEqual(ids(visibleNodeIds(index, filters({ language: "typescript" }))), [A, B, D].sort());
    });

    it("javascript only", () => {
      assert.deepEqual(ids(visibleNodeIds(index, filters({ language: "javascript" }))), [C, E, F].sort());
    });

    it("splits a mixed graph without leaving out either language", () => {
      const ts = visibleNodeIds(index, filters({ language: "typescript" }))!;
      const js = visibleNodeIds(index, filters({ language: "javascript" }))!;
      assert.equal(ts.size + js.size, index.entries.length);
      assert.equal([...ts].some((id) => js.has(id)), false);
    });

    it("produces an empty result when no file matches", () => {
      const onlyJs = graphOf([node("a.js", "javascript")]);
      const jsOnlyIndex = buildGraphIndex(onlyJs);
      assert.deepEqual(ids(visibleNodeIds(jsOnlyIndex, filters({ language: "typescript" }))), []);
    });
  });

  describe("directory filter", () => {
    it("one directory", () => {
      assert.deepEqual(ids(visibleNodeIds(index, filters({ directory: "src/lib" }))), [B, C].sort());
    });

    it("a nested directory requires an exact match, not a prefix", () => {
      const result = visibleNodeIds(index, filters({ directory: "src/lib" }))!;
      assert.ok(!result.has(D), "src/lib/sub/deep.ts is in a subdirectory, not src/lib itself");
      assert.deepEqual(ids(visibleNodeIds(index, filters({ directory: "src/lib/sub" }))), [D]);
    });

    it("the repository root uses the empty string", () => {
      assert.deepEqual(ids(visibleNodeIds(index, filters({ directory: "" }))), [F]);
    });

    it("an unknown directory produces an empty result", () => {
      assert.deepEqual(ids(visibleNodeIds(index, filters({ directory: "does/not/exist" }))), []);
    });

    it("orders directory options deterministically, root first", () => {
      assert.deepEqual(directoryOptions(index), ["", "lib", "src/app", "src/lib", "src/lib/sub"]);
    });
  });

  describe("connectivity filter", () => {
    it("all keeps every file", () => {
      assert.equal(visibleNodeIds(index, filters({ connectivity: "all" })), null);
    });

    it("connected only", () => {
      assert.deepEqual(ids(visibleNodeIds(index, filters({ connectivity: "connected" }))), [A, B, C, E].sort());
    });

    it("isolated only", () => {
      assert.deepEqual(ids(visibleNodeIds(index, filters({ connectivity: "isolated" }))), [D, F].sort());
    });
  });

  describe("degree filter", () => {
    it("minimum degree 0 keeps every file", () => {
      assert.equal(visibleNodeIds(index, filters({ minDegree: 0 })), null);
    });

    it("minimum degree 1 drops isolated files", () => {
      assert.deepEqual(ids(visibleNodeIds(index, filters({ minDegree: 1 }))), [A, B, C, E].sort());
    });

    it("a higher threshold narrows further", () => {
      assert.deepEqual(ids(visibleNodeIds(index, filters({ minDegree: 2 }))), [B]);
    });

    it("a threshold above the maximum degree produces an empty result", () => {
      assert.deepEqual(ids(visibleNodeIds(index, filters({ minDegree: 100 }))), []);
    });
  });

  describe("combined filters", () => {
    it("language and directory", () => {
      assert.deepEqual(ids(visibleNodeIds(index, filters({ language: "typescript", directory: "src/lib" }))), [B]);
    });

    it("language and isolated connectivity", () => {
      assert.deepEqual(
        ids(visibleNodeIds(index, filters({ language: "javascript", connectivity: "isolated" }))),
        [F],
      );
    });

    it("directory and degree", () => {
      assert.deepEqual(ids(visibleNodeIds(index, filters({ directory: "src/lib", minDegree: 2 }))), [B]);
    });

    it("every filter together", () => {
      assert.deepEqual(
        ids(
          visibleNodeIds(
            index,
            filters({ language: "typescript", directory: "src/lib", connectivity: "connected", minDegree: 1 }),
          ),
        ),
        [B],
      );
    });

    it("reset returns every node", () => {
      const reset = visibleNodeIds(index, DEFAULT_FILTERS);
      assert.equal(reset, null);
      assert.equal(filterCounts(index, reset).visible, filterCounts(index, reset).total);
    });
  });

  describe("determinism", () => {
    it("gives the same result regardless of node order", () => {
      const shuffledGraph = sample();
      const shuffledNodes = [...shuffledGraph.nodes].reverse();
      const shuffledIndex = buildGraphIndex({ ...shuffledGraph, nodes: shuffledNodes });

      const original = ids(visibleNodeIds(index, filters({ minDegree: 1 })));
      const shuffled = ids(visibleNodeIds(shuffledIndex, filters({ minDegree: 1 })));
      assert.deepEqual(shuffled, original);
      assert.deepEqual(directoryOptions(shuffledIndex), directoryOptions(index));
    });

    it("does not mutate the graph it reads from", () => {
      const graph = sample();
      const copy = structuredClone(graph);
      const graphIndex = buildGraphIndex(graph);

      visibleNodeIds(graphIndex, filters({ language: "typescript", minDegree: 1 }));
      directoryOptions(graphIndex);

      assert.deepEqual(graph, copy);
    });
  });
});

describe("isEdgeVisible", () => {
  const index = buildGraphIndex(sample());
  const visible = visibleNodeIds(index, filters({ directory: "src/lib" }))!;

  it("hides an edge whose source is filtered out", () => {
    assert.equal(isEdgeVisible(visible, A, B), false);
  });

  it("hides an edge whose target is filtered out", () => {
    assert.equal(isEdgeVisible(visible, E, B), false);
  });

  it("keeps an edge whose endpoints are both visible", () => {
    assert.equal(isEdgeVisible(visible, B, C), true);
  });

  it("treats every edge as visible when nothing is filtered", () => {
    assert.equal(isEdgeVisible(null, A, B), true);
  });
});

describe("resolveSelection", () => {
  const index = buildGraphIndex(sample());
  const visible = visibleNodeIds(index, filters({ directory: "src/lib" }))!;

  it("keeps a selection that is still visible", () => {
    assert.equal(resolveSelection(B, visible), B);
  });

  it("clears a selection that filters have hidden", () => {
    assert.equal(resolveSelection(A, visible), null);
  });

  it("keeps any selection when no filter is active", () => {
    assert.equal(resolveSelection(A, null), A);
  });

  it("leaves an empty selection alone", () => {
    assert.equal(resolveSelection(null, visible), null);
  });
});

describe("withinVisible (search)", () => {
  const index = buildGraphIndex(sample());

  it("search respects the active filters", () => {
    const visible = visibleNodeIds(index, filters({ directory: "src/lib" }))!;
    const results = withinVisible(searchFiles(index, "lib"), visible);
    assert.deepEqual(
      results.map((r) => r.id).sort(),
      [B, C].sort(),
    );
  });

  it("resetting filters restores every match", () => {
    const withFilter = withinVisible(searchFiles(index, "lib"), visibleNodeIds(index, filters({ directory: "src/lib" })));
    const withoutFilter = withinVisible(searchFiles(index, "lib"), visibleNodeIds(index, DEFAULT_FILTERS));

    assert.ok(withoutFilter.length > withFilter.length);
    assert.deepEqual(
      withoutFilter.map((r) => r.id).sort(),
      searchFiles(index, "lib").map((r) => r.id).sort(),
    );
  });
});

describe("filter state helpers", () => {
  it("counts how many filters are active", () => {
    assert.equal(activeFilterCount(DEFAULT_FILTERS), 0);
    assert.equal(activeFilterCount(filters({ language: "typescript" })), 1);
    assert.equal(
      activeFilterCount(filters({ language: "typescript", directory: "src/lib", connectivity: "connected", minDegree: 2 })),
      4,
    );
  });

  it("recognizes the default filter state", () => {
    assert.ok(isDefaultFilters(DEFAULT_FILTERS));
    assert.ok(!isDefaultFilters(filters({ directory: "src/lib" })));
    assert.equal(DEFAULT_FILTERS.directory, ALL_DIRECTORIES);
  });
});

describe("language filters for any language", () => {
  const graph = graphOf(
    [node("api/main.py", "python"), node("api/db.py", "python"), node("core/src/lib.rs", "rust"), node("web/app.ts", "typescript"), node("cli/main.go", "go")],
    [edge("api/main.py", "api/db.py")],
  );
  const index = buildGraphIndex(graph);

  it("offers only the languages present, in registry order", () => {
    assert.deepEqual(languageOptions(index), ["typescript", "python", "go", "rust"]);
    assert.deepEqual(languageOptions(buildGraphIndex(graphOf([node("a.c", "c"), node("b.cpp", "cpp")]))), ["c", "cpp"]);
  });

  it("filters by any language and combines with other filters", () => {
    assert.deepEqual([...visibleNodeIds(index, { ...DEFAULT_FILTERS, language: "python" })!].sort(), ["api/db.py", "api/main.py"]);
    assert.deepEqual([...visibleNodeIds(index, { ...DEFAULT_FILTERS, language: "rust" })!], ["core/src/lib.rs"]);
    assert.deepEqual([...visibleNodeIds(index, { ...DEFAULT_FILTERS, language: "python", minDegree: 1 })!].sort(), ["api/db.py", "api/main.py"]);
    assert.deepEqual([...visibleNodeIds(index, { ...DEFAULT_FILTERS, language: "swift" })!], []);
  });
});
