import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { edgeId } from "../graph/build.ts";
import { DEFAULT_FILTERS, visibleNodeIds } from "./filters.ts";
import { focusEdge, focusNode, type FocusState } from "./focus.ts";
import { traceImpact } from "./impact.ts";
import { buildGraphIndex, neighborhood } from "./inspection.ts";
import { edgeStyle, nodeStyle } from "./mapping.ts";
import { describePath, findPath, pathEdgeKey, pathView } from "./path.ts";
import type { EdgeAttributes, NodeAttributes, RenderGraph, RenderNode } from "./types.ts";

function node(path: string): RenderNode {
  const slash = path.lastIndexOf("/");
  const language = path.endsWith(".py") ? "python" : path.endsWith(".rs") ? "rust" : "typescript";
  return { id: path, path, directory: slash === -1 ? "" : path.slice(0, slash), language, size: 1_000, incoming: 0, outgoing: 0, degree: 0 };
}

// An edge from -> to: `from` depends on `to`.
function graphOf(paths: string[], edges: [string, string][]): RenderGraph {
  return {
    nodes: paths.map(node),
    edges: edges.map(([from, to]) => ({ id: edgeId(from, to), source: from, target: to, weight: 1, kinds: ["import"] })),
  };
}

function path(graph: RenderGraph, from: string, to: string) {
  return findPath(buildGraphIndex(graph), from, to)?.files;
}

// page.tsx -> actions.ts -> service.ts -> repository.ts -> database.ts
const chain = graphOf(
  ["app/page.tsx", "app/actions.ts", "lib/service.ts", "lib/repository.ts", "lib/database.ts"],
  [
    ["app/page.tsx", "app/actions.ts"],
    ["app/actions.ts", "lib/service.ts"],
    ["lib/service.ts", "lib/repository.ts"],
    ["lib/repository.ts", "lib/database.ts"],
  ],
);

describe("findPath", () => {
  it("follows dependencies from source to target", () => {
    assert.deepEqual(path(chain, "app/page.tsx", "lib/database.ts"), [
      "app/page.tsx",
      "app/actions.ts",
      "lib/service.ts",
      "lib/repository.ts",
      "lib/database.ts",
    ]);
  });

  it("finds a direct dependency as a one-step path", () => {
    assert.deepEqual(path(chain, "lib/service.ts", "lib/repository.ts"), ["lib/service.ts", "lib/repository.ts"]);
  });

  it("does not count the reverse direction", () => {
    assert.equal(path(chain, "lib/database.ts", "app/page.tsx"), null);
    assert.equal(path(chain, "lib/repository.ts", "lib/service.ts"), null);
  });

  it("returns the shortest path when a longer one exists", () => {
    const graph = graphOf(["a.ts", "b.ts", "c.ts", "d.ts"], [["a.ts", "b.ts"], ["b.ts", "c.ts"], ["c.ts", "d.ts"], ["a.ts", "d.ts"]]);

    assert.deepEqual(path(graph, "a.ts", "d.ts"), ["a.ts", "d.ts"]);
  });

  it("chooses among equal shortest paths by path order, regardless of input order", () => {
    const paths = ["a.ts", "m/y.ts", "m/x.ts", "t.ts"];
    const edges: [string, string][] = [["a.ts", "m/y.ts"], ["a.ts", "m/x.ts"], ["m/y.ts", "t.ts"], ["m/x.ts", "t.ts"]];

    assert.deepEqual(path(graphOf(paths, edges), "a.ts", "t.ts"), ["a.ts", "m/x.ts", "t.ts"]);
    assert.deepEqual(path(graphOf([...paths].reverse(), [...edges].reverse()), "a.ts", "t.ts"), ["a.ts", "m/x.ts", "t.ts"]);
  });

  it("is safe with cycles", () => {
    const graph = graphOf(["a.ts", "b.ts", "c.ts", "d.ts"], [["a.ts", "b.ts"], ["b.ts", "c.ts"], ["c.ts", "a.ts"], ["c.ts", "d.ts"]]);

    assert.deepEqual(path(graph, "b.ts", "a.ts"), ["b.ts", "c.ts", "a.ts"]);
    assert.deepEqual(path(graph, "a.ts", "d.ts"), ["a.ts", "b.ts", "c.ts", "d.ts"]);
    assert.equal(path(graph, "d.ts", "a.ts"), null);
  });

  it("reports no path between disconnected files", () => {
    const graph = graphOf(["a.ts", "b.ts", "x.ts", "y.ts", "lonely.ts"], [["a.ts", "b.ts"], ["x.ts", "y.ts"]]);

    assert.equal(path(graph, "a.ts", "y.ts"), null);
    assert.equal(path(graph, "lonely.ts", "a.ts"), null);
  });

  it("treats the same file as a zero-step path", () => {
    assert.deepEqual(path(chain, "lib/service.ts", "lib/service.ts"), ["lib/service.ts"]);
  });

  it("returns null for a missing file", () => {
    const index = buildGraphIndex(chain);

    assert.equal(findPath(index, "missing.ts", "lib/service.ts"), null);
    assert.equal(findPath(index, "lib/service.ts", null), null);
  });

  it("works the same for any language", () => {
    const graph = graphOf(["app/main.py", "app/db.py", "core/src/lib.rs"], [["app/main.py", "app/db.py"]]);

    assert.deepEqual(path(graph, "app/main.py", "app/db.py"), ["app/main.py", "app/db.py"]);
  });
});

describe("describePath", () => {
  const index = buildGraphIndex(chain);

  it("lists the files and steps", () => {
    const details = describePath(index, findPath(index, "app/page.tsx", "lib/database.ts")!, null);

    assert.equal(details.steps, 4);
    assert.equal(details.hidden, 0);
    assert.deepEqual(details.files!.map((file) => file.name), ["page.tsx", "actions.ts", "service.ts", "repository.ts", "database.ts"]);
  });

  it("finds the true path through files hidden by filters, and counts them", () => {
    const visible = visibleNodeIds(index, { ...DEFAULT_FILTERS, directory: "lib" });
    const result = findPath(index, "app/page.tsx", "lib/database.ts")!;
    const details = describePath(index, result, visible);

    assert.equal(details.steps, 4);
    assert.equal(details.hidden, 2);
    assert.deepEqual(details.files!.filter((f) => f.hidden).map((f) => f.id), ["app/page.tsx", "app/actions.ts"]);
    assert.deepEqual(findPath(buildGraphIndex(chain), "app/page.tsx", "lib/database.ts"), result);
  });

  it("describes a missing path", () => {
    const details = describePath(index, findPath(index, "lib/database.ts", "app/page.tsx")!, null);

    assert.deepEqual(details, { sourceName: "database.ts", targetName: "page.tsx", files: null, steps: 0, hidden: 0 });
  });
});

describe("path rendering", () => {
  const index = buildGraphIndex(chain);
  const result = findPath(index, "app/actions.ts", "lib/repository.ts")!;
  const selected: FocusState = { neighborhood: neighborhood(index, "app/actions.ts"), hovered: null, labelAll: false, visible: null };
  const withPath: FocusState = { ...selected, path: pathView(result) };
  const edgeData: EdgeAttributes = edgeStyle(chain.edges[0]);

  function attributes(id: string): NodeAttributes {
    return { x: 0, y: 0, ...nodeStyle(chain.nodes.find((n) => n.id === id)!) };
  }

  function brightness(color: string): number {
    const value = Number.parseInt(color.slice(1), 16);
    return ((value >> 16) & 0xff) + ((value >> 8) & 0xff) + (value & 0xff);
  }

  it("emphasizes the source, destination and files between, and fades the rest", () => {
    const source = focusNode("app/actions.ts", attributes("app/actions.ts"), withPath);
    const middle = focusNode("lib/service.ts", attributes("lib/service.ts"), withPath);
    const target = focusNode("lib/repository.ts", attributes("lib/repository.ts"), withPath);
    const outside = focusNode("app/page.tsx", attributes("app/page.tsx"), withPath);

    assert.equal(source.highlighted, true);
    assert.equal(target.highlighted, true);
    assert.ok(source.size > attributes("app/actions.ts").size && target.size > attributes("lib/repository.ts").size);
    assert.equal(middle.forceLabel, true);
    assert.ok(brightness(middle.color) > brightness(outside.color));
    assert.equal(outside.label, null);
    assert.equal(outside.x, 0);
  });

  it("emphasizes only the edges on the path", () => {
    const onPath = focusEdge("app/actions.ts", "lib/service.ts", edgeData, withPath);
    const offPath = focusEdge("app/page.tsx", "app/actions.ts", edgeData, withPath);

    assert.equal(onPath.zIndex, 2);
    assert.equal(offPath.zIndex, 0);
    assert.ok(pathView(result).edges.has(pathEdgeKey("lib/service.ts", "lib/repository.ts")));
  });

  it("still shows source and destination when there is no path", () => {
    const none = pathView(findPath(index, "lib/database.ts", "app/page.tsx")!);
    const state: FocusState = { ...selected, path: none };

    assert.equal(focusNode("lib/database.ts", attributes("lib/database.ts"), state).highlighted, true);
    assert.equal(focusNode("app/page.tsx", attributes("app/page.tsx"), state).highlighted, true);
    assert.equal(focusNode("lib/service.ts", attributes("lib/service.ts"), state).label, null);
  });

  it("keeps hiding filtered files and takes precedence over impact styling", () => {
    const filtered: FocusState = { ...withPath, visible: new Set(["app/actions.ts", "lib/repository.ts"]), impact: traceImpact(index, "app/actions.ts") };

    assert.equal(focusNode("lib/service.ts", attributes("lib/service.ts"), filtered).hidden, true);
    assert.equal(focusEdge("app/actions.ts", "lib/service.ts", edgeData, filtered).hidden, true);
    assert.equal(focusNode("lib/repository.ts", attributes("lib/repository.ts"), filtered).highlighted, true);
  });
});
