import { selectConfigFiles } from "./analysis/config.ts";
import { analyzeModuleRelationships } from "./analysis/relationships.ts";
import {
  presentAccessProblem,
  presentConnectionProblem,
  presentGitHubError,
  type PresentedError,
} from "./errors/presentation.ts";
import { connectPath } from "./github/app.ts";
import { loadSourceFiles } from "./github/archive.ts";
import { readGitHubToken, type GitHubRequestOptions } from "./github/client.ts";
import type { GitHubConnection } from "./github/connection.ts";
import { countUserInstallations } from "./github/oauth.ts";
import { fetchRepositoryMetadata, fetchRepositoryTree } from "./github/repository.ts";
import type { GitHubError, RepositoryMetadata } from "./github/types.ts";
import { buildDependencyGraph } from "./graph/build.ts";
import { parseRepositoryUrl, type RepositoryRef } from "./repository-url.ts";
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

// Set when this Codefield instance has a GitHub App configured.
export type PrivateAccess = {
  // The browser's GitHub connection, connected or not.
  connection: GitHubConnection;
  // GitHub's page for installing the app or changing its repositories.
  manageUrl: string;
};

export type DiscoveryOptions = {
  privateAccess?: PrivateAccess | null;
};

const NOT_FOUND: GitHubError = { code: "not_found", message: "Repository not found." };

// Every repository is first requested the way public ones always were:
// anonymously, or with the server's optional GITHUB_TOKEN. Only when GitHub
// does not show a public repository that way does the user's own connection
// come in. Both paths end in the same analysis.
export async function discoverRepository(input: unknown, options: DiscoveryOptions = {}): Promise<DiscoveryResult> {
  if (typeof input !== "string") {
    return errorResult({ title: "Invalid repository URL", message: "Enter a GitHub repository URL.", retryable: false });
  }

  const parsed = parseRepositoryUrl(input);
  if (!parsed.ok) {
    return errorResult({ title: "Invalid repository URL", message: parsed.error, retryable: false });
  }

  const server: GitHubRequestOptions = { token: readGitHubToken() };
  const metadata = await fetchRepositoryMetadata(parsed.repository, { ...server, allowPrivate: true });

  if (metadata.ok && !metadata.data.isPrivate) {
    return analyzeRepository(metadata.data, server, presentGitHubError);
  }

  // A private repository the server's GITHUB_TOKEN happens to see is treated
  // exactly like GitHub's 404: that token belongs to whoever runs Codefield,
  // so it must neither unlock the repository nor reveal that it exists.
  if (!metadata.ok && metadata.error.code !== "not_found") {
    return errorResult(presentGitHubError(metadata.error));
  }

  const access = options.privateAccess ?? null;
  if (access === null) return errorResult(presentGitHubError(NOT_FOUND));
  return discoverPrivateRepository(parsed.repository, access);
}

// GitHub App user tokens can only reach repositories that the user can access
// and that the user granted to the app's installation, so GitHub enforces
// both conditions on every request made here.
async function discoverPrivateRepository(ref: RepositoryRef, access: PrivateAccess): Promise<DiscoveryResult> {
  const { connection } = access;
  const connectHref = connectPath(ref);

  let token = await connection.accessToken();
  if (!token.ok) return errorResult(presentConnectionProblem(token.reason, connectHref));

  let metadata = await fetchRepositoryMetadata(ref, { token: token.token, allowPrivate: true });
  if (!metadata.ok && metadata.error.code === "unauthorized") {
    token = await connection.renew();
    if (!token.ok) return errorResult(presentConnectionProblem(token.reason, connectHref));
    metadata = await fetchRepositoryMetadata(ref, { token: token.token, allowPrivate: true });
  }

  if (!metadata.ok) {
    if (metadata.error.code === "unauthorized") {
      // Rejected even after a refresh: the connection is of no further use.
      await connection.disconnect();
      return errorResult(presentConnectionProblem("revoked", connectHref));
    }
    if (metadata.error.code !== "not_found") return errorResult(presentGitHubError(metadata.error));

    const installations = await countUserInstallations(token.token);
    return errorResult(
      presentAccessProblem(installations === 0 ? "app_not_installed" : "repository_not_granted", access.manageUrl),
    );
  }

  return analyzeRepository(metadata.data, { token: token.token }, (error) =>
    error.code === "unauthorized" ? presentConnectionProblem("expired", connectHref) : presentGitHubError(error),
  );
}

// The one analysis pipeline: tree, archive, parsing and graph. `credentials`
// are whichever the metadata request succeeded with.
async function analyzeRepository(
  metadata: RepositoryMetadata,
  credentials: GitHubRequestOptions,
  present: (error: GitHubError) => PresentedError,
): Promise<DiscoveryResult> {
  const identity: RepositoryIdentity = {
    fullName: metadata.fullName,
    defaultBranch: metadata.defaultBranch,
  };

  const tree = await fetchRepositoryTree(metadata, credentials);
  if (!tree.ok) {
    // GitHub answers the tree request the same way for an empty repository as
    // for one it cannot list; both are shown as "nothing to analyze" rather
    // than as an error.
    if (tree.error.code === "tree_unavailable") {
      return { status: "empty", repository: identity };
    }
    return errorResult(present(tree.error), identity);
  }

  if (tree.data.entries.length === 0) {
    return { status: "empty", repository: identity };
  }

  const selection = selectSourceFiles(tree.data.entries);
  if (selection.candidates.length === 0) {
    return { status: "unsupported", repository: identity };
  }

  const sources = await loadSourceFiles(metadata, selection.candidates, {
    ...credentials,
    extraFiles: selectConfigFiles(tree.data.entries),
  });
  if (!sources.ok) return errorResult(present(sources.error), identity);

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
