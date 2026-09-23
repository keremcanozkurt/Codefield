export type RepositoryMetadata = {
  owner: string;
  name: string;
  fullName: string;
  defaultBranch: string;
  htmlUrl: string;
  isPrivate: boolean;
  isArchived: boolean;
  // GitHub reports repository size in kilobytes.
  sizeKb: number;
};

export type TreeEntry = {
  path: string;
  type: "blob" | "tree";
  sha: string;
  size?: number;
};

export type RepositoryTree = {
  sha: string;
  entries: TreeEntry[];
};

export type LoadedRepository = {
  metadata: RepositoryMetadata;
  tree: RepositoryTree;
};

export type GitHubErrorCode =
  | "not_found"
  | "repository_inaccessible"
  | "rate_limited"
  | "unauthorized"
  | "malformed_response"
  | "tree_unavailable"
  | "tree_truncated"
  | "archive_unavailable"
  | "archive_too_large"
  | "malformed_archive"
  | "network_error"
  | "upstream_error";

export type RateLimit = {
  limit: number | null;
  remaining: number | null;
  resetAt: string | null;
  authenticated: boolean;
};

export type GitHubError = {
  code: GitHubErrorCode;
  message: string;
  rateLimit?: RateLimit;
};

export type GitHubResult<T> =
  | { ok: true; data: T }
  | { ok: false; error: GitHubError };
