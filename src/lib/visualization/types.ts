import type { ReferenceKind } from "../analysis/kinds.ts";
import type { LanguageId } from "../languages/registry.ts";

// Graph data sent to the browser. toRenderGraph copies these fields by name, so
// fields added to the domain graph do not reach the client unless listed here.
export type RenderNode = {
  id: string;
  path: string;
  directory: string;
  language: LanguageId;
  size: number;
  incoming: number;
  outgoing: number;
  degree: number;
};

export type RenderEdge = {
  id: string;
  source: string;
  target: string;
  weight: number;
  // Kinds of relationship the edge combines, in a fixed order.
  kinds: ReferenceKind[];
};

export type RenderGraph = {
  nodes: RenderNode[];
  edges: RenderEdge[];
};

export type NodeAttributes = {
  x: number;
  y: number;
  size: number;
  color: string;
  label: string;
};

export type EdgeAttributes = {
  size: number;
  color: string;
};
