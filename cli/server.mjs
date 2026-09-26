// @ts-check
import { randomBytes } from "node:crypto";
import { existsSync } from "node:fs";
import { createServer } from "node:http";
import { join } from "node:path";

import { PACKAGE_ROOT } from "./package.mjs";

export const HOST = "127.0.0.1";
export const DEFAULT_PORT = 4173;
const PORT_ATTEMPTS = 20;

export function createToken() {
  return randomBytes(32).toString("base64url");
}

/**
 * The repository root and session token reach the app through the
 * environment, which the browser cannot touch.
 * @param {{ root: string, port: number | null, dev: boolean, token: string }} options
 * @returns {Promise<{ url: string, openUrl: string, close(): Promise<void> }>}
 */
export async function startServer({ root, port, dev, token }) {
  if (!dev && !existsSync(join(PACKAGE_ROOT, ".next", "BUILD_ID"))) {
    // Only possible in a source checkout; the npm package ships the build.
    throw new Error("This Codefield checkout has not been built. Run `npm run build` in it first.");
  }

  // Requests that arrive while Next.js is still starting wait for it.
  /** @type {(value: import("next/dist/server/next").RequestHandler) => void} */
  let resolveHandler = () => {};
  /** @type {Promise<import("next/dist/server/next").RequestHandler>} */
  const handlerReady = new Promise((resolve) => (resolveHandler = resolve));
  const server = createServer((request, response) => {
    handlerReady.then((handle) => handle(request, response)).catch(() => {
      response.statusCode = 500;
      response.end();
    });
  });

  const listening = await listen(server, port);

  process.env.CODEFIELD_ROOT = root;
  process.env.CODEFIELD_TOKEN = token;
  process.env.CODEFIELD_PORT = String(listening);
  process.env.NEXT_TELEMETRY_DISABLED = "1";

  const { default: next } = await import("next");
  const app = next({ dev, dir: PACKAGE_ROOT, hostname: HOST, port: listening });
  await withoutConfigTiming(() => app.prepare());
  resolveHandler(app.getRequestHandler());
  if (dev) {
    const upgrade = app.getUpgradeHandler();
    server.on("upgrade", (request, socket, head) => void upgrade(request, socket, head));
  }

  const url = `http://${HOST}:${listening}`;
  return {
    url,
    openUrl: `${url}/open?token=${token}`,
    async close() {
      server.closeAllConnections();
      await new Promise((resolve) => server.close(() => resolve(undefined)));
      await app.close();
    },
  };
}

/**
 * Next.js prints how long loading its configuration took every time it
 * starts. That line means nothing to someone running Codefield, so it is
 * dropped while Next.js starts; everything else it logs still appears.
 * @param {() => Promise<void>} start
 */
async function withoutConfigTiming(start) {
  const log = console.log;
  console.log = (...args) => {
    if (typeof args[0] === "string" && args[0].includes("Running next.config")) return;
    log(...args);
  };
  try {
    await start();
  } finally {
    console.log = log;
  }
}

/**
 * @param {import("node:http").Server} server
 * @param {number | null} requested
 * @returns {Promise<number>}
 */
async function listen(server, requested) {
  const candidates = requested === null ? Array.from({ length: PORT_ATTEMPTS }, (_, i) => DEFAULT_PORT + i) : [requested];
  for (const candidate of candidates) {
    try {
      await new Promise((resolve, reject) => {
        server.once("error", reject);
        server.listen(candidate, HOST, () => {
          server.off("error", reject);
          resolve(undefined);
        });
      });
      return candidate;
    } catch (error) {
      if (/** @type {NodeJS.ErrnoException} */ (error).code !== "EADDRINUSE") throw error;
    }
  }
  throw new Error(
    requested === null
      ? `No free port between ${DEFAULT_PORT} and ${DEFAULT_PORT + PORT_ATTEMPTS - 1}. Use --port to choose one.`
      : `Port ${requested} is already in use. Choose another with --port <number>.`,
  );
}
