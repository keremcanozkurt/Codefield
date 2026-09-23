import { compareStrings, directoryOf } from "../analysis/paths.ts";

export type DirectoryGroup = {
  // The deepest directory this group stands for, "" for the repository root.
  path: string;
  // Directories that held nothing but the next one and were merged into this
  // group, outermost first. Empty unless the group is the end of such a chain.
  merged: string[];
  // Paths of the files directly in `path`.
  files: string[];
  children: DirectoryGroup[];
  // Files in this group and all groups below it.
  fileCount: number;
};

type MutableGroup = { path: string; files: string[]; children: Map<string, MutableGroup> };

// Builds the directory tree the layout places files by. Paths are
// repository-relative and "/"-separated; anything else, including "\", is
// part of a name. Files and children are sorted by code unit, so the result
// does not depend on input order or locale.
//
// A directory whose only content is a single subdirectory is merged into that
// subdirectory, so src/application/server/internal/thing.ts forms one group
// instead of four nested ones. This applies to the root as well: a repository
// with everything under src/ gets src as its top group. Only the layout sees
// the merged tree; file paths are not changed.
export function buildDirectoryTree(paths: Iterable<string>): DirectoryGroup {
  const root: MutableGroup = { path: "", files: [], children: new Map() };

  for (const path of paths) {
    let group = root;
    const directory = directoryOf(path);
    if (directory !== "") {
      let current = "";
      for (const segment of directory.split("/")) {
        current = current === "" ? segment : `${current}/${segment}`;
        let child = group.children.get(segment);
        if (child === undefined) {
          child = { path: current, files: [], children: new Map() };
          group.children.set(segment, child);
        }
        group = child;
      }
    }
    group.files.push(path);
  }

  return compress(freeze(root), []);
}

function freeze(group: MutableGroup): DirectoryGroup {
  const children = [...group.children.values()]
    .map(freeze)
    .sort((a, b) => compareStrings(a.path, b.path));
  const files = [...group.files].sort(compareStrings);
  const fileCount = files.length + children.reduce((sum, child) => sum + child.fileCount, 0);
  return { path: group.path, merged: [], files, children, fileCount };
}

function compress(group: DirectoryGroup, merged: string[]): DirectoryGroup {
  if (group.files.length === 0 && group.children.length === 1) {
    return compress(group.children[0], group.path === "" ? merged : [...merged, group.path]);
  }
  return {
    ...group,
    merged,
    children: group.children.map((child) => compress(child, [])),
  };
}

// Every group in the tree, parents before children.
export function flattenGroups(root: DirectoryGroup): DirectoryGroup[] {
  const groups: DirectoryGroup[] = [];
  const visit = (group: DirectoryGroup) => {
    groups.push(group);
    group.children.forEach(visit);
  };
  visit(root);
  return groups;
}
