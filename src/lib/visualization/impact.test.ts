import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { edgeId } from "../graph/build.ts";
import { DEFAULT_FILTERS, visibleNodeIds } from "./filters.ts";
import { focusEdge, focusNode, impactStrength, type FocusState } from "./focus.ts";
import {
  describeImpact,
  directDependentCount,
  maxDependencyDepth,
  propagationDepth,
  traceImpact,
  type Impact,
} from "./impact.ts";
import { buildGraphIndex, neighborhood } from "./inspection.ts";
import { edgeStyle, nodeStyle } from "./mapping.ts";
import { FOCUS } from "./theme.ts";
import type { EdgeAttributes, NodeAttributes, RenderEdge, RenderGraph, RenderNode } from "./types.ts";

function node(path: string): RenderNode {
  const slash = path.lastIndexOf("/");
  return {
    id: path,
    path,
    directory: slash === -1 ? "" : path.slice(0, slash),
    language: /\.tsx?$/.test(path) ? "typescript" : "javascript",
    size: 2_000,
    incoming: 0,
    outgoing: 0,
    degree: 0,
  };
}

// An edge from -> to: `from` imports `to`.
function edge(from: string, to: string): RenderEdge {
  return { id: edgeId(from, to), source: from, target: to, weight: 1, kinds: ["import"] };
}

function graphOf(paths: string[], edges: [string, string][]): RenderGraph {
  const renderEdges = edges.map(([from, to]) => edge(from, to));
  return {
    nodes: paths.map((path) => {
      const outgoing = renderEdges.filter((e) => e.source === path).length;
      const incoming = renderEdges.filter((e) => e.target === path).length;
      return { ...node(path), outgoing, incoming, degree: outgoing + incoming };
    }),
    edges: renderEdges,
  };
}

function trace(graph: RenderGraph, id: string): Impact {
  const impact = traceImpact(buildGraphIndex(graph), id);
  assert.ok(impact !== null);
  return impact;
}

function depthsOf(impact: Impact): Record<string, number> {
  return Object.fromEntries(impact.depths);
}

// page.tsx -> service.ts -> repository.ts -> database.ts
const chain = graphOf(
  ["app/page.tsx", "lib/service.ts", "lib/repository.ts", "lib/database.ts"],
  [
    ["app/page.tsx", "lib/service.ts"],
    ["lib/service.ts", "lib/repository.ts"],
    ["lib/repository.ts", "lib/database.ts"],
  ],
);

describe("traceImpact", () => {
  it("follows edges backwards, from a file to the files that import it", () => {
    const impact = trace(chain, "lib/database.ts");

    assert.deepEqual(impact.levels, [["lib/repository.ts"], ["lib/service.ts"], ["app/page.tsx"]]);
    assert.deepEqual(depthsOf(impact), { "lib/repository.ts": 1, "lib/service.ts": 2, "app/page.tsx": 3 });
    assert.equal(maxDependencyDepth(impact), 3);
  });

  it("does not follow a file's own imports", () => {
    const impact = trace(chain, "app/page.tsx");

    assert.equal(impact.depths.size, 0);
    assert.deepEqual(impact.levels, []);
    assert.equal(maxDependencyDepth(impact), 0);

    const middle = trace(chain, "lib/service.ts");
    assert.deepEqual(depthsOf(middle), { "app/page.tsx": 1 });
  });

  it("finds a single direct dependent", () => {
    const impact = trace(graphOf(["a.ts", "b.ts"], [["a.ts", "b.ts"]]), "b.ts");

    assert.deepEqual(depthsOf(impact), { "a.ts": 1 });
    assert.equal(directDependentCount(impact), 1);
    assert.equal(maxDependencyDepth(impact), 1);
  });

  it("finds several direct dependents, sorted by path", () => {
    const graph = graphOf(
      ["t.ts", "src/c.ts", "a.ts", "src/b.ts"],
      [
        ["src/c.ts", "t.ts"],
        ["a.ts", "t.ts"],
        ["src/b.ts", "t.ts"],
      ],
    );
    const impact = trace(graph, "t.ts");

    assert.deepEqual(impact.levels, [["a.ts", "src/b.ts", "src/c.ts"]]);
    assert.equal(directDependentCount(impact), 3);
    assert.equal(impact.depths.size, 3);
  });

  it("propagates through a branching graph level by level", () => {
    // p, q -> x -> t; r -> y -> t; s -> p
    const graph = graphOf(
      ["t.ts", "x.ts", "y.ts", "p.ts", "q.ts", "r.ts", "s.ts"],
      [
        ["x.ts", "t.ts"],
        ["y.ts", "t.ts"],
        ["p.ts", "x.ts"],
        ["q.ts", "x.ts"],
        ["r.ts", "y.ts"],
        ["s.ts", "p.ts"],
      ],
    );
    const impact = trace(graph, "t.ts");

    assert.deepEqual(impact.levels, [["x.ts", "y.ts"], ["p.ts", "q.ts", "r.ts"], ["s.ts"]]);
    assert.equal(directDependentCount(impact), 2);
    assert.equal(impact.depths.size, 6);
    assert.equal(maxDependencyDepth(impact), 3);
  });

  it("handles cycles without revisiting files or counting the source", () => {
    // a -> b -> c -> a, and d -> c
    const graph = graphOf(
      ["a.ts", "b.ts", "c.ts", "d.ts"],
      [
        ["a.ts", "b.ts"],
        ["b.ts", "c.ts"],
        ["c.ts", "a.ts"],
        ["d.ts", "c.ts"],
      ],
    );

    assert.deepEqual(depthsOf(trace(graph, "a.ts")), { "c.ts": 1, "b.ts": 2, "d.ts": 2 });
    assert.deepEqual(depthsOf(trace(graph, "c.ts")), { "b.ts": 1, "d.ts": 1, "a.ts": 2 });
  });

  it("handles two files that import each other", () => {
    const impact = trace(graphOf(["a.ts", "b.ts"], [["a.ts", "b.ts"], ["b.ts", "a.ts"]]), "a.ts");

    assert.deepEqual(depthsOf(impact), { "b.ts": 1 });
  });

  it("ignores self-references", () => {
    const graph: RenderGraph = { nodes: [node("a.ts"), node("b.ts")], edges: [edge("a.ts", "a.ts"), edge("b.ts", "a.ts")] };

    assert.deepEqual(depthsOf(trace(graph, "a.ts")), { "b.ts": 1 });
  });

  it("leaves out files in other components of the graph", () => {
    const graph = graphOf(
      ["a.ts", "b.ts", "other/x.ts", "other/y.ts", "lonely.ts"],
      [
        ["a.ts", "b.ts"],
        ["other/x.ts", "other/y.ts"],
      ],
    );

    assert.deepEqual(depthsOf(trace(graph, "b.ts")), { "a.ts": 1 });
    assert.deepEqual(depthsOf(trace(graph, "other/y.ts")), { "other/x.ts": 1 });
  });

  it("returns an empty result for an isolated file", () => {
    const impact = trace(graphOf(["a.ts", "b.ts", "lonely.ts"], [["a.ts", "b.ts"]]), "lonely.ts");

    assert.equal(impact.source, "lonely.ts");
    assert.equal(impact.depths.size, 0);
    assert.deepEqual(impact.levels, []);
    assert.equal(directDependentCount(impact), 0);
    assert.equal(maxDependencyDepth(impact), 0);
  });

  it("counts a file reached along several paths once, at its shortest depth", () => {
    // p -> x -> t, p -> y -> t, and p -> t directly; q -> x and q -> y.
    const graph = graphOf(
      ["t.ts", "x.ts", "y.ts", "p.ts", "q.ts"],
      [
        ["x.ts", "t.ts"],
        ["y.ts", "t.ts"],
        ["p.ts", "x.ts"],
        ["p.ts", "y.ts"],
        ["p.ts", "t.ts"],
        ["q.ts", "x.ts"],
        ["q.ts", "y.ts"],
      ],
    );
    const impact = trace(graph, "t.ts");

    assert.deepEqual(impact.levels, [["p.ts", "x.ts", "y.ts"], ["q.ts"]]);
    assert.equal(impact.depths.size, 4);
  });

  it("merges duplicate edges between the same files", () => {
    const graph: RenderGraph = {
      nodes: [node("a.ts"), node("b.ts")],
      edges: [edge("a.ts", "b.ts"), { ...edge("a.ts", "b.ts"), kinds: ["reexport"] }],
    };

    assert.deepEqual(trace(graph, "b.ts").levels, [["a.ts"]]);
  });

  it("is deterministic regardless of node and edge order", () => {
    const paths = ["t.ts", "src/x.ts", "src/y.ts", "lib/p.ts", "q.ts", "r.ts"];
    const edges: [string, string][] = [
      ["src/x.ts", "t.ts"],
      ["src/y.ts", "t.ts"],
      ["lib/p.ts", "src/x.ts"],
      ["q.ts", "src/y.ts"],
      ["r.ts", "src/x.ts"],
      ["r.ts", "src/y.ts"],
    ];
    const forward = trace(graphOf(paths, edges), "t.ts");
    const reversed = trace(graphOf([...paths].reverse(), [...edges].reverse()), "t.ts");

    assert.deepEqual(reversed.levels, forward.levels);
    assert.deepEqual([...reversed.depths], [...forward.depths]);
    assert.deepEqual(forward.levels, [["src/x.ts", "src/y.ts"], ["lib/p.ts", "q.ts", "r.ts"]]);
  });

  it("returns null without a known source", () => {
    const index = buildGraphIndex(chain);

    assert.equal(traceImpact(index, null), null);
    assert.equal(traceImpact(index, "missing.ts"), null);
  });
});

describe("propagationDepth", () => {
  // a -> b -> t, c -> t, b -> c, t -> u; t is the source.
  const graph = graphOf(
    ["t.ts", "a.ts", "b.ts", "c.ts", "u.ts", "z.ts"],
    [
      ["a.ts", "b.ts"],
      ["b.ts", "t.ts"],
      ["c.ts", "t.ts"],
      ["b.ts", "c.ts"],
      ["t.ts", "u.ts"],
    ],
  );
  const impact = trace(graph, "t.ts");

  it("returns the dependent's depth for edges that step outwards from the source", () => {
    assert.equal(propagationDepth(impact, "b.ts", "t.ts"), 1);
    assert.equal(propagationDepth(impact, "c.ts", "t.ts"), 1);
    assert.equal(propagationDepth(impact, "a.ts", "b.ts"), 2);
  });

  it("returns null for edges that do not carry the trace outwards", () => {
    // Both files are direct dependents.
    assert.equal(propagationDepth(impact, "b.ts", "c.ts"), null);
    // The source's own import, and an edge the trace never reaches.
    assert.equal(propagationDepth(impact, "t.ts", "u.ts"), null);
    assert.equal(propagationDepth(impact, "z.ts", "t.ts"), null);
  });

  it("returns null for the edge that closes a cycle back into the source", () => {
    const cycle = trace(graphOf(["a.ts", "b.ts"], [["a.ts", "b.ts"], ["b.ts", "a.ts"]]), "a.ts");

    assert.equal(propagationDepth(cycle, "b.ts", "a.ts"), 1);
    assert.equal(propagationDepth(cycle, "a.ts", "b.ts"), null);
  });
});

describe("describeImpact", () => {
  const graph = graphOf(
    ["lib/db.ts", "lib/repo.ts", "lib/service.ts", "app/page.tsx", "app/layout.tsx", "scripts/seed.js"],
    [
      ["lib/repo.ts", "lib/db.ts"],
      ["scripts/seed.js", "lib/db.ts"],
      ["lib/service.ts", "lib/repo.ts"],
      ["app/page.tsx", "lib/service.ts"],
      ["app/layout.tsx", "lib/service.ts"],
    ],
  );
  const index = buildGraphIndex(graph);

  it("summarizes the trace and groups files by depth", () => {
    const details = describeImpact(index, traceImpact(index, "lib/db.ts")!, null);

    assert.equal(details.direct, 2);
    assert.equal(details.affected, 5);
    assert.equal(details.maxDepth, 3);
    assert.equal(details.visibleAffected, null);
    assert.deepEqual(details.levels, [
      {
        depth: 1,
        files: [
          { id: "lib/repo.ts", name: "repo.ts", directory: "lib" },
          { id: "scripts/seed.js", name: "seed.js", directory: "scripts" },
        ],
      },
      { depth: 2, files: [{ id: "lib/service.ts", name: "service.ts", directory: "lib" }] },
      {
        depth: 3,
        files: [
          { id: "app/layout.tsx", name: "layout.tsx", directory: "app" },
          { id: "app/page.tsx", name: "page.tsx", directory: "app" },
        ],
      },
    ]);
  });

  it("describes a file without dependents", () => {
    const details = describeImpact(index, traceImpact(index, "app/page.tsx")!, null);

    assert.deepEqual(details, { direct: 0, affected: 0, maxDepth: 0, visibleAffected: null, levels: [] });
  });

  it("counts visible files under filters without changing the trace", () => {
    const unfiltered = traceImpact(index, "lib/db.ts")!;
    const visible = visibleNodeIds(index, { ...DEFAULT_FILTERS, directory: "lib" });
    const details = describeImpact(index, unfiltered, visible);

    assert.deepEqual([...visible!].sort(), ["lib/db.ts", "lib/repo.ts", "lib/service.ts"]);
    assert.equal(details.affected, 5);
    assert.equal(details.direct, 2);
    assert.equal(details.maxDepth, 3);
    assert.equal(details.visibleAffected, 2);
    assert.deepEqual(
      details.levels.map((level) => level.files.map((file) => file.id)),
      unfiltered.levels,
    );
  });

  it("traces through files a filter hides", () => {
    // lib/service.ts is reached only through lib/repo.ts; hiding repo.ts does
    // not cut the trace, because impact always uses the full graph.
    const visible = visibleNodeIds(index, { ...DEFAULT_FILTERS, directory: "app" });
    const impact = traceImpact(index, "lib/db.ts")!;

    assert.equal(impact.depths.get("app/page.tsx"), 3);
    assert.equal(describeImpact(index, impact, visible).visibleAffected, 2);
    assert.deepEqual(traceImpact(buildGraphIndex(graph), "lib/db.ts"), impact);
  });
});

describe("impact rendering", () => {
  // a -> b -> t -> u, c -> t, lonely stands alone.
  const graph = graphOf(
    ["t.ts", "a.ts", "b.ts", "c.ts", "u.ts", "lonely.ts"],
    [
      ["a.ts", "b.ts"],
      ["b.ts", "t.ts"],
      ["c.ts", "t.ts"],
      ["t.ts", "u.ts"],
    ],
  );
  const index = buildGraphIndex(graph);
  const impact = traceImpact(index, "t.ts")!;
  const selectedT: FocusState = { neighborhood: neighborhood(index, "t.ts"), hovered: null, labelAll: false, visible: null };
  const impactT: FocusState = { ...selectedT, impact };
  const edgeData: EdgeAttributes = edgeStyle(edge("x", "y"));

  function attributes(id: string): NodeAttributes {
    return { x: 0, y: 0, ...nodeStyle(graph.nodes.find((n) => n.id === id)!) };
  }

  function brightness(color: string): number {
    const value = Number.parseInt(color.slice(1), 16);
    return ((value >> 16) & 0xff) + ((value >> 8) & 0xff) + (value & 0xff);
  }

  function opacity(color: string): number {
    return Number(/, ([\d.]+)\)$/.exec(color)![1]);
  }

  it("shows the source like a selected file", () => {
    assert.deepEqual(focusNode("t.ts", attributes("t.ts"), impactT), focusNode("t.ts", attributes("t.ts"), selectedT));
  });

  it("dims affected files with depth but keeps them brighter than unaffected ones", () => {
    const direct = focusNode("b.ts", attributes("b.ts"), impactT);
    const second = focusNode("a.ts", attributes("a.ts"), impactT);
    const unaffected = focusNode("lonely.ts", attributes("lonely.ts"), impactT);

    // Compared on the same file so file size and degree do not interfere.
    const bAtDepth2 = focusNode("b.ts", attributes("b.ts"), {
      ...impactT,
      impact: { source: "t.ts", depths: new Map([["b.ts", 2]]), levels: [[], ["b.ts"]] },
    });
    assert.ok(brightness(direct.color) > brightness(bAtDepth2.color));
    assert.ok(brightness(second.color) > brightness(unaffected.color));
    assert.equal(unaffected.label, null);
    assert.equal(direct.forceLabel, true);
    assert.equal(second.zIndex, 1);
    assert.equal(second.size, attributes("a.ts").size);
  });

  it("fades the source's own imports, which a change to it does not reach", () => {
    const imported = focusNode("u.ts", attributes("u.ts"), impactT);
    const asNeighbor = focusNode("u.ts", attributes("u.ts"), selectedT);

    assert.equal(imported.label, null);
    assert.ok(brightness(imported.color) < brightness(asNeighbor.color));
    assert.equal(focusEdge("t.ts", "u.ts", edgeData, impactT).zIndex, 0);
  });

  it("emphasizes propagation edges less with each level", () => {
    const first = focusEdge("b.ts", "t.ts", edgeData, impactT);
    const second = focusEdge("a.ts", "b.ts", edgeData, impactT);

    assert.ok(opacity(first.color) > opacity(second.color));
    assert.ok(opacity(second.color) > FOCUS.contextEdgeOpacity);
    assert.ok(first.size >= second.size);
    assert.equal(first.zIndex, 1);
  });

  it("keeps hiding files and edges that filters exclude", () => {
    const filtered: FocusState = { ...impactT, visible: new Set(["t.ts", "b.ts"]) };

    assert.equal(focusNode("a.ts", attributes("a.ts"), filtered).hidden, true);
    assert.equal(focusEdge("a.ts", "b.ts", edgeData, filtered).hidden, true);
    assert.equal(focusNode("b.ts", attributes("b.ts"), filtered).hidden, undefined);
  });

  it("only adds a label when hovering", () => {
    const hovered: FocusState = { ...impactT, hovered: "lonely.ts" };

    assert.equal(focusNode("lonely.ts", attributes("lonely.ts"), hovered).highlighted, true);
    assert.deepEqual(focusNode("b.ts", attributes("b.ts"), hovered), focusNode("b.ts", attributes("b.ts"), impactT));
  });

  it("reduces strength with depth down to a floor", () => {
    const strengths = [1, 2, 3, 4, 5, 10].map(impactStrength);

    assert.equal(strengths[0], 1);
    for (let i = 1; i < strengths.length; i++) assert.ok(strengths[i] <= strengths[i - 1]);
    assert.ok(strengths.at(-1)! > 0);
  });
});
