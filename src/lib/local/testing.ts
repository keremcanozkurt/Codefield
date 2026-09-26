import { mkdir, mkdtemp, realpath, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

// A temporary directory for tests, resolved to its real path the way the
// launcher resolves a repository root.
export async function temporaryDirectory(): Promise<{ path: string; remove(): Promise<void> }> {
  const path = await realpath(await mkdtemp(join(tmpdir(), "codefield-test-")));
  return { path, remove: () => rm(path, { recursive: true, force: true }) };
}

export async function writeFiles(root: string, files: Record<string, string | Uint8Array>): Promise<void> {
  for (const [path, content] of Object.entries(files)) {
    const absolute = join(root, ...path.split("/"));
    await mkdir(dirname(absolute), { recursive: true });
    await writeFile(absolute, content);
  }
}

// Creating symbolic links needs extra rights on Windows; tests that need one
// skip themselves when this returns false.
export async function trySymlink(target: string, path: string, type: "file" | "dir" = "file"): Promise<boolean> {
  try {
    await mkdir(dirname(path), { recursive: true });
    await symlink(target, path, type === "dir" ? "junction" : "file");
    return true;
  } catch {
    return false;
  }
}
