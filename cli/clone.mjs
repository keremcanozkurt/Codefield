// @ts-check
import { spawn as nodeSpawn } from "node:child_process";
import { readdir } from "node:fs/promises";
import { resolve } from "node:path";

// Transports Git may be asked to use. "ext::" and other remote-helper forms
// ("<helper>::<address>") are refused: ext:: runs an arbitrary command.
const ALLOWED_SCHEMES = new Set(["ssh", "git", "http", "https", "file", "git+ssh", "ssh+git"]);

/**
 * @param {string} remote
 * @returns {{ ok: true } | { ok: false, message: string }}
 */
export function validateRemote(remote) {
  if (remote.trim() === "") return { ok: false, message: "The Git remote is empty." };
  if (remote !== remote.trim() || /[\u0000-\u001f\u007f]/.test(remote)) {
    return { ok: false, message: "The Git remote contains whitespace or control characters." };
  }
  // Would otherwise be read by git as an option, such as --upload-pack=<command>.
  if (remote.startsWith("-")) return { ok: false, message: "The Git remote cannot start with '-'." };
  if (/^[A-Za-z][A-Za-z0-9+.-]*::/.test(remote)) {
    return { ok: false, message: "Git remote helpers (such as ext::) are not supported." };
  }
  const scheme = remote.match(/^([A-Za-z][A-Za-z0-9+.-]*):\/\//);
  if (scheme && !ALLOWED_SCHEMES.has(scheme[1].toLowerCase())) {
    return { ok: false, message: `Unsupported Git transport: ${scheme[1]}://` };
  }
  return { ok: true };
}

/**
 * The folder name git itself would pick: the last path segment of the remote,
 * without a trailing ".git".
 * @param {string} remote
 * @returns {string | null}
 */
export function defaultDirectoryName(remote) {
  const path = remote.replace(/[\\/]+$/, "").replace(/\.git$/, "").replace(/[\\/]+$/, "");
  const name = path.split(/[\\/:]/).at(-1) ?? "";
  if (name === "" || name === "." || name === ".." || /[<>:"|?*]/.test(name)) return null;
  return name;
}

/**
 * The exact argument list passed to git. The remote and destination are
 * separate arguments after "--", never parsed by a shell or read as options.
 * @param {string} remote
 * @param {string} destination
 * @param {{ progress?: boolean }} [options]
 */
export function cloneArguments(remote, destination, { progress = false } = {}) {
  return [
    "-c",
    "protocol.ext.allow=never",
    "clone",
    ...(progress ? ["--progress"] : []),
    "--",
    remote,
    destination,
  ];
}

/**
 * @typedef {"git_missing" | "destination_exists" | "host_verification" | "ssh_permission" | "authentication" | "not_found" | "network" | "failed"} CloneFailure
 */

/** @type {Record<CloneFailure, string>} */
export const CLONE_MESSAGES = {
  git_missing: "Git is not installed or not on PATH. Install Git to clone repositories; opening a local folder does not need it.",
  destination_exists: "The destination folder already exists and is not empty.",
  host_verification:
    "SSH could not verify the server's host key. Connect once with ssh to check and accept it, or fix ~/.ssh/known_hosts. Codefield never accepts host keys for you.",
  ssh_permission: "The SSH server refused your key. Check that it is loaded (ssh-add -l) and has access to this repository.",
  authentication:
    "Git could not authenticate with the server using your existing credentials. Some hosts also answer this way when the repository does not exist.",
  not_found: "Git could not access the repository. It may not exist, or your account may not have access to it.",
  network: "Git could not reach the server. Check the host name and your network connection.",
  failed: "Git could not clone the repository. Its output above has the details.",
};

/**
 * @param {string} stderr
 * @returns {CloneFailure}
 */
export function classifyCloneFailure(stderr) {
  if (/already exists and is not an empty directory/i.test(stderr)) return "destination_exists";
  if (/Host key verification failed|REMOTE HOST IDENTIFICATION HAS CHANGED/i.test(stderr)) return "host_verification";
  if (/Permission denied \((publickey|keyboard-interactive|password)/i.test(stderr)) return "ssh_permission";
  if (/Authentication failed|could not read (Username|Password)|terminal prompts disabled|Invalid username or password/i.test(stderr)) {
    return "authentication";
  }
  if (/Could not resolve host|Could not resolve hostname|Connection timed out|Connection refused|Network is unreachable|Operation timed out|Failed to connect/i.test(stderr)) {
    return "network";
  }
  if (/Repository not found|does not appear to be a git repository|not found|does not exist/i.test(stderr)) return "not_found";
  return "failed";
}

/**
 * Clones with the system's git, so SSH keys, the SSH agent, ~/.ssh/config,
 * known_hosts and credential helpers work exactly as they do in a terminal.
 * Codefield reads none of them.
 * @param {{ remote: string, destination: string, spawn?: typeof nodeSpawn, stderr?: NodeJS.WritableStream, env?: NodeJS.ProcessEnv }} options
 * @returns {Promise<{ ok: true } | { ok: false, failure: CloneFailure }>}
 */
export async function cloneRepository({ remote, destination, spawn = nodeSpawn, stderr = process.stderr, env = process.env }) {
  if (await isNonEmptyDirectory(destination)) return { ok: false, failure: "destination_exists" };

  const progress = "isTTY" in stderr && Boolean(stderr.isTTY);
  return new Promise((resolvePromise) => {
    /** @type {import("node:child_process").ChildProcess} */
    let child;
    try {
      child = spawn("git", cloneArguments(remote, destination, { progress }), {
        shell: false,
        stdio: ["inherit", "inherit", "pipe"],
        env,
      });
    } catch {
      resolvePromise({ ok: false, failure: "git_missing" });
      return;
    }

    let tail = "";
    child.stderr?.on("data", (chunk) => {
      stderr.write(chunk);
      tail = (tail + chunk.toString()).slice(-16 * 1024);
    });
    child.on("error", (error) => {
      resolvePromise({ ok: false, failure: /** @type {NodeJS.ErrnoException} */ (error).code === "ENOENT" ? "git_missing" : "failed" });
    });
    child.on("close", (code) => {
      resolvePromise(code === 0 ? { ok: true } : { ok: false, failure: classifyCloneFailure(tail) });
    });
  });
}

/**
 * @param {string} remote
 * @param {string | null} directory
 * @param {string} cwd
 * @returns {string | null}
 */
export function cloneDestination(remote, directory, cwd) {
  if (directory !== null) return resolve(cwd, directory);
  const name = defaultDirectoryName(remote);
  return name === null ? null : resolve(cwd, name);
}

/** @param {string} path */
async function isNonEmptyDirectory(path) {
  try {
    return (await readdir(path)).length > 0;
  } catch (error) {
    // A file with that name is also in the way.
    return /** @type {NodeJS.ErrnoException} */ (error).code === "ENOTDIR";
  }
}
