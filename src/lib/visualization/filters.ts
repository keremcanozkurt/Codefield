import { compareStrings } from "../analysis/paths.ts";
import { compareLanguages, type LanguageId } from "../languages/registry.ts";
import type { GraphIndex } from "./inspection.ts";

export type LanguageFilter = "all" | LanguageId;
export type ConnectivityFilter = "all" | "connected" | "isolated";

export type FilterState = {
  language: LanguageFilter;
  // "all", or a directory path as stored on the node ("" is the repository root).
  directory: string;
  connectivity: ConnectivityFilter;
  minDegree: number;
};

export const ALL_DIRECTORIES = "all";

export const DEFAULT_FILTERS: FilterState = {
  language: "all",
  directory: ALL_DIRECTORIES,
  connectivity: "all",
  minDegree: 0,
};

export function isDefaultFilters(filters: FilterState): boolean {
  return (
    filters.language === "all" &&
    filters.directory === ALL_DIRECTORIES &&
    filters.connectivity === "all" &&
    filters.minDegree <= 0
  );
}

export function activeFilterCount(filters: FilterState): number {
  let count = 0;
  if (filters.language !== "all") count++;
  if (filters.directory !== ALL_DIRECTORIES) count++;
  if (filters.connectivity !== "all") count++;
  if (filters.minDegree > 0) count++;
  return count;
}

// Every directory that appears in the graph, sorted so the repository root
// ("") sorts first. Filtering does not change this list: it reflects the full
// analyzed repository, not the current view.
export function directoryOptions(index: GraphIndex): string[] {
  const directories = new Set<string>();
  for (const node of index.nodeById.values()) directories.add(node.directory);
  return [...directories].sort(compareStrings);
}

// Languages present in the graph, in registry order. Like the directory list,
// it reflects the full repository, not the filtered view.
export function languageOptions(index: GraphIndex): LanguageId[] {
  const languages = new Set<LanguageId>();
  for (const node of index.nodeById.values()) languages.add(node.language);
  return [...languages].sort(compareLanguages);
}

// Nodes that pass every active filter. Returns null when no filter is active,
// which callers can treat as "everything is visible" without building a set
// the size of the graph.
export function visibleNodeIds(index: GraphIndex, filters: FilterState): Set<string> | null {
  if (isDefaultFilters(filters)) return null;

  const visible = new Set<string>();
  for (const node of index.nodeById.values()) {
    if (filters.language !== "all" && node.language !== filters.language) continue;
    if (filters.directory !== ALL_DIRECTORIES && node.directory !== filters.directory) continue;
    if (filters.connectivity === "connected" && node.degree === 0) continue;
    if (filters.connectivity === "isolated" && node.degree !== 0) continue;
    if (node.degree < filters.minDegree) continue;
    visible.add(node.id);
  }
  return visible;
}

export function isNodeVisible(visible: Set<string> | null, id: string): boolean {
  return visible === null || visible.has(id);
}

export function isEdgeVisible(visible: Set<string> | null, source: string, target: string): boolean {
  return visible === null || (visible.has(source) && visible.has(target));
}

// A previously selected file, resolved against the current filters: the same
// file if it is still visible, otherwise null. A filter change should clear a
// selection it hides rather than keep an inspector open for an invisible node.
export function resolveSelection(id: string | null, visible: Set<string> | null): string | null {
  if (id === null) return null;
  return isNodeVisible(visible, id) ? id : null;
}

// Search results are limited to the currently visible files by default, so a
// hidden file cannot be reached through search while a filter excludes it.
export function withinVisible<T extends { id: string }>(items: T[], visible: Set<string> | null): T[] {
  return visible === null ? items : items.filter((item) => visible.has(item.id));
}

export type FilterCounts = { visible: number; total: number };

export function filterCounts(index: GraphIndex, visible: Set<string> | null): FilterCounts {
  const total = index.entries.length;
  return { visible: visible === null ? total : visible.size, total };
}
