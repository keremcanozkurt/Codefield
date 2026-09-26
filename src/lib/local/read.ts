import { constants } from "node:fs";
import { open, realpath } from "node:fs/promises";
import path, { join } from "node:path";

import type { ConfigCandidate, ConfigFile } from "../analysis/config.ts";
import { MAX_CONFIG_FILE_BYTES } from "../analysis/config.ts";
import { MAX_SOURCE_BYTES_IN_MEMORY, MAX_SOURCE_FILE_BYTES } from "../resources.ts";
import type { SkippedSource, SourceCandidate, SourceFile } from "../source-files.ts";

const utf8 = new TextDecoder("utf-8", { fatal: true });

// O_NOFOLLOW makes opening a file that was replaced by a symbolic link after
// it was listed fail. Windows has no equivalent flag; the realpath check
// below covers both platforms.
const OPEN_FLAGS = constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0);
const CONCURRENCY = 16;

export type ReadResult =
  | { ok: true; files: SourceFile[]; skipped: SkippedSource[] }
  | { ok: false; reason: "resources_exceeded" };

export type ReadOptions = {
  maxFileBytes?: number;
  maxTotalBytes?: number;
  signal?: AbortSignal;
  onProgress?(filesRead: number): void;
};

type FileRead = { ok: true; text: string } | { ok: false; reason: SkippedSource["reason"] };

// Reads the selected source files below `root`, a few at a time. A file that
// is too large, not UTF-8, or no longer a regular file inside the root is
// skipped with its reason; the rest of the analysis continues.
export async function readSourceFiles(
  root: string,
  candidates: SourceCandidate[],
  {
    maxFileBytes = MAX_SOURCE_FILE_BYTES,
    maxTotalBytes = MAX_SOURCE_BYTES_IN_MEMORY,
    signal,
    onProgress,
  }: ReadOptions = {},
): Promise<ReadResult> {
  const results: (SourceFile | SkippedSource)[] = new Array(candidates.length);
  let next = 0;
  let totalBytes = 0;
  let exceeded = false;
  let filesRead = 0;

  async function worker() {
    while (!exceeded && next < candidates.length) {
      signal?.throwIfAborted();
      const index = next++;
      const candidate = candidates[index];
      const read = await readTextFile(root, candidate.path, maxFileBytes);
      if (read.ok) {
        totalBytes += read.text.length;
        if (totalBytes > maxTotalBytes) exceeded = true;
        results[index] = { ...candidate, content: read.text };
      } else {
        results[index] = { path: candidate.path, reason: read.reason };
      }
      filesRead++;
      if (onProgress !== undefined && filesRead % 200 === 0) onProgress(filesRead);
    }
  }

  await Promise.all(Array.from({ length: Math.min(CONCURRENCY, candidates.length) }, worker));
  if (exceeded) return { ok: false, reason: "resources_exceeded" };
  onProgress?.(filesRead);

  const files: SourceFile[] = [];
  const skipped: SkippedSource[] = [];
  for (const result of results) {
    if ("content" in result) files.push(result);
    else skipped.push(result);
  }
  return { ok: true, files, skipped };
}

// Configuration files that cannot be read are left out: the analyzers treat a
// missing config the same way as an absent one.
export async function readConfigFiles(root: string, candidates: ConfigCandidate[]): Promise<ConfigFile[]> {
  const files: ConfigFile[] = [];
  for (const candidate of candidates) {
    const read = await readTextFile(root, candidate.path, MAX_CONFIG_FILE_BYTES);
    if (read.ok) files.push({ path: candidate.path, content: read.text });
  }
  return files;
}

export async function readTextFile(root: string, path: string, maxBytes: number): Promise<FileRead> {
  const absolute = join(root, ...path.split("/"));
  let handle;
  try {
    handle = await open(absolute, OPEN_FLAGS);
  } catch (error) {
    return { ok: false, reason: (error as NodeJS.ErrnoException).code === "ELOOP" ? "symlink" : "unreadable" };
  }
  try {
    const stats = await handle.stat();
    if (!stats.isFile()) return { ok: false, reason: "unreadable" };
    // A directory on the way could have been swapped for a link since the
    // listing; the file actually opened must still be inside the root.
    if (!isInside(root, await realpath(absolute))) return { ok: false, reason: "symlink" };
    if (stats.size > maxBytes) return { ok: false, reason: "too_large" };

    // One byte more than allowed, to notice a file that grew after stat.
    const buffer = Buffer.allocUnsafe(Math.min(stats.size, maxBytes) + 1);
    let length = 0;
    while (length < buffer.length) {
      const { bytesRead } = await handle.read(buffer, length, buffer.length - length, length);
      if (bytesRead === 0) break;
      length += bytesRead;
    }
    if (length > maxBytes) return { ok: false, reason: "too_large" };
    try {
      return { ok: true, text: utf8.decode(buffer.subarray(0, length)) };
    } catch {
      return { ok: false, reason: "not_utf8" };
    }
  } catch {
    return { ok: false, reason: "unreadable" };
  } finally {
    await handle.close();
  }
}

// `paths` is the platform's path module; tests pass path.win32 to check
// drive letters and case-insensitive names on any platform.
export function isInside(root: string, target: string, paths: typeof path = path): boolean {
  const relative = paths.relative(root, target);
  return relative === "" || (relative !== ".." && !relative.startsWith(`..${paths.sep}`) && !paths.isAbsolute(relative));
}
