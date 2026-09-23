import { DirectedGraph } from "graphology";

import { layoutNodes } from "./layout.ts";
import type { EdgeAttributes, NodeAttributes, RenderGraph } from "./types.ts";

export type VisualGraph = DirectedGraph<NodeAttributes, EdgeAttributes>;

const NODE_SIZE = 3;
const NODE_COLOR = "#d8d5ce";
const EDGE_SIZE = 1;
// Sigma blends with premultiplied alpha, so the color channels are the node
// color already multiplied by the opacity (0.2).
const EDGE_COLOR = "rgba(43, 43, 41, 0.2)";

// Duplicate nodes, duplicate edges, self loops and edges to unknown nodes make
// Graphology throw. The dependency graph never contains them, so a throw here
// means the input did not come from buildDependencyGraph.
export function toGraphology(graph: RenderGraph): VisualGraph {
  const visual: VisualGraph = new DirectedGraph({ allowSelfLoops: false });
  const positions = layoutNodes(graph.nodes.map((node) => node.id));

  for (const node of graph.nodes) {
    const { x, y } = positions.get(node.id)!;
    visual.addNode(node.id, {
      x,
      y,
      size: NODE_SIZE,
      color: NODE_COLOR,
      label: node.path.slice(node.path.lastIndexOf("/") + 1),
    });
  }

  for (const edge of graph.edges) {
    visual.addDirectedEdgeWithKey(edge.id, edge.source, edge.target, {
      size: EDGE_SIZE,
      color: EDGE_COLOR,
    });
  }

  return visual;
}
