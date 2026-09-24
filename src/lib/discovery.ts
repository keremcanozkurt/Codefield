import { selectConfigFiles } from "./analysis/config.ts";
import { analyzeModuleRelationships } from "./analysis/relationships.ts";
import { presentGitHubError, type PresentedError } from "./errors/presentation.ts";
import { loadSourceFiles } from "./github/archive.ts";
import { readGitHubToken } from "./github/client.ts";
import { fetchRepositoryMetadata, fetchRepositoryTree } from "./github/repository.ts";
import { buildDependencyGraph } from "./graph/build.ts";
import { parseRepositoryUrl } from "./repository-url.ts";
import { selectSourceFiles } from "./source-files.ts";
import { toRenderGraph } from "./visualization/payload.ts";
import type { RenderGraph } from "./visualization/types.ts";

// The repository identity shown in the status line and in non-error notices,
// available as soon as the metadata request succeeds.
export type RepositoryIdentity = {
  fullName: string;
  defaultBranch: string;
};

export type SuccessResult = {
  status: "success";
  repository: RepositoryIdentity & { entryCount: number };
  // Non-fatal notes about the analysis: files skipped for any reason, and
  // whether the repository exceeded the source-file cap. Neither blocks the
  // graph from rendering.
  skippedCount: number;
  limited: boolean;
  graph: RenderGraph;
};

export type DiscoveryResult =
  | SuccessResult
  | { status: "empty"; repository: RepositoryIdentity }
  | { status: "unsupported"; repository: RepositoryIdentity }
  // `repository` is set when the repository was already confirmed to exist
  // before the failure, so the status line can still show its identity.
  | { status: "error"; error: PresentedError; repository?: RepositoryIdentity };

function errorResult(error: PresentedError, repository?: RepositoryIdentity): DiscoveryResult {
  return { status: "error", error, repository };
}

export async function discoverRepository(input: unknown): Promise<DiscoveryResult> {
  if (typeof input !== "string") {
    return errorResult({ title: "Invalid repository URL", message: "Enter a GitHub repository URL.", retryable: false });
  }

  const parsed = parseRepositoryUrl(input);
  if (!parsed.ok) {
    return errorResult({ title: "Invalid repository URL", message: parsed.error, retryable: false });
  }

  const token = readGitHubToken();

  const metadata = await fetchRepositoryMetadata(parsed.repository, { token });
  if (!metadata.ok) return errorResult(presentGitHubError(metadata.error));

  const identity: RepositoryIdentity = {
    fullName: metadata.data.fullName,
    defaultBranch: metadata.data.defaultBranch,
  };

  const tree = await fetchRepositoryTree(metadata.data, { token });
  if (!tree.ok) {
    // GitHub answers the tree request the same way for an empty repository as
    // for one it cannot list; both are shown as "nothing to analyze" rather
    // than as an error.
    if (tree.error.code === "tree_unavailable") {
      return { status: "empty", repository: identity };
    }
    return errorResult(presentGitHubError(tree.error), identity);
  }

  if (tree.data.entries.length === 0) {
    return { status: "empty", repository: identity };
  }

  const selection = selectSourceFiles(tree.data.entries);
  if (selection.candidates.length === 0) {
    return { status: "unsupported", repository: identity };
  }

  const sources = await loadSourceFiles(metadata.data, selection.candidates, {
    token,
    extraFiles: selectConfigFiles(tree.data.entries),
  });
  if (!sources.ok) return errorResult(presentGitHubError(sources.error), identity);

  const analysis = analyzeModuleRelationships(sources.data.files, {
    configFiles: sources.data.extraFiles,
    repositoryPaths: tree.data.entries.filter((entry) => entry.type === "blob").map((entry) => entry.path),
  });
  const graph = buildDependencyGraph(sources.data.files, analysis.relationships);

  if (graph.nodes.length === 0) {
    return { status: "unsupported", repository: identity };
  }

  return {
    status: "success",
    repository: { ...identity, entryCount: tree.data.entries.length },
    skippedCount: selection.skipped.length + sources.data.skipped.length,
    limited: selection.limited,
    graph: toRenderGraph(graph),
  };
}
