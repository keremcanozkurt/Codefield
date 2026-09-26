// @ts-check
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

// The installed package's own folder, wherever npm put it: the production
// build and package.json are read from here, never from the working directory.
export const PACKAGE_ROOT = dirname(dirname(fileURLToPath(import.meta.url)));

/** @type {{ version: string, engines: { node: string } }} */
const manifest = JSON.parse(readFileSync(join(PACKAGE_ROOT, "package.json"), "utf8"));

export const VERSION = manifest.version;

// package.json's engines field is the only place the supported Node.js
// version is written down; npm warns from it at install, and the CLI refuses
// to start from it.
export const MINIMUM_NODE = parseMinimum(manifest.engines.node);

/**
 * @param {string} range such as ">=22" or ">=20.9"
 * @returns {[number, number]}
 */
export function parseMinimum(range) {
  const match = range.match(/^>=\s*(\d+)(?:\.(\d+))?/);
  if (match === null) throw new Error(`Unsupported engines.node range: ${range}`);
  return [Number(match[1]), Number(match[2] ?? 0)];
}

/**
 * @param {string} version process.versions.node, such as "22.18.0"
 * @param {[number, number]} minimum
 */
export function isSupportedNode(version, minimum) {
  const [major, minor] = version.split(".").map(Number);
  return major > minimum[0] || (major === minimum[0] && minor >= minimum[1]);
}
