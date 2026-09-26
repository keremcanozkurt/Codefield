import { stat } from "node:fs/promises";

import { selectConfigFiles } from "./analysis/config.ts";
import { analyzeModuleRelationships } from "./analysis/relationships.ts";
import { presentRepositoryError, type PresentedError } from "./errors/presentation.ts";
import { buildDependencyGraph } from "./graph/build.ts";
import { readConfigFiles, readSourceFiles } from "./local/read.ts";
import { describeRepository, type RepositoryIdentity } from "./local/repository.ts";
import { listRepository } from "./local/walk.ts";
import { selectSourceFiles, type SkippedSource } from "./source-files.ts";
import { toRenderGraph } from "./visualization/payload.ts";
import type { RenderGraph } from "./visualization/types.ts";

export type { RepositoryIdentity } from "./local/repository.ts";

// Why supported source files are missing from the graph or have no
// relationships.
export type SkipCounts = {
  // Larger than the per-file safety limit.
  tooLarge: number;
  // Symbolic links, which are never followed.
  symlinks: number;
  // Not UTF-8 text, or could not be opened or read.
  unreadable: number;
  // Shown in the graph, but its relationships could not be read.
  parseFailed: number;
  // Directories that could not be listed. Any source files inside them are
  // unknown, so they are counted separately from files.
  unreadableDirectories: number;
};

export type SuccessResult = {
  status: "success";
  repository: RepositoryIdentity & { fileCount: number };
  // Files skipped or read without relationships.
  skippedCount: number;
  skipped: SkipCounts;
  graph: RenderGraph;
};

export type DiscoveryProgress =
  | { stage: "discover"; files: number }
  | { stage: "read"; filesRead: number; files: number }
  | { stage: "analysis"; files: number }
  | { stage: "graph"; files: number };

export type DiscoveryResult =
  | SuccessResult
  | { status: "empty"; repository: RepositoryIdentity }
  // No supported file made it into the graph. `skippedCount` is non-zero when
  // there were supported files, but none of them could be read.
  | { status: "unsupported"; repository: RepositoryIdentity; skippedCount: number; skipped: SkipCounts }
  | { status: "error"; error: PresentedError; repository?: RepositoryIdentity };

export type DiscoveryOptions = {
  onProgress?(progress: DiscoveryProgress): void;
  signal?: AbortSignal;
};

// Analyzes the folder at `root`, which the caller has already resolved to a
// real path. Files are listed without reading them, source files are
// selected by path, and only those (plus the configuration files analyzers
// read) are opened. Nothing in the folder is executed.
export async function discoverRepository(root: string, options: DiscoveryOptions = {}): Promise<DiscoveryResult> {
  const progress = options.onProgress ?? (() => {});
  const { signal } = options;

  try {
    const stats = await stat(root);
    if (!stats.isDirectory()) return { status: "error", error: presentRepositoryError("not_a_directory") };
  } catch {
    return { status: "error", error: presentRepositoryError("root_unavailable") };
  }

  const identity = await describeRepository(root);

  progress({ stage: "discover", files: 0 });
  const listing = await listRepository(root, { signal, onProgress: (files) => progress({ stage: "discover", files }) });
  if (listing.files.length === 0 && listing.skipped.length === 0) {
    if (listing.unreadableDirectories > 0) {
      return { status: "error", error: presentRepositoryError("root_unavailable"), repository: identity };
    }
    return { status: "empty", repository: identity };
  }

  const selection = selectSourceFiles(listing.files);
  const selectionSkips = [...listing.skipped, ...selection.skipped];
  if (selection.candidates.length === 0) {
    return { status: "unsupported", repository: identity, ...skipSummary(selectionSkips, 0, listing.unreadableDirectories) };
  }

  const files = selection.candidates.length;
  progress({ stage: "read", filesRead: 0, files });
  const sources = await readSourceFiles(root, selection.candidates, {
    signal,
    onProgress: (filesRead) => progress({ stage: "read", filesRead, files }),
  });
  if (!sources.ok) return { status: "error", error: presentRepositoryError("resources_exceeded"), repository: identity };
  const configFiles = await readConfigFiles(root, selectConfigFiles(listing.files));

  progress({ stage: "analysis", files: sources.files.length });
  const analysis = analyzeModuleRelationships(sources.files, {
    configFiles,
    repositoryPaths: listing.files.map((file) => file.path),
  });
  progress({ stage: "graph", files: sources.files.length });
  const graph = buildDependencyGraph(sources.files, analysis.relationships);

  const skipped = skipSummary([...selectionSkips, ...sources.skipped], analysis.skipped.length, listing.unreadableDirectories);
  if (graph.nodes.length === 0) {
    return { status: "unsupported", repository: identity, ...skipped };
  }

  return {
    status: "success",
    repository: { ...identity, fileCount: listing.files.length },
    ...skipped,
    graph: toRenderGraph(graph),
  };
}

function skipSummary(files: SkippedSource[], parseFailed: number, unreadableDirectories: number) {
  const skipped: SkipCounts = { tooLarge: 0, symlinks: 0, unreadable: 0, parseFailed, unreadableDirectories };
  for (const { reason } of files) {
    if (reason === "too_large") skipped.tooLarge++;
    else if (reason === "symlink") skipped.symlinks++;
    else skipped.unreadable++;
  }
  const skippedCount = skipped.tooLarge + skipped.symlinks + skipped.unreadable + parseFailed + unreadableDirectories;
  return { skipped, skippedCount };
}
