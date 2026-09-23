import { DirectedGraph } from "graphology";

import { layoutNodes } from "./layout.ts";
import { edgeStyle, nodeStyle } from "./mapping.ts";
import type { EdgeAttributes, NodeAttributes, RenderGraph } from "./types.ts";

export type VisualGraph = DirectedGraph<NodeAttributes, EdgeAttributes>;

// Duplicate nodes, duplicate edges, self loops and edges to unknown nodes make
// Graphology throw. The dependency graph never contains them, so a throw here
// means the input did not come from buildDependencyGraph.
export function toGraphology(graph: RenderGraph): VisualGraph {
  const visual: VisualGraph = new DirectedGraph({ allowSelfLoops: false });
  const positions = layoutNodes(graph.nodes.map((node) => node.id));

  for (const node of graph.nodes) {
    const { x, y } = positions.get(node.id)!;
    visual.addNode(node.id, { x, y, ...nodeStyle(node) });
  }

  for (const edge of graph.edges) {
    visual.addDirectedEdgeWithKey(edge.id, edge.source, edge.target, edgeStyle(edge));
  }

  return visual;
}
