import { timingSafeEqual } from "node:crypto";

// The one repository this Codefield process may read, chosen on the command
// line, and the capability token the launcher generated for this process.
// Both come from the environment the launcher starts the server with; the
// browser can never choose or change the root.
export type LocalSession = {
  root: string;
  token: string;
  port: number;
};

type Env = Record<string, string | undefined>;

export function readLocalSession(env: Env = process.env): LocalSession | null {
  const root = env.CODEFIELD_ROOT;
  const token = env.CODEFIELD_TOKEN;
  const port = Number(env.CODEFIELD_PORT);
  if (!root || !token || token.length < 32 || !Number.isInteger(port) || port <= 0 || port > 65535) return null;
  return { root, token, port };
}

// Cookies are shared by every port on a host, so each process uses its own
// name and two Codefield windows do not sign each other out.
export function sessionCookieName(session: Pick<LocalSession, "port">): string {
  return `codefield_${session.port}`;
}

export type RequestFacts = {
  host: string | null;
  origin: string | null;
  // The Sec-Fetch-Site header, sent by current browsers.
  fetchSite: string | null;
  // The value of this process's session cookie.
  cookie: string | undefined;
};

// A request is accepted only when all of these hold:
// - Host names the loopback address and this port, which defeats DNS
//   rebinding: a hostile page cannot make the browser send its requests here
//   under another name.
// - A browser-sent Origin or Sec-Fetch-Site says the request came from a
//   Codefield page itself, so other sites (including other ports on
//   localhost, which count as the same site) cannot drive it.
// - The session cookie carries the token the launcher printed. The cookie is
//   HttpOnly and SameSite=Strict, and only /open can set it, given the token.
export function isAuthorizedRequest(session: LocalSession, facts: RequestFacts): boolean {
  return isLoopbackHost(session, facts.host) && isSameOrigin(facts) && tokenMatches(session, facts.cookie);
}

export function isLoopbackHost(session: Pick<LocalSession, "port">, host: string | null): boolean {
  if (host === null) return false;
  const value = host.toLowerCase();
  return [`127.0.0.1:${session.port}`, `localhost:${session.port}`, `[::1]:${session.port}`].includes(value);
}

function isSameOrigin({ host, origin, fetchSite }: RequestFacts): boolean {
  if (fetchSite !== null && fetchSite !== "same-origin" && fetchSite !== "none") return false;
  if (origin !== null && origin !== `http://${host?.toLowerCase()}`) return false;
  return true;
}

export function tokenMatches(session: Pick<LocalSession, "token">, candidate: string | null | undefined): boolean {
  if (!candidate) return false;
  const expected = Buffer.from(session.token);
  const actual = Buffer.from(candidate);
  return expected.length === actual.length && timingSafeEqual(expected, actual);
}
