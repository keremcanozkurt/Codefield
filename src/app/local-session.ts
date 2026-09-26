import "server-only";

import { cookies, headers } from "next/headers";

import { isAuthorizedRequest, readLocalSession, sessionCookieName, type LocalSession, type RequestFacts } from "@/lib/local/session";

type HeaderSource = { get(name: string): string | null };
type CookieSource = { get(name: string): { value: string } | undefined };

export function requestFacts(session: LocalSession, headerSource: HeaderSource, cookieSource: CookieSource): RequestFacts {
  return {
    host: headerSource.get("host"),
    origin: headerSource.get("origin"),
    fetchSite: headerSource.get("sec-fetch-site"),
    cookie: cookieSource.get(sessionCookieName(session))?.value,
  };
}

export type PageSession =
  | { state: "none" }
  | { state: "unauthorized" }
  | { state: "authorized"; session: LocalSession };

// For server components: whether this process was started on a repository,
// and whether the browser asking holds its session cookie.
export async function pageSession(): Promise<PageSession> {
  const session = readLocalSession();
  if (session === null) return { state: "none" };
  const facts = requestFacts(session, await headers(), await cookies());
  return isAuthorizedRequest(session, facts) ? { state: "authorized", session } : { state: "unauthorized" };
}
