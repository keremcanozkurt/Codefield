import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { buildDependencyGraph, edgeId } from "../graph/build.ts";
import type { SourceExtension, SourceFile } from "../source-files.ts";
import { toGraphology } from "./graphology.ts";
import { layoutNodes } from "./layout.ts";
import { toRenderGraph } from "./payload.ts";
import type { RenderEdge, RenderGraph, RenderNode } from "./types.ts";

function node(path: string, degree = 0): RenderNode {
  const slash = path.lastIndexOf("/");
  return {
    id: path,
    path,
    directory: slash === -1 ? "" : path.slice(0, slash),
    language: /\.tsx?$/.test(path) ? "typescript" : "javascript",
    size: 100,
    incoming: 0,
    outgoing: 0,
    degree,
  };
}

function edge(source: string, target: string, weight = 1): RenderEdge {
  return { id: edgeId(source, target), source, target, weight };
}

function sample(): RenderGraph {
  return {
    nodes: [
      node("src/index.ts"),
      node("src/lib/parser.ts"),
      node("src/lib/tokens.ts"),
      node("README.js"),
    ],
    edges: [
      edge("src/index.ts", "src/lib/parser.ts", 2),
      edge("src/lib/parser.ts", "src/lib/tokens.ts"),
      edge("src/lib/tokens.ts", "src/lib/parser.ts"),
    ],
  };
}

function deepFreeze<T>(value: T): T {
  if (value !== null && typeof value === "object") {
    for (const child of Object.values(value)) deepFreeze(child);
    Object.freeze(value);
  }
  return value;
}

function sourceFile(path: string, content: string): SourceFile {
  const extension = path.slice(path.lastIndexOf(".")) as SourceExtension;
  return {
    path,
    sha: "0".repeat(40),
    size: content.length,
    extension,
    language: extension === ".ts" || extension === ".tsx" ? "typescript" : "javascript",
    content,
  };
}

describe("toGraphology", () => {
  it("creates a directed graph without multi edges or self loops", () => {
    const graph = toGraphology(sample());

    assert.equal(graph.type, "directed");
    assert.equal(graph.multi, false);
    assert.equal(graph.allowSelfLoops, false);
  });

  it("creates one node per Codefield node with the same ID", () => {
    const input = sample();
    const graph = toGraphology(input);

    assert.equal(graph.order, input.nodes.length);
    assert.deepEqual(
      graph.nodes(),
      input.nodes.map((n) => n.id),
    );
  });

  it("creates one edge per Codefield edge with the same ID and direction", () => {
    const input = sample();
    const graph = toGraphology(input);

    assert.equal(graph.size, input.edges.length);
    for (const e of input.edges) {
      assert.ok(graph.hasEdge(e.id), `missing edge ${e.id}`);
      assert.equal(graph.source(e.id), e.source);
      assert.equal(graph.target(e.id), e.target);
      assert.ok(graph.isDirected(e.id));
    }
    assert.ok(graph.hasDirectedEdge("src/lib/parser.ts", "src/lib/tokens.ts"));
    assert.ok(graph.hasDirectedEdge("src/lib/tokens.ts", "src/lib/parser.ts"));
    assert.ok(!graph.hasDirectedEdge("src/lib/parser.ts", "src/index.ts"));
  });

  it("keeps isolated nodes", () => {
    const graph = toGraphology(sample());

    assert.ok(graph.hasNode("README.js"));
    assert.equal(graph.degree("README.js"), 0);
  });

  it("sets only renderer attributes on nodes", () => {
    const graph = toGraphology(sample());

    graph.forEachNode((id, attributes) => {
      assert.deepEqual(Object.keys(attributes).sort(), ["color", "label", "size", "x", "y"]);
      assert.equal(typeof attributes.color, "string");
      assert.ok(attributes.size > 0);
    });
    assert.equal(graph.getNodeAttribute("src/lib/parser.ts", "label"), "parser.ts");
    assert.equal(graph.getNodeAttribute("README.js", "label"), "README.js");
  });

  it("uses the same size and color for every node", () => {
    const graph = toGraphology({
      nodes: [{ ...node("src/a.ts"), size: 10, degree: 0 }, { ...node("src/b.ts"), size: 90_000, degree: 40 }],
      edges: [],
    });

    assert.deepEqual(
      graph.getNodeAttributes("src/a.ts").size,
      graph.getNodeAttributes("src/b.ts").size,
    );
    assert.equal(
      graph.getNodeAttributes("src/a.ts").color,
      graph.getNodeAttributes("src/b.ts").color,
    );
  });

  it("sets only renderer attributes on edges, independent of weight", () => {
    const graph = toGraphology(sample());

    graph.forEachEdge((id, attributes) => {
      assert.deepEqual(Object.keys(attributes).sort(), ["color", "size"]);
    });
    const heavy = graph.getEdgeAttributes(edgeId("src/index.ts", "src/lib/parser.ts"));
    const light = graph.getEdgeAttributes(edgeId("src/lib/parser.ts", "src/lib/tokens.ts"));
    assert.deepEqual(heavy, light);
  });

  it("uses the deterministic layout for positions", () => {
    const input = sample();
    const graph = toGraphology(input);
    const positions = layoutNodes(input.nodes.map((n) => n.id));

    graph.forEachNode((id, { x, y }) => assert.deepEqual({ x, y }, positions.get(id)));
  });

  it("produces the same attributes regardless of input order", () => {
    const input = sample();
    const reordered = { nodes: [...input.nodes].reverse(), edges: [...input.edges].reverse() };
    const a = toGraphology(input);
    const b = toGraphology(reordered);

    a.forEachNode((id, attributes) => assert.deepEqual(b.getNodeAttributes(id), attributes));
    a.forEachEdge((id, attributes) => assert.deepEqual(b.getEdgeAttributes(id), attributes));
  });

  it("throws instead of creating a duplicate node", () => {
    const input = sample();
    input.nodes.push(node("src/index.ts"));

    assert.throws(() => toGraphology(input));
  });

  it("throws instead of creating a duplicate edge", () => {
    const duplicateId = sample();
    duplicateId.edges.push(edge("src/index.ts", "src/lib/parser.ts"));
    assert.throws(() => toGraphology(duplicateId));

    const duplicatePair = sample();
    duplicatePair.edges.push({ ...edge("src/index.ts", "src/lib/parser.ts"), id: "other" });
    assert.throws(() => toGraphology(duplicatePair));
  });

  it("throws on self loops and unknown endpoints", () => {
    const selfLoop = sample();
    selfLoop.edges.push(edge("src/index.ts", "src/index.ts"));
    assert.throws(() => toGraphology(selfLoop));

    const unknown = sample();
    unknown.edges.push(edge("src/index.ts", "src/missing.ts"));
    assert.throws(() => toGraphology(unknown));
  });

  it("does not modify its input", () => {
    const input = deepFreeze(sample());
    const copy = structuredClone(input);

    toGraphology(input);
    assert.deepEqual(input, copy);
  });

  it("handles a graph without nodes", () => {
    const graph = toGraphology({ nodes: [], edges: [] });

    assert.equal(graph.order, 0);
    assert.equal(graph.size, 0);
  });

  it("handles a graph without edges", () => {
    const graph = toGraphology({ nodes: [node("a.js"), node("b.js")], edges: [] });

    assert.equal(graph.order, 2);
    assert.equal(graph.size, 0);
  });

  it("handles one node", () => {
    const graph = toGraphology({ nodes: [node("index.ts")], edges: [] });

    assert.equal(graph.order, 1);
    const { x, y } = graph.getNodeAttributes("index.ts");
    assert.ok(Number.isFinite(x) && Number.isFinite(y));
  });

  it("handles two connected nodes", () => {
    const graph = toGraphology({
      nodes: [node("a.ts", 1), node("b.ts", 1)],
      edges: [edge("a.ts", "b.ts")],
    });

    assert.equal(graph.order, 2);
    assert.equal(graph.size, 1);
    assert.equal(graph.outDegree("a.ts"), 1);
    assert.equal(graph.inDegree("b.ts"), 1);
  });

  it("handles 500 nodes", () => {
    const nodes = Array.from({ length: 500 }, (_, i) => node(`src/dir-${i % 23}/file-${i}.ts`));
    const edges = nodes.slice(1).map((n, i) => edge(nodes[i].id, n.id));
    const graph = toGraphology({ nodes, edges });

    assert.equal(graph.order, 500);
    assert.equal(graph.size, 499);
    graph.forEachNode((id, { x, y }) => assert.ok(Number.isFinite(x) && Number.isFinite(y)));
  });
});

describe("dependency graph to Graphology", () => {
  const files = [
    sourceFile("src/index.ts", 'import { parse } from "./parser";\nconst SECRET_SOURCE_LINE = 1;'),
    sourceFile("src/parser.ts", 'export * from "./tokens";'),
    sourceFile("src/tokens.ts", "export const tokens = [];"),
    sourceFile("scripts/build.js", "console.log('isolated');"),
  ];
  const dependencyGraph = buildDependencyGraph(files, [
    { sourcePath: "src/index.ts", targetPath: "src/parser.ts", kind: "import", specifier: "./parser" },
    { sourcePath: "src/parser.ts", targetPath: "src/tokens.ts", kind: "reexport", specifier: "./tokens" },
  ]);

  it("converts a small dependency graph", () => {
    const graph = toGraphology(toRenderGraph(dependencyGraph));

    assert.deepEqual(graph.nodes(), dependencyGraph.nodes.map((n) => n.id));
    assert.deepEqual(graph.edges(), dependencyGraph.edges.map((e) => e.id));
    assert.ok(graph.hasNode("scripts/build.js"));
  });

  it("gives every node and edge the attributes Sigma reads", () => {
    const graph = toGraphology(toRenderGraph(dependencyGraph));

    graph.forEachNode((id, { x, y, size, color, label }) => {
      assert.equal(typeof x, "number");
      assert.equal(typeof y, "number");
      assert.ok(Number.isFinite(x) && Number.isFinite(y), id);
      assert.ok(Number.isFinite(size) && size > 0, id);
      assert.match(color, /^#[0-9a-f]{6}$/);
      assert.ok(label.length > 0);
    });
    graph.forEachEdge((id, { size, color }, source, target) => {
      assert.ok(Number.isFinite(size) && size > 0, id);
      assert.match(color, /^rgba\(\d+, \d+, \d+, (0|1|0?\.\d+)\)$/);
      assert.ok(graph.hasNode(source) && graph.hasNode(target));
    });
  });

  it("does not copy source content into the graph", () => {
    const json = JSON.stringify(toGraphology(toRenderGraph(dependencyGraph)).export());

    assert.ok(!json.includes("SECRET_SOURCE_LINE"));
    assert.ok(!json.includes("console.log"));
    assert.ok(!json.includes('"content"'));
    assert.ok(!json.includes("./tokens"));
  });

  it("does not modify the dependency graph", () => {
    const copy = structuredClone(dependencyGraph);

    toGraphology(toRenderGraph(dependencyGraph));
    assert.deepEqual(dependencyGraph, copy);
  });
});
