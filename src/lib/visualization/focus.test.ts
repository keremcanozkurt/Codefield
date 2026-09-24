import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { buildDependencyGraph, edgeId } from "../graph/build.ts";
import type { SourceFile } from "../source-files.ts";
import {
  CAMERA,
  closerRatio,
  focusEdge,
  focusNode,
  focusRatio,
  initialCameraRatio,
  isComfortablyVisible,
  labelsAllFiles,
  nodeRole,
  type FocusState,
} from "./focus.ts";
import { toGraphology } from "./graphology.ts";
import { buildGraphIndex, neighborhood } from "./inspection.ts";
import { layoutConstellation } from "./layout.ts";
import { edgeStyle, hoveredEdgeStyle, hoveredNodeStyle, nodeStyle } from "./mapping.ts";
import { toRenderGraph } from "./payload.ts";
import { FOCUS } from "./theme.ts";
import type { EdgeAttributes, NodeAttributes, RenderEdge, RenderGraph, RenderNode } from "./types.ts";

function node(path: string, degree = 0): RenderNode {
  const slash = path.lastIndexOf("/");
  return {
    id: path,
    path,
    directory: slash === -1 ? "" : path.slice(0, slash),
    language: /\.tsx?$/.test(path) ? "typescript" : "javascript",
    size: 2_000,
    incoming: 0,
    outgoing: 0,
    degree,
  };
}

function edge(source: string, target: string): RenderEdge {
  return { id: edgeId(source, target), source, target, weight: 1, kinds: ["import"] };
}

// a -> b -> c, d -> b, e isolated.
function sample(): RenderGraph {
  return {
    nodes: [node("src/a.ts", 1), node("src/b.ts", 3), node("src/c.ts", 1), node("lib/d.js", 1), node("e.ts")],
    edges: [edge("src/a.ts", "src/b.ts"), edge("src/b.ts", "src/c.ts"), edge("lib/d.js", "src/b.ts")],
  };
}

function attributes(graph: RenderGraph, id: string): NodeAttributes {
  return { x: 0, y: 0, ...nodeStyle(graph.nodes.find((n) => n.id === id)!) };
}

const edgeAttributes: EdgeAttributes = edgeStyle(edge("x", "y"));

function brightness(color: string): number {
  const value = Number.parseInt(color.slice(1), 16);
  return ((value >> 16) & 0xff) + ((value >> 8) & 0xff) + (value & 0xff);
}

function opacity(color: string): number {
  return Number(/, ([\d.]+)\)$/.exec(color)![1]);
}

describe("focusNode", () => {
  const graph = sample();
  const index = buildGraphIndex(graph);
  const selectedB: FocusState = { neighborhood: neighborhood(index, "src/b.ts"), hovered: null, labelAll: false, visible: null };

  it("keeps the stored attributes and hover behaviour without a selection", () => {
    const data = attributes(graph, "src/a.ts");

    assert.deepEqual(focusNode("src/a.ts", data, { neighborhood: null, hovered: null, labelAll: false, visible: null }), data);
    assert.deepEqual(focusNode("src/a.ts", data, { neighborhood: null, hovered: "src/a.ts", labelAll: false, visible: null }), hoveredNodeStyle(data));
    assert.deepEqual(focusNode("src/a.ts", data, { neighborhood: null, hovered: "src/c.ts", labelAll: false, visible: null }), data);
  });

  it("emphasizes the selected file most and labels it", () => {
    const data = attributes(graph, "src/b.ts");
    const selected = focusNode("src/b.ts", data, selectedB);

    assert.equal(selected.size, data.size * FOCUS.selectedSizeScale);
    assert.ok(brightness(selected.color) > brightness(data.color));
    assert.equal(selected.highlighted, true);
    assert.equal(selected.label, "b.ts");
    assert.equal(selected.x, data.x);
    assert.equal(selected.y, data.y);
  });

  it("keeps neighbours visible, slightly brighter and labelled", () => {
    for (const id of ["src/a.ts", "src/c.ts", "lib/d.js"]) {
      const data = attributes(graph, id);
      const neighbor = focusNode(id, data, selectedB);
      const selected = focusNode("src/b.ts", attributes(graph, "src/b.ts"), selectedB);

      assert.equal(nodeRole(selectedB.neighborhood!, id), "neighbor");
      assert.ok(brightness(neighbor.color) > brightness(data.color), id);
      assert.equal(neighbor.size, data.size);
      assert.equal(neighbor.forceLabel, true);
      assert.ok(neighbor.zIndex! < selected.zIndex! && neighbor.zIndex! > 0);
    }
  });

  it("fades unrelated files without hiding them", () => {
    const data = attributes(graph, "e.ts");
    const context = focusNode("e.ts", data, selectedB);

    assert.equal(nodeRole(selectedB.neighborhood!, "e.ts"), "context");
    assert.ok(brightness(context.color) < brightness(data.color) * 0.5);
    assert.ok(brightness(context.color) > brightness("#0d0f13"));
    assert.equal(context.size, data.size);
    assert.equal(context.label, null);
    assert.ok(!("hidden" in context));
  });

  it("treats files two edges away as unrelated", () => {
    const state: FocusState = { neighborhood: neighborhood(index, "src/a.ts"), hovered: null, labelAll: false, visible: null };

    assert.equal(nodeRole(state.neighborhood!, "src/b.ts"), "neighbor");
    assert.equal(nodeRole(state.neighborhood!, "src/c.ts"), "context");
    assert.equal(nodeRole(state.neighborhood!, "lib/d.js"), "context");
  });

  it("shows a hovered file's label without changing the selection's look", () => {
    const hovered: FocusState = { ...selectedB, hovered: "e.ts" };
    const data = attributes(graph, "e.ts");
    const context = focusNode("e.ts", data, hovered);

    assert.equal(context.highlighted, true);
    assert.equal(context.label, "e.ts");
    assert.deepEqual(focusNode("src/b.ts", attributes(graph, "src/b.ts"), hovered), focusNode("src/b.ts", attributes(graph, "src/b.ts"), selectedB));
    assert.deepEqual(focusNode("src/a.ts", attributes(graph, "src/a.ts"), hovered), focusNode("src/a.ts", attributes(graph, "src/a.ts"), selectedB));
  });

  it("stops forcing neighbour labels for files with many neighbours", () => {
    const leaves = Array.from({ length: FOCUS.labelledNeighbors + 1 }, (_, i) => node(`leaf-${i}.ts`, 1));
    const hub: RenderGraph = { nodes: [node("hub.ts", leaves.length), ...leaves], edges: leaves.map((l) => edge(l.id, "hub.ts")) };
    const state: FocusState = { neighborhood: neighborhood(buildGraphIndex(hub), "hub.ts"), hovered: null, labelAll: false, visible: null };

    assert.equal(focusNode("leaf-0.ts", attributes(hub, "leaf-0.ts"), state).forceLabel, false);
  });

  it("keeps an isolated selected file visible and emphasized", () => {
    const state: FocusState = { neighborhood: neighborhood(index, "e.ts"), hovered: null, labelAll: false, visible: null };
    const data = attributes(graph, "e.ts");
    const selected = focusNode("e.ts", data, state);

    assert.equal(selected.highlighted, true);
    assert.ok(selected.size > data.size);
    assert.ok(brightness(selected.color) > brightness(data.color));
    assert.equal(nodeRole(state.neighborhood!, "src/a.ts"), "context");
  });

  it("labels every file of a very small graph, with or without a selection", () => {
    const small: FocusState = { neighborhood: null, hovered: null, labelAll: true, visible: null };
    const selected: FocusState = { ...selectedB, labelAll: true, visible: null };
    const data = attributes(graph, "src/a.ts");

    assert.equal(focusNode("src/a.ts", data, small).forceLabel, true);
    assert.equal(focusNode("src/a.ts", data, selected).forceLabel, true);
    assert.equal(focusNode("src/a.ts", data, { ...small, labelAll: false, visible: null }).forceLabel, undefined);
    assert.ok(labelsAllFiles(1) && labelsAllFiles(FOCUS.labelledGraphSize));
    assert.ok(!labelsAllFiles(FOCUS.labelledGraphSize + 1) && !labelsAllFiles(500));
  });

  it("does not modify the stored attributes", () => {
    const data = Object.freeze(attributes(graph, "src/b.ts"));

    focusNode("src/b.ts", data, selectedB);
    focusNode("src/b.ts", data, { neighborhood: null, hovered: "src/b.ts", labelAll: false, visible: null });
    assert.deepEqual(data, attributes(graph, "src/b.ts"));
  });
});

describe("focusEdge", () => {
  const index = buildGraphIndex(sample());
  const selectedB: FocusState = { neighborhood: neighborhood(index, "src/b.ts"), hovered: null, labelAll: false, visible: null };

  it("keeps edges unchanged without a selection, except those of a hovered file", () => {
    const none: FocusState = { neighborhood: null, hovered: null, labelAll: false, visible: null };

    assert.deepEqual(focusEdge("src/a.ts", "src/b.ts", edgeAttributes, none), edgeAttributes);
    assert.deepEqual(
      focusEdge("src/a.ts", "src/b.ts", edgeAttributes, { neighborhood: null, hovered: "src/b.ts", labelAll: false, visible: null }),
      hoveredEdgeStyle(edgeAttributes),
    );
  });

  it("emphasizes edges in both directions of the selected file", () => {
    const incoming = focusEdge("src/a.ts", "src/b.ts", edgeAttributes, selectedB);
    const outgoing = focusEdge("src/b.ts", "src/c.ts", edgeAttributes, selectedB);

    for (const edgeData of [incoming, outgoing]) {
      assert.ok(opacity(edgeData.color) > opacity(edgeAttributes.color));
      assert.ok(edgeData.size >= edgeAttributes.size);
      assert.equal(edgeData.zIndex, 1);
    }
  });

  it("fades other edges strongly, including those between neighbours", () => {
    const state: FocusState = { neighborhood: neighborhood(index, "src/c.ts"), hovered: "src/a.ts", labelAll: false, visible: null };
    const unrelated = focusEdge("src/a.ts", "src/b.ts", edgeAttributes, state);

    assert.ok(opacity(unrelated.color) <= opacity(edgeAttributes.color) / 3);
    assert.ok(opacity(unrelated.color) > 0);
    assert.equal(unrelated.zIndex, 0);
  });
});

describe("filtering", () => {
  const graph = sample();
  const index = buildGraphIndex(graph);

  it("hides a node that is not in the visible set", () => {
    const data = attributes(graph, "src/a.ts");
    const state: FocusState = { neighborhood: null, hovered: null, labelAll: false, visible: new Set(["src/b.ts"]) };

    assert.equal(focusNode("src/a.ts", data, state).hidden, true);
  });

  it("does not hide a node that is in the visible set", () => {
    const data = attributes(graph, "src/a.ts");
    const state: FocusState = { neighborhood: null, hovered: null, labelAll: false, visible: new Set(["src/a.ts"]) };

    assert.ok(!focusNode("src/a.ts", data, state).hidden);
  });

  it("does not hide anything when visible is null", () => {
    const data = attributes(graph, "src/a.ts");
    const state: FocusState = { neighborhood: null, hovered: null, labelAll: false, visible: null };

    assert.ok(!focusNode("src/a.ts", data, state).hidden);
  });

  it("hides an edge when either endpoint is filtered out", () => {
    const onlySource: FocusState = { neighborhood: null, hovered: null, labelAll: false, visible: new Set(["src/a.ts"]) };
    const onlyTarget: FocusState = { neighborhood: null, hovered: null, labelAll: false, visible: new Set(["src/b.ts"]) };
    const neither: FocusState = { neighborhood: null, hovered: null, labelAll: false, visible: new Set(["src/c.ts"]) };

    assert.equal(focusEdge("src/a.ts", "src/b.ts", edgeAttributes, onlySource).hidden, true);
    assert.equal(focusEdge("src/a.ts", "src/b.ts", edgeAttributes, onlyTarget).hidden, true);
    assert.equal(focusEdge("src/a.ts", "src/b.ts", edgeAttributes, neither).hidden, true);
  });

  it("keeps an edge visible when both endpoints are visible", () => {
    const both: FocusState = { neighborhood: null, hovered: null, labelAll: false, visible: new Set(["src/a.ts", "src/b.ts"]) };

    assert.ok(!focusEdge("src/a.ts", "src/b.ts", edgeAttributes, both).hidden);
  });

  it("filtering takes precedence over the selected file's own emphasis", () => {
    const state: FocusState = {
      neighborhood: neighborhood(index, "src/b.ts"),
      hovered: null,
      labelAll: false,
      visible: new Set(["src/a.ts"]),
    };

    assert.equal(focusNode("src/b.ts", attributes(graph, "src/b.ts"), state).hidden, true);
  });
});

describe("domain separation", () => {
  it("does not add selection state to the dependency graph or the payload", () => {
    const files: SourceFile[] = ["src/a.ts", "src/b.ts"].map((path) => ({
      path,
      sha: "0".repeat(40),
      size: 10,
      extension: ".ts",
      language: "typescript",
      content: "export {};",
    }));
    const dependencyGraph = buildDependencyGraph(files, [
      { sourcePath: "src/a.ts", targetPath: "src/b.ts", kind: "import", specifier: "./b" },
    ]);
    const copy = structuredClone(dependencyGraph);
    const payload = toRenderGraph(dependencyGraph);
    const payloadCopy = structuredClone(payload);
    const visual = toGraphology(payload);
    const state: FocusState = { neighborhood: neighborhood(buildGraphIndex(payload), "src/a.ts"), hovered: "src/b.ts", labelAll: false, visible: null };

    visual.forEachNode((id, data) => focusNode(id, data, state));
    visual.forEachEdge((id, data, source, target) => focusEdge(source, target, data, state));

    assert.deepEqual(dependencyGraph, copy);
    assert.deepEqual(payload, payloadCopy);
    for (const n of [...dependencyGraph.nodes, ...payload.nodes]) {
      for (const key of ["selected", "hovered", "visible", "focused", "highlighted"]) assert.ok(!(key in n));
    }
    visual.forEachNode((id, data) => assert.deepEqual(Object.keys(data).sort(), ["color", "label", "size", "x", "y"]));
  });
});

describe("camera", () => {
  function graphWith(count: number): RenderGraph {
    const nodes = Array.from({ length: count }, (_, i) => node(`src/d${i % 9}/f${i}.ts`, 1));
    const edges = nodes.slice(1).map((n, i) => edge(nodes[i].id, n.id));
    return { nodes, edges };
  }
  const ratioFor = (count: number) => {
    const layout = layoutConstellation(graphWith(count));
    return initialCameraRatio(layout.bounds, layout.frame);
  };

  it("starts tiny graphs zoomed in, within limits", () => {
    for (const count of [1, 2, 5, 10]) {
      const ratio = ratioFor(count);
      assert.ok(ratio >= CAMERA.minInitialRatio && ratio < 1, `${count}: ${ratio}`);
    }
    assert.equal(ratioFor(1), CAMERA.minInitialRatio);
  });

  it("makes tiny graphs span a meaningful share of the view", () => {
    for (const count of [2, 5, 10]) {
      const layout = layoutConstellation(graphWith(count));
      const ratio = initialCameraRatio(layout.bounds, layout.frame);
      const shown = Math.max(
        (layout.bounds.x[1] - layout.bounds.x[0]) / ((layout.frame.x[1] - layout.frame.x[0]) * ratio),
        (layout.bounds.y[1] - layout.bounds.y[0]) / ((layout.frame.y[1] - layout.frame.y[0]) * ratio),
      );
      assert.ok(shown >= 0.5 && shown <= 1, `${count}: ${shown}`);
    }
  });

  it("frames tiny graphs closer than large ones", () => {
    assert.ok(ratioFor(3) < ratioFor(100));
    assert.ok(ratioFor(10) < ratioFor(500));
  });

  it("leaves large graphs at the full frame", () => {
    for (const count of [100, 300, 500]) assert.equal(ratioFor(count), 1, `${count}`);
  });

  it("handles an empty layout", () => {
    const layout = layoutConstellation({ nodes: [], edges: [] });
    assert.equal(initialCameraRatio(layout.bounds, layout.frame), 1);
  });

  it("focuses without zooming small graphs and zooms large ones moderately", () => {
    assert.equal(focusRatio(1, 1, CAMERA.minInitialRatio), CAMERA.minInitialRatio);
    assert.equal(focusRatio(0.5, 2, 0.5), 0.5);
    assert.equal(focusRatio(1, 40, 1), 1);
    assert.ok(focusRatio(1, 150, 1) < 1 && focusRatio(1, 150, 1) > CAMERA.focusRatio);
    assert.equal(focusRatio(1, 500, 1), CAMERA.focusRatio);
  });

  it("never zooms out when focusing", () => {
    assert.equal(focusRatio(0.2, 500, 1), 0.2);
    assert.equal(focusRatio(0.2, 3, 0.5), 0.2);
    assert.equal(focusRatio(CAMERA.minRatio / 2, 3, 1), CAMERA.minRatio);
  });

  it("brings a zoomed-out view back to at most the initial zoom", () => {
    assert.equal(focusRatio(3, 5, 0.5), 0.5);
    assert.equal(focusRatio(3, 40, 1), 1);
  });

  it("zooms closer by a bounded factor", () => {
    assert.equal(closerRatio(1), CAMERA.closerFactor);
    assert.equal(closerRatio(CAMERA.minRatio), CAMERA.minRatio);
  });

  it("detects files near the edge of the view", () => {
    const size = { width: 1000, height: 600 };

    assert.ok(isComfortablyVisible({ x: 500, y: 300 }, size));
    assert.ok(isComfortablyVisible({ x: 150, y: 100 }, size));
    assert.ok(!isComfortablyVisible({ x: 50, y: 300 }, size));
    assert.ok(!isComfortablyVisible({ x: 500, y: 590 }, size));
    assert.ok(!isComfortablyVisible({ x: -20, y: 300 }, size));
  });
});
