import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { buildDependencyGraph, edgeId } from "../graph/build.ts";
import type { SourceExtension, SourceFile } from "../source-files.ts";
import { toGraphology } from "./graphology.ts";
import { initialCameraRatio } from "./focus.ts";
import { layoutConstellation } from "./layout.ts";
import { edgeStyle, fileSizeToNodeSize, nodeColor, nodeStyle } from "./mapping.ts";
import { toRenderGraph } from "./payload.ts";
import { NODE } from "./theme.ts";
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
  return { id: edgeId(source, target), source, target, weight, kinds: ["import"] };
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

  it("sizes nodes by file size", () => {
    const graph = toGraphology({
      nodes: [
        { ...node("src/small.ts"), size: 200 },
        { ...node("src/medium.ts"), size: 5_000 },
        { ...node("src/large.ts"), size: 60_000 },
      ],
      edges: [],
    });
    const size = (id: string) => graph.getNodeAttribute(id, "size");

    assert.ok(size("src/medium.ts") > size("src/small.ts"));
    assert.ok(size("src/large.ts") > size("src/medium.ts"));
    assert.equal(size("src/medium.ts"), fileSizeToNodeSize(5_000));
  });

  it("emphasizes connected nodes without letting degree set the size", () => {
    const graph = toGraphology({
      nodes: [
        { ...node("src/isolated.ts", 0), size: 3_000 },
        { ...node("src/hub.ts", 40), size: 3_000 },
        { ...node("src/big.ts", 0), size: 60_000 },
      ],
      edges: [],
    });
    const isolated = graph.getNodeAttributes("src/isolated.ts");
    const hub = graph.getNodeAttributes("src/hub.ts");

    assert.ok(hub.size > isolated.size);
    assert.ok(hub.size <= isolated.size * (1 + NODE.degreeSizeBoost) + 1e-9);
    assert.ok(hub.size < graph.getNodeAttribute("src/big.ts", "size"));
    assert.equal(hub.color, nodeColor("typescript", 1));
    assert.equal(isolated.color, nodeColor("typescript", 0));
  });

  it("colors nodes by language", () => {
    const graph = toGraphology({ nodes: [node("src/a.ts"), node("src/b.js")], edges: [] });

    assert.equal(graph.getNodeAttribute("src/a.ts", "color"), nodeColor("typescript", 0));
    assert.equal(graph.getNodeAttribute("src/b.js", "color"), nodeColor("javascript", 0));
  });

  it("keeps isolated nodes visible", () => {
    const graph = toGraphology({ nodes: [{ ...node("src/empty.ts", 0), size: 0 }], edges: [] });
    const { size, color } = graph.getNodeAttributes("src/empty.ts");

    assert.equal(size, NODE.minSize);
    assert.equal(color, nodeColor("typescript", 0));
  });

  it("sets only renderer attributes on edges", () => {
    const graph = toGraphology(sample());

    graph.forEachEdge((id, attributes) => {
      assert.deepEqual(Object.keys(attributes).sort(), ["color", "size"]);
    });
  });

  it("emphasizes edges that combine several relationships", () => {
    const graph = toGraphology(sample());
    const heavy = graph.getEdgeAttributes(edgeId("src/index.ts", "src/lib/parser.ts"));
    const light = graph.getEdgeAttributes(edgeId("src/lib/parser.ts", "src/lib/tokens.ts"));

    assert.ok(heavy.size > light.size);
    assert.notEqual(heavy.color, light.color);
    assert.deepEqual(light, edgeStyle({ id: "x", source: "a", target: "b", weight: 1, kinds: ["import"] }));
  });

  it("never forces labels on", () => {
    const graph = toGraphology(sample());

    graph.forEachNode((id, attributes) => assert.ok(!("forceLabel" in attributes)));
  });

  it("uses the constellation layout for positions and stores its frame", () => {
    const input = sample();
    const graph = toGraphology(input);
    const layout = layoutConstellation(input);

    graph.forEachNode((id, { x, y }) => assert.deepEqual({ x, y }, layout.positions.get(id)));
    assert.deepEqual(graph.getAttributes(), {
      frame: layout.frame,
      initialRatio: initialCameraRatio(layout.bounds, layout.frame),
    });
  });

  it("changes only positions, not the visual mapping", () => {
    const input = sample();
    const graph = toGraphology(input);

    for (const n of input.nodes) {
      const { x, y, ...style } = graph.getNodeAttributes(n.id);
      assert.ok(Number.isFinite(x) && Number.isFinite(y));
      assert.deepEqual(style, nodeStyle(n));
    }
  });

  it("produces the same attributes regardless of input order", () => {
    const input = sample();
    const reordered = { nodes: [...input.nodes].reverse(), edges: [...input.edges].reverse() };
    const a = toGraphology(input);
    const b = toGraphology(reordered);

    a.forEachNode((id, attributes) => assert.deepEqual(b.getNodeAttributes(id), attributes));
    a.forEachEdge((id, attributes) => assert.deepEqual(b.getEdgeAttributes(id), attributes));
  });

  it("produces the same attributes for shuffled nodes and edges", () => {
    const nodes = Array.from({ length: 60 }, (_, i) => ({
      ...node(`src/dir-${i % 7}/file-${i}.${i % 3 === 0 ? "js" : "ts"}`, i % 9),
      size: (i * 7919) % 70_000,
    }));
    const edges = nodes.slice(1).map((n, i) => edge(nodes[i].id, n.id, (i % 5) + 1));
    const reference = toGraphology({ nodes, edges });
    const shuffledNodes = toGraphology({ nodes: shuffled(nodes, 3), edges });
    const shuffledEdges = toGraphology({ nodes, edges: shuffled(edges, 11) });

    for (const graph of [shuffledNodes, shuffledEdges]) {
      reference.forEachNode((id, attributes) => assert.deepEqual(graph.getNodeAttributes(id), attributes));
      reference.forEachEdge((id, attributes) => assert.deepEqual(graph.getEdgeAttributes(id), attributes));
    }
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
    const { x, y, size } = graph.getNodeAttributes("index.ts");
    assert.ok(Number.isFinite(x) && Number.isFinite(y));
    assert.ok(size >= NODE.minSize);
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
    graph.forEachNode((id, { size }) => assert.ok(size >= NODE.minSize));
    assert.ok(graph.getEdgeAttribute(edgeId("a.ts", "b.ts"), "size") > 0);
  });

  it("handles 500 nodes", () => {
    const nodes = Array.from({ length: 500 }, (_, i) => ({
      ...node(`src/dir-${i % 23}/file-${i}.${i % 4 === 0 ? "js" : "ts"}`, i % 40),
      size: (i * 104_729) % 520_000,
    }));
    const edges = nodes.slice(1).map((n, i) => edge(nodes[i].id, n.id, (i % 12) + 1));
    const graph = toGraphology({ nodes, edges });

    assert.equal(graph.order, 500);
    assert.equal(graph.size, 499);
    graph.forEachNode((id, { x, y, size, color }) => {
      assert.ok(Number.isFinite(x) && Number.isFinite(y));
      assert.ok(size >= NODE.minSize && size <= NODE.maxSize * (1 + NODE.degreeSizeBoost));
      assert.match(color, /^#[0-9a-f]{6}$/);
    });
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

  it("keeps layout data out of the dependency graph and the payload", () => {
    const payload = toRenderGraph(dependencyGraph);
    toGraphology(payload);

    for (const n of [...dependencyGraph.nodes, ...payload.nodes]) {
      for (const key of ["x", "y", "radius", "angle", "cluster", "clusterColor"]) {
        assert.ok(!(key in n), `${n.id} has ${key}`);
      }
    }
    assert.ok(!("frame" in dependencyGraph) && !("frame" in payload));
  });
});
