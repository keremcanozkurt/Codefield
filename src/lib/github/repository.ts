import type { RepositoryRef } from "../repository-url.ts";
import {
  malformedResponse,
  requestGitHub,
  type GitHubRequestOptions,
} from "./client.ts";
import type {
  GitHubResult,
  LoadedRepository,
  RepositoryMetadata,
  RepositoryTree,
  TreeEntry,
} from "./types.ts";

const SYMLINK_MODE = "120000";

export async function loadRepository(
  ref: RepositoryRef,
  options: GitHubRequestOptions = {},
): Promise<GitHubResult<LoadedRepository>> {
  const metadata = await fetchRepositoryMetadata(ref, options);
  if (!metadata.ok) return metadata;

  const tree = await fetchRepositoryTree(metadata.data, options);
  if (!tree.ok) return tree;

  return { ok: true, data: { metadata: metadata.data, tree: tree.data } };
}

type MetadataOptions = GitHubRequestOptions & {
  // Private repositories are rejected unless the caller has decided the
  // credentials in use may read them.
  allowPrivate?: boolean;
};

export async function fetchRepositoryMetadata(
  ref: RepositoryRef,
  { allowPrivate = false, ...options }: MetadataOptions = {},
): Promise<GitHubResult<RepositoryMetadata>> {
  const response = await requestGitHub(
    `/repos/${encodeURIComponent(ref.owner)}/${encodeURIComponent(ref.repo)}`,
    options,
  );
  if (!response.ok) return { ok: false, error: response.error };

  const metadata = normalizeMetadata(response.data);
  if (metadata === null) return { ok: false, error: malformedResponse() };

  if (metadata.isPrivate && !allowPrivate) {
    return {
      ok: false,
      error: {
        code: "repository_inaccessible",
        message: "Private repositories are not supported.",
      },
    };
  }

  return { ok: true, data: metadata };
}

export async function fetchRepositoryTree(
  metadata: RepositoryMetadata,
  options: GitHubRequestOptions = {},
): Promise<GitHubResult<RepositoryTree>> {
  // Renamed and transferred repositories redirect to their new location, so the
  // tree request uses the canonical names from the metadata response.
  const path = [
    "repos",
    encodeURIComponent(metadata.owner),
    encodeURIComponent(metadata.name),
    "git/trees",
    encodeURIComponent(metadata.defaultBranch),
  ].join("/");

  // Any value for `recursive` enables recursion, including "0" and "false".
  const response = await requestGitHub(`/${path}?recursive=1`, options);

  if (!response.ok) {
    // An empty repository has no tree and answers 409.
    if (response.status === 404 || response.status === 409) {
      return {
        ok: false,
        error: {
          code: "tree_unavailable",
          message: "The repository's file tree is not available. It may be empty.",
        },
      };
    }
    return { ok: false, error: response.error };
  }

  return normalizeTree(response.data);
}

function normalizeMetadata(data: unknown): RepositoryMetadata | null {
  if (!isRecord(data) || !isRecord(data.owner)) return null;

  const owner = data.owner.login;
  const name = data.name;
  const fullName = data.full_name;
  const defaultBranch = data.default_branch;
  const htmlUrl = data.html_url;
  const isPrivate = data.private;
  const isArchived = data.archived;
  const sizeKb = data.size;

  if (
    !isNonEmptyString(owner) ||
    !isNonEmptyString(name) ||
    !isNonEmptyString(fullName) ||
    !isNonEmptyString(defaultBranch) ||
    typeof htmlUrl !== "string" ||
    !htmlUrl.startsWith("https://github.com/") ||
    typeof isPrivate !== "boolean" ||
    typeof isArchived !== "boolean" ||
    !isNonNegativeInteger(sizeKb)
  ) {
    return null;
  }

  return {
    owner,
    name,
    fullName,
    defaultBranch,
    htmlUrl,
    isPrivate,
    isArchived,
    sizeKb,
  };
}

function normalizeTree(data: unknown): GitHubResult<RepositoryTree> {
  if (
    !isRecord(data) ||
    !isNonEmptyString(data.sha) ||
    !Array.isArray(data.tree) ||
    typeof data.truncated !== "boolean"
  ) {
    return { ok: false, error: malformedResponse() };
  }

  // The recursive endpoint caps responses at 100,000 entries or 7 MB and marks
  // the result as truncated instead of failing. A partial tree would produce a
  // misleading graph, so it is rejected.
  if (data.truncated) {
    return {
      ok: false,
      error: {
        code: "tree_truncated",
        message: "This repository is too large for GitHub to list in one request.",
      },
    };
  }

  const entries: TreeEntry[] = [];
  for (const item of data.tree) {
    if (
      !isRecord(item) ||
      !isNonEmptyString(item.path) ||
      !isNonEmptyString(item.sha) ||
      typeof item.mode !== "string" ||
      typeof item.type !== "string"
    ) {
      return { ok: false, error: malformedResponse() };
    }

    // Submodules appear as "commit" entries and symlinks as blobs whose content
    // is a link target. Neither is a file in this repository.
    if (item.type === "commit" || item.mode === SYMLINK_MODE) continue;

    if (item.type === "tree") {
      entries.push({ path: item.path, type: "tree", sha: item.sha });
    } else if (item.type === "blob" && isNonNegativeInteger(item.size)) {
      entries.push({ path: item.path, type: "blob", sha: item.sha, size: item.size });
    } else {
      return { ok: false, error: malformedResponse() };
    }
  }

  return { ok: true, data: { sha: data.sha, entries } };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value !== "";
}

function isNonNegativeInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value >= 0;
}
