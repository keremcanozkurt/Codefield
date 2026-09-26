import {
  isSourceExtension,
  languageForExtension,
  type LanguageId,
  type SourceExtension,
} from "./languages/registry.ts";
import { MAX_SOURCE_FILE_BYTES } from "./resources.ts";

export { SOURCE_EXTENSIONS, type SourceExtension } from "./languages/registry.ts";

export { MAX_SOURCE_FILE_BYTES } from "./resources.ts";

// Dependency, build-output and tool directories. Only names that are almost
// never used for hand-written source are listed: "bin", for example, holds Rust
// binaries and Ruby executables, so it is not ignored even though .NET builds
// into it.
const IGNORED_DIRECTORIES = new Set([
  // Version control metadata
  ".git",
  ".hg",
  ".svn",
  // JavaScript
  "node_modules",
  "bower_components",
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
  // Go, PHP (Composer), Ruby (vendor/bundle) and vendored C
  "vendor",
  // Python
  ".venv",
  "venv",
  "__pycache__",
  ".mypy_cache",
  ".pytest_cache",
  ".ruff_cache",
  ".tox",
  ".eggs",
  "site-packages",
  // Rust, Maven and sbt output
  "target",
  // Gradle
  ".gradle",
  // .NET intermediate output, which also holds generated .cs files
  "obj",
  // Dart
  ".dart_tool",
  // Elixir
  "_build",
  "deps",
  // Swift and CocoaPods
  ".build",
  "Pods",
  "Carthage",
  "DerivedData",
]);

const GENERATED_FILE_PATTERN = /\.(min|bundle)\.jsx?$/;

export type SourceLanguage = LanguageId;

// A regular file in the repository, by repository-relative path with "/"
// separators on every platform.
export type FileEntry = {
  path: string;
  size: number;
};

export type SourceCandidate = {
  path: string;
  size: number;
  extension: SourceExtension;
  language: SourceLanguage;
};

export type SourceFile = SourceCandidate & {
  content: string;
};

// too_large: over the per-file limit. not_utf8: not UTF-8 text. symlink: a
// symbolic link, which is never followed. unreadable: the file could not be
// opened or read, or changed into something other than a regular file.
export type SkipReason = "too_large" | "not_utf8" | "symlink" | "unreadable";

export type SkippedSource = {
  path: string;
  reason: SkipReason;
};

export type SourceSelection = {
  candidates: SourceCandidate[];
  skipped: SkippedSource[];
  eligibleCount: number;
};

export function selectSourceFiles(entries: FileEntry[]): SourceSelection {
  const eligible: SourceCandidate[] = [];

  for (const entry of entries) {
    if (isIgnoredPath(entry.path)) continue;

    const extension = sourceExtension(entry.path);
    if (extension === null) continue;

    eligible.push({
      path: entry.path,
      size: entry.size,
      extension,
      language: languageForExtension(extension)!.id,
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

  return { candidates: loadable, skipped, eligibleCount: eligible.length };
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
  return path.split("/").slice(0, -1).some(isIgnoredDirectoryName);
}

export function isIgnoredDirectoryName(name: string): boolean {
  return IGNORED_DIRECTORIES.has(name) || name.endsWith(".egg-info");
}
