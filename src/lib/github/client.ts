import type { GitHubError, RateLimit } from "./types.ts";

const API_ORIGIN = "https://api.github.com";
const API_VERSION = "2022-11-28";
const REQUEST_TIMEOUT_MS = 15_000;
const ARCHIVE_TIMEOUT_MS = 60_000;

export type FetchLike = (url: string, init: RequestInit) => Promise<Response>;

export type GitHubRequestOptions = {
  token?: string;
  fetch?: FetchLike;
};

type GitHubFailure = { ok: false; status: number | null; error: GitHubError };

export type GitHubResponse = { ok: true; data: unknown } | GitHubFailure;

export type GitHubDownload = { ok: true; bytes: Uint8Array } | GitHubFailure;

export function readGitHubToken(): string | undefined {
  const token = process.env.GITHUB_TOKEN?.trim();
  return token ? token : undefined;
}

export async function requestGitHub(
  path: string,
  options: GitHubRequestOptions = {},
): Promise<GitHubResponse> {
  const sent = await send(path, options, REQUEST_TIMEOUT_MS);
  if (!sent.ok) return sent;

  try {
    return { ok: true, data: await sent.response.json() };
  } catch {
    return { ok: false, status: sent.response.status, error: malformedResponse() };
  }
}

// Archive endpoints answer with a redirect to codeload.github.com. fetch drops
// the Authorization header on that cross-origin hop, so the token only reaches
// api.github.com.
export async function downloadGitHubArchive(
  path: string,
  maxBytes: number,
  options: GitHubRequestOptions = {},
): Promise<GitHubDownload> {
  const sent = await send(path, options, ARCHIVE_TIMEOUT_MS);
  if (!sent.ok) return sent;

  const { response } = sent;
  const tooLarge: GitHubFailure = {
    ok: false,
    status: response.status,
    error: {
      code: "archive_too_large",
      message: "This repository is too large for Codefield to download.",
    },
  };

  const declaredLength = response.headers.get("content-length");
  if (declaredLength !== null && Number(declaredLength) > maxBytes) {
    await response.body?.cancel().catch(() => {});
    return tooLarge;
  }

  // Archives are generated on the fly and usually have no content-length, so
  // the limit is enforced while reading.
  const chunks: Uint8Array[] = [];
  let length = 0;
  try {
    const reader = response.body?.getReader();
    while (reader) {
      const { done, value } = await reader.read();
      if (done) break;
      length += value.length;
      if (length > maxBytes) {
        await reader.cancel().catch(() => {});
        return tooLarge;
      }
      chunks.push(value);
    }
  } catch {
    return { ok: false, status: null, error: networkError() };
  }

  const bytes = new Uint8Array(length);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.length;
  }
  return { ok: true, bytes };
}

async function send(
  path: string,
  options: GitHubRequestOptions,
  timeoutMs: number,
): Promise<{ ok: true; response: Response } | GitHubFailure> {
  const { token, fetch: fetchImpl = fetch } = options;

  const headers: Record<string, string> = {
    Accept: "application/vnd.github+json",
    "User-Agent": "Codefield",
    "X-GitHub-Api-Version": API_VERSION,
  };
  if (token) headers.Authorization = `Bearer ${token}`;

  let response: Response;
  try {
    response = await fetchImpl(`${API_ORIGIN}${path}`, {
      headers,
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch {
    return { ok: false, status: null, error: networkError() };
  }

  if (!response.ok) {
    return {
      ok: false,
      status: response.status,
      error: await errorForResponse(response, Boolean(token)),
    };
  }

  return { ok: true, response };
}

function networkError(): GitHubError {
  return { code: "network_error", message: "Could not reach GitHub." };
}

export function malformedResponse(): GitHubError {
  return {
    code: "malformed_response",
    message: "GitHub returned a response Codefield could not read.",
  };
}

async function errorForResponse(
  response: Response,
  authenticated: boolean,
): Promise<GitHubError> {
  const { status, headers } = response;

  if (await isRateLimited(response)) {
    return {
      code: "rate_limited",
      message: "GitHub's API rate limit was reached. Try again later.",
      rateLimit: readRateLimit(headers, authenticated),
    };
  }

  switch (status) {
    case 401:
      return {
        code: "unauthorized",
        message: "GitHub rejected the server's API token.",
      };
    case 403:
    case 451:
      return {
        code: "repository_inaccessible",
        message: "GitHub denied access to this repository.",
      };
    case 404:
      // GitHub answers 404, not 403, for private repositories the request
      // cannot see, so the two cases are indistinguishable here.
      return {
        code: "not_found",
        message: "Repository not found. It may not exist or may be private.",
      };
    default:
      return {
        code: "upstream_error",
        message: "GitHub returned an unexpected error. Try again later.",
      };
  }
}

// Primary and secondary rate limits both use 403 or 429. A primary limit sets
// x-ratelimit-remaining to 0; a secondary limit may only send retry-after or
// say so in the response message.
async function isRateLimited(response: Response): Promise<boolean> {
  if (response.status === 429) return true;
  if (response.status !== 403) return false;

  const { headers } = response;
  if (headers.get("x-ratelimit-remaining") === "0") return true;
  if (headers.has("retry-after")) return true;

  try {
    return /rate limit/i.test(await response.text());
  } catch {
    return false;
  }
}

function readRateLimit(headers: Headers, authenticated: boolean): RateLimit {
  const retryAfterSeconds = readInteger(headers, "retry-after");
  // x-ratelimit-reset is a Unix timestamp in seconds.
  const resetSeconds = readInteger(headers, "x-ratelimit-reset");

  let resetAt: string | null = null;
  if (retryAfterSeconds !== null) {
    resetAt = new Date(Date.now() + retryAfterSeconds * 1000).toISOString();
  } else if (resetSeconds !== null) {
    resetAt = new Date(resetSeconds * 1000).toISOString();
  }

  return {
    limit: readInteger(headers, "x-ratelimit-limit"),
    remaining: readInteger(headers, "x-ratelimit-remaining"),
    resetAt,
    authenticated,
  };
}

function readInteger(headers: Headers, name: string): number | null {
  const value = headers.get(name);
  if (value === null || !/^\d+$/.test(value)) return null;
  return Number(value);
}
