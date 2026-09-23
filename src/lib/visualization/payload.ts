import type { DependencyGraph } from "../graph/types.ts";
import type { RenderGraph } from "./types.ts";

export function toRenderGraph(graph: DependencyGraph): RenderGraph {
  return {
    nodes: graph.nodes.map((node) => ({
      id: node.id,
      path: node.path,
      directory: node.directory,
      language: node.language,
      size: node.size,
      incoming: node.incoming,
      outgoing: node.outgoing,
      degree: node.degree,
    })),
    edges: graph.edges.map((edge) => ({
      id: edge.id,
      source: edge.source,
      target: edge.target,
      weight: edge.weight,
    })),
  };
}
