import { DirectedGraph } from "graphology";

import { initialCameraRatio } from "./focus.ts";
import { layoutConstellation, type Frame } from "./layout.ts";
import { edgeStyle, nodeStyle } from "./mapping.ts";
import type { EdgeAttributes, NodeAttributes, RenderGraph } from "./types.ts";

export type GraphAttributes = {
  // The area Sigma frames at camera ratio 1. See layoutConstellation.
  frame: Frame;
  // The camera ratio to start at and to reset to. See initialCameraRatio.
  initialRatio: number;
};

export type VisualGraph = DirectedGraph<NodeAttributes, EdgeAttributes, GraphAttributes>;

// Duplicate nodes, duplicate edges, self loops and edges to unknown nodes make
// Graphology throw. The dependency graph never contains them, so a throw here
// means the input did not come from buildDependencyGraph.
export function toGraphology(graph: RenderGraph): VisualGraph {
  const visual: VisualGraph = new DirectedGraph({ allowSelfLoops: false });
  const { positions, frame, bounds } = layoutConstellation(graph);
  visual.replaceAttributes({ frame, initialRatio: initialCameraRatio(bounds, frame) });

  for (const node of graph.nodes) {
    const { x, y } = positions.get(node.id)!;
    visual.addNode(node.id, { x, y, ...nodeStyle(node) });
  }

  for (const edge of graph.edges) {
    visual.addDirectedEdgeWithKey(edge.id, edge.source, edge.target, edgeStyle(edge));
  }

  return visual;
}
