import { readFile, stat } from "node:fs/promises";
import { dirname, isAbsolute, join, resolve } from "node:path";

export type GitMetadata = {
  // The checked-out branch, or null for a detached HEAD.
  branch: string | null;
  // origin's host and path, such as "github.com/owner/repo", without any
  // user name, password or token the URL may contain. Null without an origin,
  // or when origin is a local path.
  remote: string | null;
};

// Reads the branch and origin from the repository's files instead of running
// git: a repository's own config can make some git commands run programs it
// names (core.fsmonitor, for example), and Codefield never runs anything from
// the repository it analyzes. The folder does not have to be a Git repository;
// without one, the result is null.
export async function readGitMetadata(root: string): Promise<GitMetadata | null> {
  const gitDir = await findGitDir(root);
  if (gitDir === null) return null;

  const head = await readSmallFile(join(gitDir, "HEAD"));
  const branch = head === null ? null : branchFromHead(head);

  // Linked worktrees keep their config in the main repository's directory.
  const common = await readSmallFile(join(gitDir, "commondir"));
  const configDir = common === null ? gitDir : resolve(gitDir, common.trim());
  const config = await readSmallFile(join(configDir, "config"));
  const url = config === null ? null : originUrl(config);

  return { branch, remote: url === null ? null : displayRemote(url) };
}

// The folder may be a subdirectory of a repository, so parents are searched
// too. `.git` is a directory, or a file pointing to one for worktrees and
// submodules.
async function findGitDir(root: string): Promise<string | null> {
  let directory = root;
  while (true) {
    const candidate = join(directory, ".git");
    try {
      const stats = await stat(candidate);
      if (stats.isDirectory()) return candidate;
      if (stats.isFile()) {
        const pointer = await readSmallFile(candidate);
        const match = pointer?.match(/^gitdir:\s*(.+?)\s*$/m);
        if (match) return isAbsolute(match[1]) ? match[1] : resolve(directory, match[1]);
      }
    } catch {
      // Not here; try the parent.
    }
    const parent = dirname(directory);
    if (parent === directory) return null;
    directory = parent;
  }
}

async function readSmallFile(path: string): Promise<string | null> {
  try {
    const stats = await stat(path);
    if (!stats.isFile() || stats.size > 256 * 1024) return null;
    return await readFile(path, "utf8");
  } catch {
    return null;
  }
}

export function branchFromHead(head: string): string | null {
  const match = head.trim().match(/^ref:\s*refs\/heads\/(.+)$/);
  return match ? match[1] : null;
}

// The url of [remote "origin"] in a Git config file. Only the plain form Git
// writes itself is understood; anything else is treated as no origin.
export function originUrl(config: string): string | null {
  let inOrigin = false;
  for (const raw of config.split(/\r?\n/)) {
    const line = raw.trim();
    if (line.startsWith("[")) {
      inOrigin = /^\[remote\s+"origin"\]$/.test(line);
      continue;
    }
    if (!inOrigin) continue;
    const match = line.match(/^url\s*=\s*(.+)$/);
    if (match) return match[1].trim().replace(/^"(.*)"$/, "$1");
  }
  return null;
}

// "host/path" for a remote URL, dropping credentials, ports, query strings and
// a trailing ".git". Returns null for local paths and file:// URLs, which
// would only expose the user's own directory layout.
export function displayRemote(url: string): string | null {
  const scp = url.match(/^(?:[^@/\s]+@)?([^:/\s]+):(?!\/\/)(.+)$/);
  if (scp && !/^[a-zA-Z]$/.test(scp[1])) return clean(`${scp[1]}/${scp[2]}`);

  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return null;
  }
  if (parsed.protocol === "file:" || parsed.hostname === "") return null;
  return clean(`${parsed.hostname}${parsed.pathname}`);
}

function clean(value: string): string {
  return value.replace(/\/+$/, "").replace(/\.git$/, "").replace(/\/{2,}/g, "/");
}
