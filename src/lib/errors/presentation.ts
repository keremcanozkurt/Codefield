import type { GitHubError, GitHubErrorCode, RateLimit } from "../github/types.ts";
import { LANGUAGES } from "../languages/registry.ts";

// What a component shows for a failed repository analysis. Kept small and
// separate from GitHubError so error copy lives in one place rather than
// spreading strings across components, and so nothing server-internal (raw
// response bodies, the GitHub token, endpoint URLs) can reach a component by
// accident: only these fields cross the boundary.
export type PresentedError = {
  title: string;
  message: string;
  retryable: boolean;
  // ISO timestamp. Only set for a rate limit with a known reset time; the
  // component formats it in the viewer's local time.
  retryAt?: string;
  // A link that resolves the problem, such as connecting GitHub.
  action?: { label: string; href: string };
};

const COPY: Record<Exclude<GitHubErrorCode, "rate_limited">, Omit<PresentedError, "retryAt">> = {
  not_found: {
    title: "Repository not found",
    message: "Check the URL or confirm that the repository is public.",
    retryable: false,
  },
  repository_inaccessible: {
    title: "Private or unavailable repository",
    message: "GitHub denied access to this repository.",
    retryable: false,
  },
  unauthorized: {
    title: "Could not access GitHub",
    // The server's configured access is rejected on every request until it
    // is fixed, so offering a retry here would only waste the visitor's time.
    message: "Codefield could not access GitHub right now.",
    retryable: false,
  },
  malformed_response: {
    title: "Unexpected response from GitHub",
    message: "GitHub returned a response Codefield could not read. Try again later.",
    retryable: true,
  },
  tree_unavailable: {
    title: "Repository tree unavailable",
    message: "GitHub could not return this repository's file tree. Try again later.",
    retryable: true,
  },
  tree_truncated: {
    title: "Repository tree too large",
    message: "GitHub could not return the complete repository tree. Try again later or use a smaller repository.",
    retryable: true,
  },
  archive_unavailable: {
    title: "Archive unavailable",
    message: "GitHub did not provide a downloadable archive for this repository. Try again later.",
    retryable: true,
  },
  archive_too_large: {
    title: "Repository too large",
    message: "This repository exceeds Codefield's hosted analysis limit of 50 MiB.",
    retryable: false,
  },
  malformed_archive: {
    title: "Could not read repository archive",
    message: "The repository archive could not be analyzed safely. Try again later.",
    retryable: true,
  },
  network_error: {
    title: "Could not reach GitHub",
    message: "Codefield couldn't reach GitHub. Check your connection and try again.",
    retryable: true,
  },
  upstream_error: {
    title: "GitHub error",
    message: "GitHub returned an unexpected error. Try again later.",
    retryable: true,
  },
};

// Maps an internal GitHubError to what a visitor sees. This is the only place
// GitHub error copy is written: components read PresentedError, never
// GitHubErrorCode or the raw GitHub message.
export function presentGitHubError(error: GitHubError): PresentedError {
  if (error.code === "rate_limited") return presentRateLimit(error.rateLimit);
  return COPY[error.code];
}

function presentRateLimit(rateLimit: RateLimit | undefined): PresentedError {
  const title = rateLimit?.authenticated
    ? "GitHub's request limit has been reached"
    : "GitHub's anonymous request limit has been reached";

  if (rateLimit?.resetAt) {
    return { title, message: "Try again later.", retryable: true, retryAt: rateLimit.resetAt };
  }
  return { title, message: "Try again later.", retryable: true };
}

// Problems with a user's GitHub connection, found while analyzing a
// repository the anonymous request could not see. None of this copy says
// whether the repository exists: GitHub itself does not say.
export type ConnectionProblem = "not_connected" | "expired" | "revoked" | "unavailable";

export function presentConnectionProblem(problem: ConnectionProblem, connectHref: string): PresentedError {
  const action = { label: "Connect GitHub", href: connectHref };
  switch (problem) {
    case "not_connected":
      return {
        title: "Repository not found",
        message: "Check the URL. If the repository is private, connect GitHub to let Codefield read it.",
        retryable: false,
        action,
      };
    case "expired":
      return {
        title: "GitHub connection expired",
        message: "Connect GitHub again to analyze private repositories.",
        retryable: false,
        action,
      };
    case "revoked":
      return {
        title: "GitHub connection no longer valid",
        message: "GitHub no longer accepts Codefield's authorization. Connect GitHub again to continue.",
        retryable: false,
        action,
      };
    case "unavailable":
      return COPY.network_error;
  }
}

export type AccessProblem = "app_not_installed" | "repository_not_granted";

export function presentAccessProblem(problem: AccessProblem, manageHref: string): PresentedError {
  if (problem === "app_not_installed") {
    return {
      title: "Codefield is not installed on GitHub",
      message: "Install the Codefield GitHub App and choose the repositories it may read.",
      retryable: false,
      action: { label: "Install on GitHub", href: manageHref },
    };
  }
  return {
    title: "Codefield cannot read this repository",
    message:
      "The repository may not exist, your GitHub account may not have access to it, or it is not one of the repositories granted to Codefield.",
    retryable: false,
    action: { label: "Manage access", href: manageHref },
  };
}

// A repository whose tree contains no entries at all. Shown instead of an
// error: nothing went wrong, there is simply nothing to analyze.
export const EMPTY_REPOSITORY = {
  title: "Nothing to analyze",
  message: "This repository has no files to analyze.",
} as const;

// A repository that loaded but contains none of the supported extensions.
export const NO_SUPPORTED_SOURCE_FILES = {
  title: "No supported source files",
  message: "No source files in a supported language were found.",
  detail: `Codefield analyzes ${listNames(LANGUAGES.map((language) => language.name))}.`,
} as const;

function listNames(names: string[]): string {
  return `${names.slice(0, -1).join(", ")} and ${names.at(-1)}`;
}
