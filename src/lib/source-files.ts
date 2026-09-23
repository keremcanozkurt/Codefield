import type { TreeEntry } from "./github/types.ts";

export const SOURCE_EXTENSIONS = [".ts", ".tsx", ".js", ".jsx"] as const;

// Files above this size are nearly always generated or vendored, and each one
// is downloaded in full.
export const MAX_SOURCE_FILE_BYTES = 512 * 1024;

// Every loaded file costs one GitHub API request, so a single repository is
// capped well below the authenticated limit of 5,000 requests per hour.
export const MAX_SOURCE_FILES = 500;

const IGNORED_DIRECTORIES = new Set([
  "node_modules",
  "bower_components",
  "vendor",
  "dist",
  "build",
  "out",
  "coverage",
  ".next",
  ".nuxt",
  ".svelte-kit",
  ".output",
  ".turbo",
  ".vercel",
]);

const GENERATED_FILE_PATTERN = /\.(min|bundle)\.jsx?$/;

export type SourceExtension = (typeof SOURCE_EXTENSIONS)[number];
export type SourceLanguage = "typescript" | "javascript";

export type SourceCandidate = {
  path: string;
  sha: string;
  size: number;
  extension: SourceExtension;
  language: SourceLanguage;
};

export type SourceFile = SourceCandidate & {
  content: string;
};

export type SkipReason = "too_large" | "missing" | "content_mismatch" | "not_utf8";

export type SkippedSource = {
  path: string;
  reason: SkipReason;
};

export type SourceSelection = {
  candidates: SourceCandidate[];
  skipped: SkippedSource[];
  eligibleCount: number;
  limited: boolean;
};

export function selectSourceFiles(entries: TreeEntry[]): SourceSelection {
  const eligible: SourceCandidate[] = [];

  for (const entry of entries) {
    if (entry.type !== "blob" || entry.size === undefined) continue;
    if (isIgnoredPath(entry.path)) continue;

    const extension = sourceExtension(entry.path);
    if (extension === null) continue;

    eligible.push({
      path: entry.path,
      sha: entry.sha,
      size: entry.size,
      extension,
      language: extension === ".ts" || extension === ".tsx" ? "typescript" : "javascript",
    });
  }

  // Code-unit order rather than localeCompare, so the selection does not
  // depend on the server's locale.
  eligible.sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));

  const loadable: SourceCandidate[] = [];
  const skipped: SkippedSource[] = [];
  for (const candidate of eligible) {
    if (candidate.size > MAX_SOURCE_FILE_BYTES) {
      skipped.push({ path: candidate.path, reason: "too_large" });
    } else {
      loadable.push(candidate);
    }
  }

  return {
    candidates: loadable.slice(0, MAX_SOURCE_FILES),
    skipped,
    eligibleCount: eligible.length,
    limited: loadable.length > MAX_SOURCE_FILES,
  };
}

export function sourceExtension(path: string): SourceExtension | null {
  const name = path.slice(path.lastIndexOf("/") + 1);
  if (name.endsWith(".d.ts") || GENERATED_FILE_PATTERN.test(name)) return null;

  const dot = name.lastIndexOf(".");
  if (dot <= 0) return null;

  const extension = name.slice(dot);
  return isSourceExtension(extension) ? extension : null;
}

export function isIgnoredPath(path: string): boolean {
  const directories = path.split("/").slice(0, -1);
  return directories.some((directory) => IGNORED_DIRECTORIES.has(directory));
}

function isSourceExtension(value: string): value is SourceExtension {
  return (SOURCE_EXTENSIONS as readonly string[]).includes(value);
}
