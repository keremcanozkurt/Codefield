import type { SourceLanguage } from "../source-files.ts";

// Graph data sent to the browser. toRenderGraph copies these fields by name, so
// fields added to the domain graph do not reach the client unless listed here.
export type RenderNode = {
  id: string;
  path: string;
  directory: string;
  language: SourceLanguage;
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
