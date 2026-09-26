import { emptyKindCounts, REFERENCE_KINDS } from "../analysis/kinds.ts";
import { compareStrings, directoryOf } from "../analysis/paths.ts";
import type { ModuleRelationship } from "../analysis/relationships.ts";
import type { SourceFile } from "../source-files.ts";
import type {
  DependencyGraph,
  DirectorySummary,
  GraphEdge,
  GraphNode,
  LanguageCounts,
} from "./types.ts";

export type GraphSource = Pick<SourceFile, "path" | "extension" | "language" | "size">;

// JSON keeps the pair unambiguous even for paths that contain separators such
// as " -> ", and the ID only changes when the pair does.
export function edgeId(source: string, target: string): string {
  return JSON.stringify([source, target]);
}

// Relationships between the same two files are merged into one directed edge.
// The edge's weight and kind counts keep how many relationships it stands for,
// while node incoming, outgoing and degree count unique edges: a file that
// both imports and re-exports a target gains one outgoing edge, not two. The
// byKind counts are per edge too (an edge with an import and a re-export
// counts once in each), so their sum can exceed incoming or outgoing.
//
// Input is expected to come from analyzeModuleRelationships. A duplicate file
// or a relationship naming an unknown file throws instead of producing a graph
// with missing edges. Self relationships and exact repeats are ignored, as the
// analysis already does.
export function buildDependencyGraph(
  files: GraphSource[],
  relationships: ModuleRelationship[],
): DependencyGraph {
  const nodes = new Map<string, GraphNode>();

  for (const file of files) {
    if (!isRepositoryPath(file.path)) {
      throw new Error(`Invalid source path: ${JSON.stringify(file.path)}`);
    }
    if (nodes.has(file.path)) {
      throw new Error(`Duplicate source file: ${file.path}`);
    }

    nodes.set(file.path, {
      id: file.path,
      path: file.path,
      name: file.path.slice(file.path.lastIndexOf("/") + 1),
      directory: directoryOf(file.path),
      extension: file.extension,
      language: file.language,
      size: file.size,
      incoming: 0,
      outgoing: 0,
      degree: 0,
      incomingByKind: emptyKindCounts(),
      outgoingByKind: emptyKindCounts(),
    });
  }

  const edges = new Map<string, { edge: GraphEdge; seen: Set<string> }>();

  for (const relationship of relationships) {
    const { sourcePath, targetPath, kind, specifier } = relationship;
    if (!nodes.has(sourcePath)) {
      throw new Error(`Relationship source is not a loaded source file: ${sourcePath}`);
    }
    if (!nodes.has(targetPath)) {
      throw new Error(`Relationship target is not a loaded source file: ${targetPath}`);
    }
    if (!REFERENCE_KINDS.includes(kind)) {
      throw new Error(`Unknown relationship kind: ${JSON.stringify(kind)}`);
    }
    if (sourcePath === targetPath) continue;

    const id = edgeId(sourcePath, targetPath);
    let entry = edges.get(id);
    if (entry === undefined) {
      entry = {
        edge: {
          id,
          source: sourcePath,
          target: targetPath,
          weight: 0,
          kinds: emptyKindCounts(),
          specifiers: [],
        },
        seen: new Set(),
      };
      edges.set(id, entry);
    }

    const key = `${kind}\0${specifier}`;
    if (entry.seen.has(key)) continue;
    entry.seen.add(key);

    entry.edge.weight++;
    entry.edge.kinds[kind]++;
    if (!entry.edge.specifiers.includes(specifier)) entry.edge.specifiers.push(specifier);
  }

  const sortedEdges = [...edges.values()]
    .map(({ edge }) => edge)
    .sort((a, b) => compareStrings(a.source, b.source) || compareStrings(a.target, b.target));

  let relationshipCount = 0;
  for (const edge of sortedEdges) {
    edge.specifiers.sort(compareStrings);
    relationshipCount += edge.weight;

    const source = nodes.get(edge.source)!;
    const target = nodes.get(edge.target)!;
    source.outgoing++;
    target.incoming++;
    for (const kind of REFERENCE_KINDS) {
      if (edge.kinds[kind] === 0) continue;
      source.outgoingByKind[kind]++;
      target.incomingByKind[kind]++;
    }
  }

  const sortedNodes = [...nodes.values()].sort((a, b) => compareStrings(a.path, b.path));
  const directories = new Map<string, DirectorySummary>();
  const languages: LanguageCounts = {};
  let totalBytes = 0;
  let isolatedNodes = 0;

  for (const node of sortedNodes) {
    node.degree = node.incoming + node.outgoing;
    if (node.degree === 0) isolatedNodes++;
    languages[node.language] = (languages[node.language] ?? 0) + 1;
    totalBytes += node.size;

    const directory = directories.get(node.directory);
    if (directory === undefined) {
      directories.set(node.directory, { path: node.directory, fileCount: 1, totalBytes: node.size });
    } else {
      directory.fileCount++;
      directory.totalBytes += node.size;
    }
  }

  const sortedDirectories = [...directories.values()].sort((a, b) =>
    compareStrings(a.path, b.path),
  );

  return {
    nodes: sortedNodes,
    edges: sortedEdges,
    directories: sortedDirectories,
    stats: {
      nodes: sortedNodes.length,
      edges: sortedEdges.length,
      isolatedNodes,
      relationships: relationshipCount,
      totalBytes,
      directories: sortedDirectories.length,
      languages,
    },
  };
}

// Repository-relative, "/"-separated, without empty, "." or ".." segments.
function isRepositoryPath(path: string): boolean {
  return (
    path !== "" &&
    path.split("/").every((segment) => segment !== "" && segment !== "." && segment !== "..")
  );
}
