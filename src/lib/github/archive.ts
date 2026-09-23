import { createHash } from "node:crypto";

import { unzipSync } from "fflate";

import type { SkippedSource, SourceCandidate, SourceFile } from "../source-files.ts";
import { downloadGitHubArchive, type GitHubRequestOptions } from "./client.ts";
import type { GitHubError, GitHubResult, RepositoryMetadata } from "./types.ts";

// The archive is held in memory while the selected files are extracted.
export const MAX_ARCHIVE_BYTES = 50 * 1024 * 1024;

// Matches the entry cap of GitHub's recursive tree endpoint.
export const MAX_ARCHIVE_ENTRIES = 100_000;

const utf8 = new TextDecoder("utf-8", { fatal: true });

export type ArchiveFileCandidate = {
  path: string;
  sha: string;
  size: number;
};

export type ArchiveTextFile = {
  path: string;
  content: string;
};

export type SourceLoadResult = {
  files: SourceFile[];
  skipped: SkippedSource[];
  // Requested extra files that were found and matched the tree. Missing or
  // unreadable ones are left out.
  extraFiles: ArchiveTextFile[];
};

type ExtractOptions = {
  maxEntries?: number;
  extraFiles?: ArchiveFileCandidate[];
};

type LoadOptions = GitHubRequestOptions & {
  // Small non-source files, such as tsconfig.json, read from the same archive.
  extraFiles?: ArchiveFileCandidate[];
};

export async function loadSourceFiles(
  repository: Pick<RepositoryMetadata, "owner" | "name" | "defaultBranch">,
  candidates: SourceCandidate[],
  { extraFiles = [], ...options }: LoadOptions = {},
): Promise<GitHubResult<SourceLoadResult>> {
  if (candidates.length === 0) {
    return { ok: true, data: { files: [], skipped: [], extraFiles: [] } };
  }

  const path = [
    "/repos",
    encodeURIComponent(repository.owner),
    encodeURIComponent(repository.name),
    "zipball",
    encodeURIComponent(repository.defaultBranch),
  ].join("/");

  const download = await downloadGitHubArchive(path, MAX_ARCHIVE_BYTES, options);
  if (!download.ok) {
    if (download.status === 404) {
      return {
        ok: false,
        error: {
          code: "archive_unavailable",
          message: "GitHub did not provide an archive for this repository.",
        },
      };
    }
    return { ok: false, error: download.error };
  }

  return extractSourceFiles(download.bytes, candidates, { extraFiles });
}

export function extractSourceFiles(
  archive: Uint8Array,
  candidates: SourceCandidate[],
  { maxEntries = MAX_ARCHIVE_ENTRIES, extraFiles = [] }: ExtractOptions = {},
): GitHubResult<SourceLoadResult> {
  const wanted = new Map<string, ArchiveFileCandidate>(
    [...extraFiles, ...candidates].map((candidate) => [candidate.path, candidate]),
  );
  const seen = new Set<string>();
  const mismatched = new Set<string>();
  let root = null as string | null;
  let entryCount = 0;
  let failure = null as GitHubError | null;

  let extracted: Record<string, Uint8Array>;
  try {
    extracted = unzipSync(archive, {
      filter(entry) {
        if (failure !== null) return false;

        entryCount++;
        if (entryCount > maxEntries) {
          failure = {
            code: "archive_too_large",
            message: "This repository has too many files for Codefield to read.",
          };
          return false;
        }

        const parsed = parseArchivePath(entry.name);
        root ??= parsed?.root ?? null;
        if (parsed === null || parsed.root !== root) {
          failure = malformedArchive();
          return false;
        }
        if (parsed.isDirectory) return false;

        if (seen.has(parsed.path)) {
          failure = malformedArchive();
          return false;
        }
        seen.add(parsed.path);

        const candidate = wanted.get(parsed.path);
        if (candidate === undefined) return false;

        // Checking the declared size before inflating bounds the memory used
        // per entry by the already-capped candidate size.
        const supported = entry.compression === 0 || entry.compression === 8;
        if (!supported || entry.originalSize !== candidate.size) {
          mismatched.add(parsed.path);
          return false;
        }
        return true;
      },
    });
  } catch {
    return { ok: false, error: malformedArchive() };
  }

  if (failure !== null) return { ok: false, error: failure };

  const files: SourceFile[] = [];
  const skipped: SkippedSource[] = [];

  for (const candidate of candidates) {
    if (!seen.has(candidate.path)) {
      skipped.push({ path: candidate.path, reason: "missing" });
      continue;
    }

    const bytes = extracted[`${root}/${candidate.path}`];
    if (
      bytes === undefined ||
      mismatched.has(candidate.path) ||
      !matchesBlob(bytes, candidate)
    ) {
      skipped.push({ path: candidate.path, reason: "content_mismatch" });
      continue;
    }

    try {
      files.push({ ...candidate, content: utf8.decode(bytes) });
    } catch {
      skipped.push({ path: candidate.path, reason: "not_utf8" });
    }
  }

  const extra: ArchiveTextFile[] = [];
  for (const candidate of extraFiles) {
    const bytes = extracted[`${root}/${candidate.path}`];
    if (bytes === undefined || !matchesBlob(bytes, candidate)) continue;
    try {
      extra.push({ path: candidate.path, content: utf8.decode(bytes) });
    } catch {
      // Unreadable extra files are treated as absent.
    }
  }

  return { ok: true, data: { files, skipped, extraFiles: extra } };
}

// GitHub archives put every entry under one generated directory, such as
// "owner-repo-1a2b3c4/". Returns null for names that could not come from a
// Git tree: absolute paths, empty, "." or ".." segments, and files outside
// that directory.
function parseArchivePath(
  name: string,
): { root: string; path: string; isDirectory: boolean } | null {
  if (name.includes("\0")) return null;

  const isDirectory = name.endsWith("/");
  const segments = (isDirectory ? name.slice(0, -1) : name).split("/");
  if (segments.some((segment) => segment === "" || segment === "." || segment === "..")) {
    return null;
  }

  const [root, ...rest] = segments;
  if (rest.length === 0 && !isDirectory) return null;

  return { root, path: rest.join("/"), isDirectory };
}

// A Git blob ID is the SHA-1 of "blob <size>\0" followed by the content, so the
// archive entry can be checked against the tree without another request.
function matchesBlob(bytes: Uint8Array, candidate: ArchiveFileCandidate): boolean {
  if (bytes.length !== candidate.size) return false;

  const sha = createHash("sha1")
    .update(`blob ${bytes.length}\0`)
    .update(bytes)
    .digest("hex");
  return sha === candidate.sha;
}

function malformedArchive(): GitHubError {
  return {
    code: "malformed_archive",
    message: "GitHub returned a repository archive Codefield could not read.",
  };
}
