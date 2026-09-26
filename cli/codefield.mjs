#!/usr/bin/env node
// @ts-check
import { parseArguments, USAGE } from "./args.mjs";
import { openBrowser } from "./browser.mjs";
import { cloneDestination, cloneRepository, CLONE_MESSAGES, validateRemote } from "./clone.mjs";
import { isSupportedNode, MINIMUM_NODE, VERSION } from "./package.mjs";
import { baseDirectory, resolveRoot } from "./root.mjs";
import { createToken, startServer } from "./server.mjs";

async function main() {
  if (!isSupportedNode(process.versions.node, MINIMUM_NODE)) {
    return fail(
      `Codefield needs Node.js ${MINIMUM_NODE.join(".")} or later; this is Node.js ${process.versions.node}. Install a newer Node.js and run it again.`,
    );
  }

  const command = parseArguments(process.argv.slice(2));
  if (command.command === "help") return print(USAGE);
  if (command.command === "version") return print(`codefield ${VERSION}`);
  if (command.command === "error") return fail(`${command.message}\n\n${USAGE}`);

  const cwd = baseDirectory(process.env, process.cwd());
  let folder;
  if (command.command === "clone") {
    const valid = validateRemote(command.remote);
    if (!valid.ok) return fail(valid.message);
    const destination = cloneDestination(command.remote, command.directory, cwd);
    if (destination === null) return fail("Could not pick a folder name from the remote. Give one: codefield clone <remote> <folder>");
    const cloned = await cloneRepository({ remote: command.remote, destination });
    if (!cloned.ok) return fail(CLONE_MESSAGES[cloned.failure]);
    folder = destination;
  } else {
    folder = command.path;
  }

  const resolved = await resolveRoot(folder, cwd);
  if (!resolved.ok) return fail(resolved.message);

  print("Codefield");
  print(`Analyzing ${resolved.root}`);

  const server = await startServer({ root: resolved.root, port: command.port, dev: command.dev, token: createToken() });
  // The address carries the session token, so it is only ever printed here,
  // to the person who started Codefield.
  if (!command.open) {
    print(`Open ${server.openUrl}`);
  } else if (await openBrowser(server.openUrl)) {
    print(`Opening ${server.openUrl}`);
  } else {
    print(`Could not open a browser. Open this address: ${server.openUrl}`);
  }
  print("Press Ctrl+C to stop.");

  let stopping = false;
  const stop = () => {
    if (stopping) return;
    stopping = true;
    // Next.js can keep handles open; the process ends either way.
    setTimeout(() => process.exit(0), 2000).unref();
    void server.close().finally(() => process.exit(0));
  };
  process.on("SIGINT", stop);
  process.on("SIGTERM", stop);
  if (process.platform === "win32") process.on("SIGBREAK", stop);
}

/** @param {string} message */
function print(message) {
  process.stdout.write(`${message}\n`);
}

/** @param {string} message */
function fail(message) {
  process.stderr.write(`codefield: ${message}\n`);
  process.exitCode = 1;
}

main().catch((error) => {
  fail(error instanceof Error ? error.message : String(error));
  // A server that started listening before the failure would keep the
  // process alive.
  process.exit(1);
});
