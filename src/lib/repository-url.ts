export type RepositoryRef = {
  owner: string;
  repo: string;
};

export type RepositoryUrlResult =
  | { ok: true; repository: RepositoryRef }
  | { ok: false; error: string };

const GITHUB_HOSTS = new Set(["github.com", "www.github.com"]);
const SCHEME_PATTERN = /^([a-z][a-z0-9+.-]*):/i;

// GitHub logins are alphanumeric with hyphens, cannot start with a hyphen,
// and are at most 39 characters. Some older accounts break the stricter
// rules (trailing or doubled hyphens), so those are not rejected here.
const OWNER_PATTERN = /^[a-z0-9][a-z0-9-]{0,38}$/i;
const REPO_PATTERN = /^[a-z0-9._-]{1,100}$/i;

function fail(error: string): RepositoryUrlResult {
  return { ok: false, error };
}

export function parseRepositoryUrl(input: string): RepositoryUrlResult {
  const value = input.trim();
  if (value === "") return fail("Enter a GitHub repository URL.");

  // The URL parser strips tabs and newlines and reads backslashes as slashes,
  // which would quietly turn malformed input into a valid-looking URL.
  if (/[\s\\]/.test(value)) return fail("Enter a valid URL.");

  let candidate = value;
  const scheme = SCHEME_PATTERN.exec(value)?.[1].toLowerCase();
  if (scheme === undefined) {
    candidate = `https://${value}`;
  } else if (scheme !== "http" && scheme !== "https") {
    return fail("Only http and https URLs are supported.");
  } else if (!/^https?:\/\//i.test(value)) {
    return fail("Enter a valid URL.");
  }

  let url: URL;
  try {
    url = new URL(candidate);
  } catch {
    return fail("Enter a valid URL.");
  }

  if (url.username !== "" || url.password !== "") {
    return fail("Remove the username and password from the URL.");
  }
  if (!GITHUB_HOSTS.has(url.hostname) || url.port !== "") {
    return fail("Only github.com repository URLs are supported.");
  }

  const segments = url.pathname.split("/").slice(1);
  if (segments.length > 1 && segments[segments.length - 1] === "") {
    segments.pop();
  }

  const [owner = "", repoSegment = "", ...rest] = segments;
  if (owner === "") return fail("The URL is missing the repository owner.");
  if (repoSegment === "") return fail("The URL is missing the repository name.");
  if (rest.length > 0) {
    return fail("Use the repository URL, not a page inside it.");
  }

  const repo = repoSegment.endsWith(".git")
    ? repoSegment.slice(0, -".git".length)
    : repoSegment;

  if (!OWNER_PATTERN.test(owner)) {
    return fail("The repository owner is not valid.");
  }
  if (!REPO_PATTERN.test(repo) || repo === "." || repo === "..") {
    return fail("The repository name is not valid.");
  }

  return { ok: true, repository: { owner, repo } };
}
