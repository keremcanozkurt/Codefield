// @ts-check

/**
 * @typedef {{ port: number | null, open: boolean, dev: boolean }} Flags
 * @typedef {(
 *   | { command: "open", path: string } & Flags
 *   | { command: "clone", remote: string, directory: string | null } & Flags
 *   | { command: "help" }
 *   | { command: "version" }
 *   | { command: "error", message: string }
 * )} Command
 */

export const USAGE = `Understand a local codebase visually.

Usage:
  codefield [folder]                  Open a folder (default: the current folder)
  codefield clone <remote> [folder]   Clone a Git repository with your own Git setup, then open it

Options:
  --port <number>   Port on 127.0.0.1 (default: 4173, or the next free port)
  --no-open         Print the address instead of opening a browser
  -h, --help        Show this help
  -v, --version     Show the version`;

/**
 * A folder literally named "clone" can be analyzed as ./clone.
 * @param {string[]} argv
 * @returns {Command}
 */
export function parseArguments(argv) {
  /** @type {Flags} */
  const flags = { port: null, open: true, dev: false };
  /** @type {string[]} */
  const positional = [];

  for (let i = 0; i < argv.length; i++) {
    const argument = argv[i];
    if (argument === "-h" || argument === "--help") return { command: "help" };
    if (argument === "-v" || argument === "--version") return { command: "version" };
    if (argument === "--no-open") {
      flags.open = false;
    } else if (argument === "--dev") {
      flags.dev = true;
    } else if (argument === "--port" || argument.startsWith("--port=")) {
      const value = argument === "--port" ? argv[++i] : argument.slice("--port=".length);
      const port = Number(value);
      if (!/^\d+$/.test(value ?? "") || port < 1 || port > 65535) {
        return { command: "error", message: "--port needs a number between 1 and 65535." };
      }
      flags.port = port;
    } else if (argument === "--") {
      positional.push(...argv.slice(i + 1));
      break;
    } else if (argument.startsWith("-")) {
      return { command: "error", message: `Unknown option: ${argument}` };
    } else {
      positional.push(argument);
    }
  }

  if (positional[0] === "clone") {
    if (positional.length < 2) return { command: "error", message: "clone needs a Git remote, such as git@host:team/project.git." };
    if (positional.length > 3) return { command: "error", message: "clone takes a remote and at most one folder." };
    return { command: "clone", remote: positional[1], directory: positional[2] ?? null, ...flags };
  }
  if (positional.length > 1) return { command: "error", message: "Give one folder to analyze." };
  return { command: "open", path: positional[0] ?? ".", ...flags };
}
