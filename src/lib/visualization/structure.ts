import { compareStrings } from "../analysis/paths.ts";
import { compareLanguages, type LanguageId } from "../languages/registry.ts";
import type { RenderGraph } from "./types.ts";

export type LanguageShare = { language: LanguageId; files: number };

export type StructureDirectory = {
  // Repository-relative, "/"-separated; "" is the repository root.
  path: string;
  // The last path segment; "" for the root.
  name: string;
  parent: string | null;
  // Direct subdirectories and direct files (file IDs), sorted by path.
  directories: string[];
  files: string[];
  // Files in this directory and everything below it.
  fileCount: number;
  // The same files by language, most files first.
  languages: LanguageShare[];
  // Dependency edges whose two files are both somewhere below this directory.
  internalEdges: number;
};

export type StructureTree = {
  directories: Map<string, StructureDirectory>;
  // The directory each file is directly in.
  fileDirectory: Map<string, string>;
};

type Building = Omit<StructureDirectory, "languages"> & {
  languageCounts: Map<LanguageId, number>;
  up: Building | null;
  depth: number;
};

// The directory hierarchy of the analyzed files, built from the paths already
// in the graph: nothing is read from disk. Every file is visited once per
// ancestor directory and every edge once per common ancestor, following
// parent links rather than splitting paths, so the cost is
// O((files + edges) × depth).
export function buildStructureTree(graph: RenderGraph): StructureTree {
  const building = new Map<string, Building>();
  const fileDirectory = new Map<string, string>();
  const fileNode = new Map<string, Building>();

  const ensure = (path: string): Building => {
    const existing = building.get(path);
    if (existing !== undefined) return existing;
    const up = path === "" ? null : ensure(parentPath(path));
    const directory: Building = {
      path,
      name: path.slice(path.lastIndexOf("/") + 1),
      parent: up?.path ?? null,
      directories: [],
      files: [],
      fileCount: 0,
      languageCounts: new Map(),
      internalEdges: 0,
      up,
      depth: up === null ? 0 : up.depth + 1,
    };
    building.set(path, directory);
    up?.directories.push(path);
    return directory;
  };
  ensure("");

  const pathOf = new Map<string, string>();
  for (const node of graph.nodes) {
    const home = ensure(node.directory);
    pathOf.set(node.id, node.path);
    fileDirectory.set(node.id, node.directory);
    fileNode.set(node.id, home);
    home.files.push(node.id);
    for (let current: Building | null = home; current !== null; current = current.up) {
      current.fileCount++;
      current.languageCounts.set(node.language, (current.languageCounts.get(node.language) ?? 0) + 1);
    }
  }

  for (const edge of graph.edges) {
    let a = fileNode.get(edge.source);
    let b = fileNode.get(edge.target);
    if (a === undefined || b === undefined || edge.source === edge.target) continue;
    while (a.depth > b.depth) a = a.up!;
    while (b.depth > a.depth) b = b.up!;
    while (a !== b) {
      a = a.up!;
      b = b.up!;
    }
    for (let current: Building | null = a; current !== null; current = current.up) current.internalEdges++;
  }

  const directories = new Map<string, StructureDirectory>();
  for (const directory of building.values()) {
    directories.set(directory.path, {
      path: directory.path,
      name: directory.name,
      parent: directory.parent,
      directories: directory.directories.sort(compareStrings),
      files: directory.files.sort((x, y) => compareStrings(pathOf.get(x)!, pathOf.get(y)!) || compareStrings(x, y)),
      fileCount: directory.fileCount,
      languages: [...directory.languageCounts]
        .map(([language, files]) => ({ language, files }))
        .sort((x, y) => y.files - x.files || compareLanguages(x.language, y.language)),
      internalEdges: directory.internalEdges,
    });
  }
  return { directories, fileDirectory };
}

export function parentPath(path: string): string {
  const slash = path.lastIndexOf("/");
  return slash === -1 ? "" : path.slice(0, slash);
}

// "", "src", "src/lib" … up to and including `path`.
export function ancestorPaths(path: string): string[] {
  if (path === "") return [""];
  const segments = path.split("/");
  return ["", ...segments.map((_, i) => segments.slice(0, i + 1).join("/"))];
}

// The directory itself if it still exists, otherwise its nearest existing
// ancestor, so a location survives files being deleted between analyses.
export function nearestDirectory(tree: StructureTree, path: string): string {
  let current = path;
  while (current !== "" && !tree.directories.has(current)) current = parentPath(current);
  return current;
}

// A directory with no files of its own and a single subdirectory adds a step
// without adding information, such as each level of src/main/java/com/acme.
// Structure passes through such directories as one step.
export function isPassThrough(directory: StructureDirectory): boolean {
  return directory.path !== "" && directory.files.length === 0 && directory.directories.length === 1;
}

// The end of a chain of pass-through directories starting at `path`.
export function chainEnd(tree: StructureTree, path: string): string {
  let current = tree.directories.get(path);
  while (current !== undefined && current.files.length === 0 && current.directories.length === 1) {
    current = tree.directories.get(current.directories[0]);
  }
  return current?.path ?? path;
}

// Where Structure should be for a requested location: the nearest existing
// directory, moved past pass-through directories. The root is always a place
// of its own, even when it only holds one directory.
export function canonicalFocus(tree: StructureTree, path: string): string {
  const existing = nearestDirectory(tree, path);
  return existing === "" ? "" : chainEnd(tree, existing);
}

// A previous location in a new analysis. If the directory still exists it is
// used as it is; if it is gone, Structure climbs to the nearest ancestor that
// still means something, rather than jumping sideways into whatever a
// pass-through ancestor now leads to.
export function survivingFocus(tree: StructureTree, path: string): string {
  const existing = nearestDirectory(tree, path);
  if (existing === path) return canonicalFocus(tree, existing);
  let current = existing;
  while (current !== "" && isPassThrough(tree.directories.get(current)!)) current = parentPath(current);
  return current;
}

export type StructureStep = {
  // The directory the step lands on.
  path: string;
  // Its name relative to the previous step: one segment, or several joined
  // with "/" when the step passes through directories.
  label: string;
};

// The subdirectories shown for a directory, each carried to the end of its
// pass-through chain.
export function childSteps(tree: StructureTree, path: string): StructureStep[] {
  const directory = tree.directories.get(path);
  if (directory === undefined) return [];
  return directory.directories.map((child) => {
    const end = chainEnd(tree, child);
    return { path: end, label: relativeLabel(path, end) };
  });
}

// The steps from the root to `path`, grouping pass-through directories with
// the directory they lead to, as the breadcrumb shows them. The first step is
// the root, with an empty label.
export function trail(tree: StructureTree, path: string): StructureStep[] {
  const ancestors = ancestorPaths(path);
  const steps: StructureStep[] = [{ path: "", label: "" }];
  let previous = "";
  for (let i = 1; i < ancestors.length; i++) {
    const directory = tree.directories.get(ancestors[i]);
    const last = i === ancestors.length - 1;
    if (!last && directory !== undefined && isPassThrough(directory)) continue;
    steps.push({ path: ancestors[i], label: relativeLabel(previous, ancestors[i]) });
    previous = ancestors[i];
  }
  return steps;
}

function relativeLabel(from: string, to: string): string {
  return from === "" ? to : to.slice(from.length + 1);
}

// Files passing the active filters below each directory, or null when no
// filter is active. Directories stay in Structure whatever the filters; only
// their counts change, so the hierarchy never rearranges itself.
export function visibleFileCounts(tree: StructureTree, visible: Set<string> | null): Map<string, number> | null {
  if (visible === null) return null;
  const counts = new Map<string, number>();
  for (const path of tree.directories.keys()) counts.set(path, 0);
  for (const id of visible) {
    for (let current: string | null = tree.fileDirectory.get(id) ?? null; current !== null; current = tree.directories.get(current)!.parent) {
      counts.set(current, counts.get(current)! + 1);
    }
  }
  return counts;
}
