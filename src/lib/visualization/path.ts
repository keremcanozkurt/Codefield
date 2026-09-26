import type { GraphIndex } from "./inspection.ts";
import { fileName } from "./mapping.ts";

// The shortest chain of dependencies from one file to another. An edge a -> b
// means a imports, re-exports, includes or requires b, so a path runs in that
// direction: source depends on target through every file in between. Only
// the static dependency graph is searched; files with no path may still
// interact at runtime.
export type PathResult = {
  source: string;
  target: string;
  // Every file on the path, source first and target last; [source] when both
  // are the same file; null when there is no directed path.
  files: string[] | null;
};

// Breadth-first over outgoing edges, which gives a shortest path and visits
// each file once, so cycles are safe. Each file's dependencies are listed in
// path order, so among several shortest paths the one found first is chosen
// the same way every time. Runs on the full graph: filters never change it.
export function findPath(index: GraphIndex, source: string | null, target: string | null): PathResult | null {
  if (source === null || target === null || !index.nodeById.has(source) || !index.nodeById.has(target)) return null;
  if (source === target) return { source, target, files: [source] };

  const previous = new Map<string, string>([[source, source]]);
  let frontier = [source];
  while (frontier.length > 0) {
    const next: string[] = [];
    for (const file of frontier) {
      for (const { id: dependency } of index.outgoing.get(file) ?? []) {
        if (previous.has(dependency)) continue;
        previous.set(dependency, file);
        if (dependency === target) return { source, target, files: unwind(previous, source, target) };
        next.push(dependency);
      }
    }
    frontier = next;
  }
  return { source, target, files: null };
}

function unwind(previous: Map<string, string>, source: string, target: string): string[] {
  const files = [target];
  let current = target;
  while (current !== source) {
    current = previous.get(current)!;
    files.push(current);
  }
  return files.reverse();
}

export type PathView = {
  source: string;
  target: string;
  // Position of each file on the path; empty when there is no path.
  order: Map<string, number>;
  // Edges on the path, as pathEdgeKey(source, target).
  edges: Set<string>;
};

export function pathEdgeKey(source: string, target: string): string {
  return `${source}\0${target}`;
}

export function pathView(result: PathResult): PathView {
  const files = result.files ?? [];
  return {
    source: result.source,
    target: result.target,
    order: new Map(files.map((file, i) => [file, i])),
    edges: new Set(files.slice(1).map((file, i) => pathEdgeKey(files[i], file))),
  };
}

export type PathFile = { id: string; name: string; directory: string; hidden: boolean };

export type PathDetails = {
  sourceName: string;
  targetName: string;
  // Null when there is no path.
  files: PathFile[] | null;
  steps: number;
  // Files on the path that the active filters hide.
  hidden: number;
};

export function describePath(index: GraphIndex, result: PathResult, visible: Set<string> | null): PathDetails {
  const name = (id: string) => fileName(index.nodeById.get(id)!.path);
  const files =
    result.files?.map((id) => {
      const node = index.nodeById.get(id)!;
      return { id, name: fileName(node.path), directory: node.directory, hidden: visible !== null && !visible.has(id) };
    }) ?? null;
  return {
    sourceName: name(result.source),
    targetName: name(result.target),
    files,
    steps: files === null ? 0 : files.length - 1,
    hidden: files?.filter((file) => file.hidden).length ?? 0,
  };
}
