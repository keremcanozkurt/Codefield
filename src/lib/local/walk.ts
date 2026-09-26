import type { Dirent } from "node:fs";
import { lstat, readdir } from "node:fs/promises";
import { join } from "node:path";

import { isAuxiliaryFileName } from "../analysis/config.ts";
import { isIgnoredDirectoryName, sourceExtension, type FileEntry, type SkippedSource } from "../source-files.ts";

export type RepositoryListing = {
  // Every regular file outside ignored directories, sorted by path. Sizes are
  // only read for files that can matter to the analysis: source files and the
  // configuration files analyzers read. Other files get size 0.
  files: FileEntry[];
  // Symbolic links that look like source files. Links are never followed.
  skipped: SkippedSource[];
  // Directories that could not be listed, for example for lack of permission.
  unreadableDirectories: number;
};

export type WalkOptions = {
  signal?: AbortSignal;
  // Called every so often with the number of files seen so far.
  onProgress?(files: number): void;
};

type Directory = { absolute: string; relative: string };

// Lists a directory tree without following symbolic links, so the listing can
// neither leave the root nor loop. Paths are built from directory entry names
// joined with "/", which keeps them repository-relative on every platform.
// Only names are read here; file contents are read later, and only for the
// files the analysis selects.
export async function listRepository(root: string, { signal, onProgress }: WalkOptions = {}): Promise<RepositoryListing> {
  const files: FileEntry[] = [];
  const skipped: SkippedSource[] = [];
  let unreadableDirectories = 0;
  // Bind mounts and similar can make a directory contain itself even without
  // symbolic links; each directory is entered once.
  const visited = new Set<string>();
  const stack: Directory[] = [{ absolute: root, relative: "" }];
  let reported = 0;

  while (stack.length > 0) {
    signal?.throwIfAborted();
    const directory = stack.pop()!;

    const identity = await directoryIdentity(directory.absolute);
    if (identity === null) {
      unreadableDirectories++;
      continue;
    }
    if (identity !== "" && visited.has(identity)) continue;
    if (identity !== "") visited.add(identity);

    let entries: Dirent[];
    try {
      entries = await readdir(directory.absolute, { withFileTypes: true });
    } catch {
      unreadableDirectories++;
      continue;
    }

    for (const entry of entries) {
      const relative = directory.relative === "" ? entry.name : `${directory.relative}/${entry.name}`;
      const absolute = join(directory.absolute, entry.name);
      const kind = await kindOf(entry, absolute);

      if (kind === "directory") {
        if (!isIgnoredDirectoryName(entry.name)) stack.push({ absolute, relative });
      } else if (kind === "symlink") {
        if (sourceExtension(relative) !== null) skipped.push({ path: relative, reason: "symlink" });
      } else if (kind === "file") {
        files.push({ path: relative, size: needsSize(relative) ? await sizeOf(absolute) : 0 });
      }
      // Sockets, FIFOs and devices are left out: reading a FIFO would block.
    }

    if (onProgress !== undefined && files.length - reported >= 500) {
      reported = files.length;
      onProgress(files.length);
    }
  }

  files.sort((a, b) => compare(a.path, b.path));
  skipped.sort((a, b) => compare(a.path, b.path));
  onProgress?.(files.length);
  return { files, skipped, unreadableDirectories };
}

type Kind = "directory" | "file" | "symlink" | "other";

async function kindOf(entry: Dirent, absolute: string): Promise<Kind> {
  if (entry.isSymbolicLink()) return "symlink";
  if (entry.isDirectory()) return "directory";
  if (entry.isFile()) return "file";
  if (entry.isFIFO() || entry.isSocket() || entry.isBlockDevice() || entry.isCharacterDevice()) return "other";
  // Some file systems do not report entry types in the listing.
  try {
    const stats = await lstat(absolute);
    if (stats.isSymbolicLink()) return "symlink";
    if (stats.isDirectory()) return "directory";
    if (stats.isFile()) return "file";
  } catch {
    // Removed while listing.
  }
  return "other";
}

// "device:inode", "" when the file system does not provide inode numbers, or
// null when the directory cannot be read.
async function directoryIdentity(absolute: string): Promise<string | null> {
  try {
    const stats = await lstat(absolute, { bigint: true });
    if (!stats.isDirectory()) return null;
    return stats.ino === BigInt(0) ? "" : `${stats.dev}:${stats.ino}`;
  } catch {
    return null;
  }
}

function needsSize(path: string): boolean {
  return sourceExtension(path) !== null || isAuxiliaryFileName(path.slice(path.lastIndexOf("/") + 1));
}

// Files whose size cannot be read are listed with size 0 and reported as
// unreadable when they are opened.
async function sizeOf(absolute: string): Promise<number> {
  try {
    return (await lstat(absolute)).size;
  } catch {
    return 0;
  }
}

// Code-unit order, as elsewhere in the analysis, so the result does not depend
// on the locale or on the order the file system lists entries in.
function compare(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}
