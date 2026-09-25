import { compareStrings } from "../analysis/paths.ts";
import type { GraphIndex } from "./inspection.ts";
import { fileName } from "./mapping.ts";

// Files a change to `source` could reach through the dependency graph. An edge
// a -> b means a imports, re-exports or requires b, so a change to b can reach
// a: the trace follows edges backwards. This is static structure only. A file
// listed here depends on the source; nothing says it will break or change.
export type Impact = {
  source: string;
  // Dependency depth of every potentially affected file: 1 for direct
  // dependents, 2 for files that depend on those, and so on, using the
  // shortest distance. The source is never included, even when it sits in a
  // cycle and so depends on itself.
  depths: Map<string, number>;
  // The same files grouped by depth, levels[0] being the direct dependents.
  // Each level is sorted by path.
  levels: string[][];
};

// Breadth-first over incoming edges, so each file is visited once and gets its
// shortest depth. Traverses the full graph index: filters never change it.
export function traceImpact(index: GraphIndex, id: string | null): Impact | null {
  if (id === null || !index.nodeById.has(id)) return null;

  const byPath = (a: string, b: string) =>
    compareStrings(index.nodeById.get(a)!.path, index.nodeById.get(b)!.path) || compareStrings(a, b);

  const depths = new Map<string, number>();
  const levels: string[][] = [];
  const seen = new Set([id]);
  let frontier = [id];
  while (frontier.length > 0) {
    const next: string[] = [];
    for (const file of frontier) {
      for (const { id: dependent } of index.incoming.get(file) ?? []) {
        if (seen.has(dependent)) continue;
        seen.add(dependent);
        next.push(dependent);
      }
    }
    if (next.length === 0) break;
    next.sort(byPath);
    for (const file of next) depths.set(file, levels.length + 1);
    levels.push(next);
    frontier = next;
  }
  return { source: id, depths, levels };
}

export function directDependentCount(impact: Impact): number {
  return impact.levels[0]?.length ?? 0;
}

export function maxDependencyDepth(impact: Impact): number {
  return impact.levels.length;
}

// The depth of `from` when the edge from -> to is a step outwards from the
// source: `from` depends on `to` and lies exactly one level further out. Other
// edges between affected files (within a level, or back towards the source
// through a cycle) are real dependencies but not the shortest route, and
// return null so the propagation stays readable.
export function propagationDepth(impact: Impact, from: string, to: string): number | null {
  const fromDepth = impact.depths.get(from);
  if (fromDepth === undefined) return null;
  const toDepth = to === impact.source ? 0 : impact.depths.get(to);
  return toDepth === fromDepth - 1 ? fromDepth : null;
}

export type ImpactFile = { id: string; name: string; directory: string };

export type ImpactDetails = {
  direct: number;
  affected: number;
  maxDepth: number;
  // Potentially affected files that pass the active filters, or null when no
  // filter is active. Filters change only this count, never the trace.
  visibleAffected: number | null;
  levels: { depth: number; files: ImpactFile[] }[];
};

export function describeImpact(index: GraphIndex, impact: Impact, visible: Set<string> | null): ImpactDetails {
  let visibleAffected: number | null = null;
  if (visible !== null) {
    visibleAffected = 0;
    for (const id of impact.depths.keys()) if (visible.has(id)) visibleAffected++;
  }
  return {
    direct: directDependentCount(impact),
    affected: impact.depths.size,
    maxDepth: maxDependencyDepth(impact),
    visibleAffected,
    levels: impact.levels.map((ids, i) => ({
      depth: i + 1,
      files: ids.map((id) => {
        const node = index.nodeById.get(id)!;
        return { id, name: fileName(node.path), directory: node.directory };
      }),
    })),
  };
}
