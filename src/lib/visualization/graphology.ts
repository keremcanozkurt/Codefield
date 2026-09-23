import { DirectedGraph } from "graphology";

import { layoutConstellation, type Frame } from "./layout.ts";
import { edgeStyle, nodeStyle } from "./mapping.ts";
import type { EdgeAttributes, NodeAttributes, RenderGraph } from "./types.ts";

export type GraphAttributes = {
  // The area the initial camera should show. See layoutConstellation.
  frame: Frame;
};

export type VisualGraph = DirectedGraph<NodeAttributes, EdgeAttributes, GraphAttributes>;

// Duplicate nodes, duplicate edges, self loops and edges to unknown nodes make
// Graphology throw. The dependency graph never contains them, so a throw here
// means the input did not come from buildDependencyGraph.
export function toGraphology(graph: RenderGraph): VisualGraph {
  const visual: VisualGraph = new DirectedGraph({ allowSelfLoops: false });
  const { positions, frame } = layoutConstellation(graph);
  visual.replaceAttributes({ frame });

  for (const node of graph.nodes) {
    const { x, y } = positions.get(node.id)!;
    visual.addNode(node.id, { x, y, ...nodeStyle(node) });
  }

  for (const edge of graph.edges) {
    visual.addDirectedEdgeWithKey(edge.id, edge.source, edge.target, edgeStyle(edge));
  }

  return visual;
}
