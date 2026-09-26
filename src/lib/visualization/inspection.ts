import { REFERENCE_KINDS, type ReferenceKind } from "../analysis/kinds.ts";
import { compareStrings } from "../analysis/paths.ts";
import { languageName } from "../languages/registry.ts";
import { fileName } from "./mapping.ts";
import type { RenderGraph, RenderNode } from "./types.ts";

export type Relation = {
  // The file at the other end of the edge.
  id: string;
  kinds: ReferenceKind[];
};

type SearchEntry = {
  id: string;
  path: string;
  name: string;
  directory: string;
  lowerPath: string;
  lowerName: string;
};

export type GraphIndex = {
  nodeById: Map<string, RenderNode>;
  // Files each file references, and files that reference it, sorted by path.
  outgoing: Map<string, Relation[]>;
  incoming: Map<string, Relation[]>;
  // Every file, sorted by path.
  entries: SearchEntry[];
};

// Built once per analysis so that selection, search and the inspector never
// scan the edge list.
export function buildGraphIndex(graph: RenderGraph): GraphIndex {
  const nodeById = new Map(graph.nodes.map((node) => [node.id, node]));
  const outgoing = new Map<string, Map<string, Set<ReferenceKind>>>();
  const incoming = new Map<string, Map<string, Set<ReferenceKind>>>();
  for (const id of nodeById.keys()) {
    outgoing.set(id, new Map());
    incoming.set(id, new Map());
  }

  for (const edge of graph.edges) {
    if (edge.source === edge.target || !nodeById.has(edge.source) || !nodeById.has(edge.target)) {
      continue;
    }
    addRelation(outgoing.get(edge.source)!, edge.target, edge.kinds);
    addRelation(incoming.get(edge.target)!, edge.source, edge.kinds);
  }

  const path = (id: string) => nodeById.get(id)!.path;
  const toLists = (relations: Map<string, Map<string, Set<ReferenceKind>>>) =>
    new Map(
      [...relations].map(([id, related]) => [
        id,
        [...related]
          .map(([other, kinds]) => ({ id: other, kinds: REFERENCE_KINDS.filter((kind) => kinds.has(kind)) }))
          .sort((a, b) => compareStrings(path(a.id), path(b.id)) || compareStrings(a.id, b.id)),
      ]),
    );

  const entries = graph.nodes
    .map((node) => {
      const name = fileName(node.path);
      return {
        id: node.id,
        path: node.path,
        name,
        directory: node.directory,
        lowerPath: node.path.toLowerCase(),
        lowerName: name.toLowerCase(),
      };
    })
    .sort((a, b) => compareStrings(a.path, b.path) || compareStrings(a.id, b.id));

  return { nodeById, outgoing: toLists(outgoing), incoming: toLists(incoming), entries };
}

function addRelation(
  relations: Map<string, Set<ReferenceKind>>,
  other: string,
  kinds: readonly ReferenceKind[],
) {
  const existing = relations.get(other);
  if (existing === undefined) relations.set(other, new Set(kinds));
  else for (const kind of kinds) existing.add(kind);
}

// A selection is kept only while its file exists in the current graph, so a
// new analysis never leaves a stale ID selected.
export function selectionFor(index: GraphIndex, id: string | null): string | null {
  return id !== null && index.nodeById.has(id) ? id : null;
}

export type Neighborhood = {
  selected: string;
  // Files the selected file references, and files that reference it.
  outgoing: Set<string>;
  incoming: Set<string>;
  // Both of the above: files one edge away in either direction.
  neighbors: Set<string>;
};

export function neighborhood(index: GraphIndex, id: string | null): Neighborhood | null {
  const selected = selectionFor(index, id);
  if (selected === null) return null;
  const outgoing = new Set(index.outgoing.get(selected)!.map((relation) => relation.id));
  const incoming = new Set(index.incoming.get(selected)!.map((relation) => relation.id));
  return { selected, outgoing, incoming, neighbors: new Set([...outgoing, ...incoming]) };
}

export type SearchResult = { id: string; path: string; name: string; directory: string };

export const SEARCH_LIMIT = 8;

// Case-insensitive substring search over file names and paths. Results are
// ranked exact name, name prefix, name substring, then path substring. Within
// a rank shorter names come first, so "archive" lists archive.ts before
// archive.test.ts, and then paths in code-unit order.
export function searchFiles(index: GraphIndex, query: string, limit = SEARCH_LIMIT): SearchResult[] {
  const needle = query.trim().toLowerCase();
  if (needle === "" || limit <= 0) return [];

  const ranked: { rank: number; entry: SearchEntry }[] = [];
  for (const entry of index.entries) {
    const rank = matchRank(entry, needle);
    if (rank !== null) ranked.push({ rank, entry });
  }
  // entries are already in path order and the sort is stable.
  ranked.sort((a, b) => a.rank - b.rank || a.entry.name.length - b.entry.name.length);

  return ranked.slice(0, limit).map(({ entry }) => ({
    id: entry.id,
    path: entry.path,
    name: entry.name,
    directory: entry.directory,
  }));
}

function matchRank(entry: SearchEntry, needle: string): number | null {
  if (entry.lowerName === needle) return 0;
  if (entry.lowerName.startsWith(needle)) return 1;
  if (entry.lowerName.includes(needle)) return 2;
  if (entry.lowerPath.includes(needle)) return 3;
  return null;
}

export type RelatedFile = {
  id: string;
  name: string;
  directory: string;
  kinds: ReferenceKind[];
};

export type FileDetails = {
  id: string;
  name: string;
  path: string;
  directory: string;
  language: string;
  size: string;
  // Counted in files, like the graph's edges.
  outgoing: number;
  incoming: number;
  degree: number;
  // Files this file references, and files that reference this file.
  references: RelatedFile[];
  referencedBy: RelatedFile[];
};

export function describeFile(index: GraphIndex, id: string | null): FileDetails | null {
  const selected = selectionFor(index, id);
  if (selected === null) return null;
  const node = index.nodeById.get(selected)!;
  const related = (relations: Relation[]) =>
    relations.map(({ id: other, kinds }) => {
      const file = index.nodeById.get(other)!;
      return { id: other, name: fileName(file.path), directory: file.directory, kinds };
    });

  return {
    id: node.id,
    name: fileName(node.path),
    path: node.path,
    directory: node.directory,
    language: languageName(node.language),
    size: formatBytes(node.size),
    outgoing: node.outgoing,
    incoming: node.incoming,
    degree: node.degree,
    references: related(index.outgoing.get(selected)!),
    referencedBy: related(index.incoming.get(selected)!),
  };
}

export { languageName };

const KIND_NAMES: Record<ReferenceKind, string> = {
  import: "import",
  reexport: "re-export",
  dynamic_import: "dynamic import",
  require: "require",
  include: "include",
  module: "module",
  reference: "reference",
};

export function kindName(kind: ReferenceKind): string {
  return KIND_NAMES[kind];
}

const UNITS = ["KB", "MB", "GB"];

// Binary multiples, shown with one decimal below 10 and none above, as in
// "842 B", "3.4 KB" and "127 KB".
export function formatBytes(bytes: number): string {
  if (!(bytes >= 0) || !Number.isFinite(bytes)) return "0 B";
  if (bytes < 1024) return `${Math.round(bytes)} B`;

  let value = bytes / 1024;
  let unit = 0;
  while (unit < UNITS.length - 1 && Math.round(value) >= 1024) {
    value /= 1024;
    unit++;
  }
  const rounded = Math.round(value * 10) / 10;
  const text = rounded < 10 ? rounded.toFixed(1) : String(Math.round(value));
  return `${text} ${UNITS[unit]}`;
}
