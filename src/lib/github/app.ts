import type { RepositoryRef } from "../repository-url.ts";
import { deriveSessionKey, MIN_SECRET_LENGTH } from "./session.ts";

// Settings for the Codefield GitHub App, which gives signed-in users access to
// private repositories they choose. All server-only. When any is missing,
// private repository access is off and Codefield behaves as a public-only
// tool.
export type GitHubAppConfig = {
  clientId: string;
  clientSecret: string;
  slug: string;
  sessionKey: Buffer;
  secureCookies: boolean;
};

type Env = Record<string, string | undefined>;

export function readGitHubAppConfig(env: Env = process.env): GitHubAppConfig | null {
  const clientId = env.GITHUB_APP_CLIENT_ID?.trim();
  const clientSecret = env.GITHUB_APP_CLIENT_SECRET?.trim();
  const slug = env.GITHUB_APP_SLUG?.trim();
  const secret = env.GITHUB_SESSION_SECRET?.trim();
  if (!clientId || !clientSecret || !slug || !secret) return null;
  if (!/^[a-z0-9-]+$/i.test(slug) || secret.length < MIN_SECRET_LENGTH) return null;

  return {
    clientId,
    clientSecret,
    slug,
    sessionKey: deriveSessionKey(secret),
    secureCookies: env.NODE_ENV === "production",
  };
}

export function authorizeUrl(config: GitHubAppConfig, state: string): string {
  const params = new URLSearchParams({ client_id: config.clientId, state });
  return `https://github.com/login/oauth/authorize?${params}`;
}

// GitHub's page for installing the app, or for changing which repositories an
// existing installation may read.
export function manageAccessUrl(config: Pick<GitHubAppConfig, "slug">): string {
  return `https://github.com/apps/${encodeURIComponent(config.slug)}/installations/new`;
}

export function connectPath(repository?: RepositoryRef): string {
  if (repository === undefined) return "/api/github/connect";
  return `/api/github/connect?repository=${encodeURIComponent(repositoryUrl(repository))}`;
}

export function repositoryUrl(repository: RepositoryRef): string {
  return `https://github.com/${repository.owner}/${repository.repo}`;
}
