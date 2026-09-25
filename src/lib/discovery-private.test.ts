import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { afterEach, describe, it } from "node:test";

import { strToU8, zipSync } from "fflate";

import { discoverRepository, type PrivateAccess } from "./discovery.ts";
import type { GitHubConnection, UserToken } from "./github/connection.ts";

const OWNER = "octo";
const REPO = "secret-app";
const REPOSITORY_URL = `https://github.com/${OWNER}/${REPO}`;
const METADATA_URL = `https://api.github.com/repos/${OWNER}/${REPO}`;
const TREE_URL = `${METADATA_URL}/git/trees/main?recursive=1`;
const ARCHIVE_URL = `${METADATA_URL}/zipball/main`;
const INSTALLATIONS_URL = "https://api.github.com/user/installations?per_page=1";
const MANAGE_URL = "https://github.com/apps/codefield-local/installations/new";

const USER_TOKEN = "ghu_user_token_marker";
const SERVER_TOKEN = "ghp_server_token_marker";

const files = [
  { path: "src/index.ts", content: 'import { db } from "./db";\nexport const app = db;\n' },
  { path: "src/db.ts", content: "export const db = 1;\n" },
];

function sha1(bytes: Uint8Array) {
  return createHash("sha1").update(`blob ${bytes.length}\0`).update(bytes).digest("hex");
}

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

function metadata(isPrivate: boolean) {
  return {
    name: REPO,
    full_name: `${OWNER}/${REPO}`,
    owner: { login: OWNER },
    private: isPrivate,
    archived: false,
    html_url: REPOSITORY_URL,
    default_branch: "main",
    size: 10,
  };
}

const tree = () =>
  json({
    sha: "root",
    truncated: false,
    tree: files.map(({ path, content }) => {
      const bytes = strToU8(content);
      return { path, mode: "100644", type: "blob", sha: sha1(bytes), size: bytes.length };
    }),
  });

const archive = () =>
  new Response(
    zipSync({ [`${OWNER}-${REPO}-abc`]: Object.fromEntries(files.map((f) => [f.path, strToU8(f.content)])) }),
  );

type Request = { url: string; token: string | null };
type Route = (request: Request) => Response;

let restore = () => {};
afterEach(() => restore());

// Routes are matched on URL and on which token was sent, so a test states
// exactly what GitHub would answer to each kind of caller.
function github(routes: Record<string, Route>) {
  const requests: Request[] = [];
  const original = globalThis.fetch;
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input.toString();
    const authorization = (init?.headers as Record<string, string> | undefined)?.Authorization;
    const request = { url, token: authorization?.replace(/^Bearer /, "") ?? null };
    requests.push(request);
    const route = routes[url];
    if (route === undefined) throw new Error(`unexpected request: ${url}`);
    return route(request);
  }) as typeof fetch;
  restore = () => {
    globalThis.fetch = original;
  };
  return requests;
}

// Anonymous callers get GitHub's 404 for a private repository; the user's
// token sees it.
function privateRepository(): Record<string, Route> {
  const onlyUser = (ok: () => Response) => (request: Request) =>
    request.token === USER_TOKEN ? ok() : json({ message: "Not Found" }, 404);
  return {
    [METADATA_URL]: onlyUser(() => json(metadata(true))),
    [TREE_URL]: onlyUser(tree),
    [ARCHIVE_URL]: onlyUser(archive),
  };
}

function connection(tokens: UserToken[], log: string[] = []): GitHubConnection {
  let index = 0;
  const next = () => tokens[Math.min(index++, tokens.length - 1)];
  return {
    accessToken: async () => {
      log.push("accessToken");
      return next();
    },
    renew: async () => {
      log.push("renew");
      return next();
    },
    disconnect: async () => {
      log.push("disconnect");
    },
  };
}

function access(conn: GitHubConnection): PrivateAccess {
  return { connection: conn, manageUrl: MANAGE_URL };
}

const connected: UserToken = { ok: true, token: USER_TOKEN };

describe("discoverRepository with private access", () => {
  it("analyzes a public repository anonymously without touching the connection", async () => {
    const requests = github({
      [METADATA_URL]: () => json(metadata(false)),
      [TREE_URL]: tree,
      [ARCHIVE_URL]: archive,
    });
    const untouched: GitHubConnection = {
      accessToken: () => assert.fail("connection used"),
      renew: () => assert.fail("connection used"),
      disconnect: () => assert.fail("connection used"),
    };

    const result = await discoverRepository(REPOSITORY_URL, { privateAccess: access(untouched) });

    assert.equal(result.status, "success");
    assert.ok(requests.every((request) => request.token === null));
  });

  it("analyzes an authorized private repository with the user's token through the same pipeline", async () => {
    const requests = github(privateRepository());

    const result = await discoverRepository(REPOSITORY_URL, { privateAccess: access(connection([connected])) });

    assert.equal(result.status, "success");
    if (result.status !== "success") return;
    assert.equal(result.repository.fullName, `${OWNER}/${REPO}`);
    assert.deepEqual(result.graph.nodes.map((node) => node.id).sort(), ["src/db.ts", "src/index.ts"]);
    assert.deepEqual(result.graph.edges.map((edge) => [edge.source, edge.target]), [["src/index.ts", "src/db.ts"]]);
    assert.deepEqual(
      requests.map((request) => [request.url, request.token]),
      [
        [METADATA_URL, null],
        [METADATA_URL, USER_TOKEN],
        [TREE_URL, USER_TOKEN],
        [ARCHIVE_URL, USER_TOKEN],
      ],
    );
  });

  it("never returns tokens or source contents to the client", async () => {
    github(privateRepository());

    const result = await discoverRepository(REPOSITORY_URL, { privateAccess: access(connection([connected])) });
    const payload = JSON.stringify(result);

    assert.ok(!payload.includes(USER_TOKEN));
    assert.ok(!payload.includes("export const db"));
  });

  it("offers to connect GitHub when not connected, without saying the repository exists", async () => {
    github(privateRepository());

    const result = await discoverRepository(REPOSITORY_URL, {
      privateAccess: access(connection([{ ok: false, reason: "not_connected" }])),
    });

    assert.equal(result.status, "error");
    if (result.status !== "error") return;
    assert.equal(result.error.title, "Repository not found");
    assert.equal(result.repository, undefined);
    assert.deepEqual(result.error.action, {
      label: "Connect GitHub",
      href: "/api/github/connect?repository=https%3A%2F%2Fgithub.com%2Focto%2Fsecret-app",
    });
  });

  it("answers a repository that does not exist the same way", async () => {
    github({ [METADATA_URL]: () => json({ message: "Not Found" }, 404) });

    const missing = await discoverRepository(REPOSITORY_URL, {
      privateAccess: access(connection([{ ok: false, reason: "not_connected" }])),
    });
    github(privateRepository());
    const hidden = await discoverRepository(REPOSITORY_URL, {
      privateAccess: access(connection([{ ok: false, reason: "not_connected" }])),
    });

    assert.deepEqual(missing, hidden);
  });

  it("never analyzes a private repository with the server's GITHUB_TOKEN", async () => {
    process.env.GITHUB_TOKEN = SERVER_TOKEN;
    try {
      const requests = github({
        [METADATA_URL]: (request) =>
          request.token === SERVER_TOKEN ? json(metadata(true)) : json({ message: "Not Found" }, 404),
      });

      const withoutAccess = await discoverRepository(REPOSITORY_URL);
      const notConnected = await discoverRepository(REPOSITORY_URL, {
        privateAccess: access(connection([{ ok: false, reason: "not_connected" }])),
      });

      for (const result of [withoutAccess, notConnected]) {
        assert.equal(result.status, "error");
        assert.equal(result.status === "error" && result.error.title, "Repository not found");
      }
      assert.ok(requests.every((request) => request.url === METADATA_URL));
    } finally {
      delete process.env.GITHUB_TOKEN;
    }
  });

  it("reports a repository outside the installation's access", async () => {
    const requests = github({
      [METADATA_URL]: () => json({ message: "Not Found" }, 404),
      [INSTALLATIONS_URL]: () => json({ total_count: 1, installations: [] }),
    });

    const result = await discoverRepository(REPOSITORY_URL, { privateAccess: access(connection([connected])) });

    assert.equal(result.status, "error");
    if (result.status !== "error") return;
    assert.equal(result.error.title, "Codefield cannot read this repository");
    assert.deepEqual(result.error.action, { label: "Manage access", href: MANAGE_URL });
    assert.equal(requests.at(-1)!.token, USER_TOKEN);
  });

  it("reports that the app is not installed anywhere", async () => {
    github({
      [METADATA_URL]: () => json({ message: "Not Found" }, 404),
      [INSTALLATIONS_URL]: () => json({ total_count: 0, installations: [] }),
    });

    const result = await discoverRepository(REPOSITORY_URL, { privateAccess: access(connection([connected])) });

    assert.equal(result.status === "error" && result.error.title, "Codefield is not installed on GitHub");
    assert.equal(result.status === "error" && result.error.action?.label, "Install on GitHub");
  });

  it("reports an expired connection", async () => {
    github(privateRepository());

    const result = await discoverRepository(REPOSITORY_URL, {
      privateAccess: access(connection([{ ok: false, reason: "expired" }])),
    });

    assert.equal(result.status === "error" && result.error.title, "GitHub connection expired");
    assert.equal(result.status === "error" && result.error.action?.label, "Connect GitHub");
  });

  it("refreshes once after GitHub rejects the token, then continues", async () => {
    const log: string[] = [];
    const routes = privateRepository();
    github({
      ...routes,
      [METADATA_URL]: (request) =>
        request.token === "ghu_stale" ? json({ message: "Bad credentials" }, 401) : routes[METADATA_URL](request),
    });

    const result = await discoverRepository(REPOSITORY_URL, {
      privateAccess: access(connection([{ ok: true, token: "ghu_stale" }, connected], log)),
    });

    assert.equal(result.status, "success");
    assert.deepEqual(log, ["accessToken", "renew"]);
  });

  it("reports a revoked connection", async () => {
    const log: string[] = [];
    github({
      [METADATA_URL]: (request) =>
        request.token === null ? json({ message: "Not Found" }, 404) : json({ message: "Bad credentials" }, 401),
    });

    const refusedRefresh = await discoverRepository(REPOSITORY_URL, {
      privateAccess: access(connection([connected, { ok: false, reason: "revoked" }], log)),
    });
    const stillRejected = await discoverRepository(REPOSITORY_URL, {
      privateAccess: access(connection([connected], log)),
    });

    for (const result of [refusedRefresh, stillRejected]) {
      assert.equal(result.status === "error" && result.error.title, "GitHub connection no longer valid");
      assert.ok(!JSON.stringify(result).includes("Bad credentials"));
    }
    assert.equal(log.at(-1), "disconnect");
  });

  it("reports rate limiting on the user's requests", async () => {
    github({
      [METADATA_URL]: (request) =>
        request.token === null
          ? json({ message: "Not Found" }, 404)
          : new Response(JSON.stringify({ message: "API rate limit exceeded" }), {
              status: 403,
              headers: { "x-ratelimit-remaining": "0", "x-ratelimit-reset": "1790000000" },
            }),
    });

    const result = await discoverRepository(REPOSITORY_URL, { privateAccess: access(connection([connected])) });

    assert.equal(result.status === "error" && result.error.title, "GitHub's request limit has been reached");
    assert.equal(result.status === "error" && result.error.retryable, true);
  });

  it("never requests installation tokens or installation-scoped endpoints", async () => {
    const requests = github({
      ...privateRepository(),
      [INSTALLATIONS_URL]: () => json({ total_count: 1 }),
    });

    await discoverRepository(REPOSITORY_URL, { privateAccess: access(connection([connected])) });

    assert.ok(requests.every((request) => !/\/app\/|access_tokens|\/installation\//.test(request.url)));
  });
});
