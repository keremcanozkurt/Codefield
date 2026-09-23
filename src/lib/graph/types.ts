import type { ReferenceKind } from "../analysis/imports.ts";
import type { SourceExtension, SourceLanguage } from "../source-files.ts";

export type KindCounts = Record<ReferenceKind, number>;

export type GraphNode = {
  // The repository-relative path.
  id: string;
  path: string;
  name: string;
  // "" for files at the repository root.
  directory: string;
  extension: SourceExtension;
  language: SourceLanguage;
  size: number;
  // Counted in unique graph edges, not in relationships. See build.ts.
  incoming: number;
  outgoing: number;
  degree: number;
  incomingByKind: KindCounts;
  outgoingByKind: KindCounts;
};

export type GraphEdge = {
  id: string;
  source: string;
  target: string;
  // Number of module relationships from source to target.
  weight: number;
  kinds: KindCounts;
  specifiers: string[];
};

export type DirectorySummary = {
  path: string;
  // Files directly in this directory, not in its subdirectories.
  fileCount: number;
  totalBytes: number;
};

export type DependencyGraph = {
  nodes: GraphNode[];
  edges: GraphEdge[];
  directories: DirectorySummary[];
  stats: {
    nodes: number;
    edges: number;
    isolatedNodes: number;
    relationships: number;
    totalBytes: number;
    directories: number;
    languages: Record<SourceLanguage, number>;
  };
};
