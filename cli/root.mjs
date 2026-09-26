// @ts-check
import { opendir, realpath, stat } from "node:fs/promises";
import { resolve } from "node:path";

/**
 * Resolves the folder given on the command line to its real path, which
 * becomes the only root the server may read for the life of the process.
 * @param {string} input
 * @param {string} cwd
 * @returns {Promise<{ ok: true, root: string } | { ok: false, message: string }>}
 */
export async function resolveRoot(input, cwd) {
  const requested = resolve(cwd, input);
  let root;
  try {
    root = await realpath(requested);
  } catch (error) {
    const code = /** @type {NodeJS.ErrnoException} */ (error).code;
    return { ok: false, message: code === "EACCES" || code === "EPERM" ? `Permission denied: ${requested}` : `Folder not found: ${requested}` };
  }
  try {
    if (!(await stat(root)).isDirectory()) return { ok: false, message: `Not a folder: ${requested}` };
  } catch {
    return { ok: false, message: `Folder not found: ${requested}` };
  }
  // A folder that cannot be listed would otherwise open as an empty analysis.
  try {
    await (await opendir(root)).close();
  } catch {
    return { ok: false, message: `Permission denied: ${requested}` };
  }
  return { ok: true, root };
}

/**
 * npm runs package scripts from the package's own folder and records the
 * folder they were started from in INIT_CWD. For Codefield's own scripts
 * (npm run dev -- ../project), paths are relative to that folder.
 * @param {NodeJS.ProcessEnv} env
 * @param {string} cwd
 */
export function baseDirectory(env, cwd) {
  const ownScript = env.npm_package_name === "@keremcanozkurt/codefield" && ["dev", "start", "codefield"].includes(env.npm_lifecycle_event ?? "");
  return ownScript && env.INIT_CWD ? env.INIT_CWD : cwd;
}
