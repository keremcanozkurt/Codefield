import assert from "node:assert/strict";
import { chmod, mkdtemp, mkdir, readdir, realpath, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, describe, it } from "node:test";

import { baseDirectory, resolveRoot } from "./root.mjs";

let base;
before(async () => {
  base = await realpath(await mkdtemp(join(tmpdir(), "codefield-cli-")));
  await mkdir(join(base, "project"));
  await writeFile(join(base, "file.txt"), "");
});
after(async () => {
  await rm(base, { recursive: true, force: true });
});

describe("resolveRoot", () => {
  it("resolves a relative folder against the working directory", async () => {
    assert.deepEqual(await resolveRoot("project", base), { ok: true, root: join(base, "project") });
    assert.deepEqual(await resolveRoot(".", join(base, "project")), { ok: true, root: join(base, "project") });
  });

  it("resolves a symbolic link to the real folder it names", async (t) => {
    try {
      await symlink(join(base, "project"), join(base, "link"), "junction");
    } catch {
      return t.skip("symbolic links are not available");
    }
    assert.deepEqual(await resolveRoot("link", base), { ok: true, root: join(base, "project") });
  });

  it("rejects missing folders and files", async () => {
    assert.equal((await resolveRoot("missing", base)).ok, false);
    const file = await resolveRoot("file.txt", base);
    assert.equal(file.ok, false);
    assert.match(file.ok ? "" : file.message, /Not a folder/);
  });

  it("rejects a folder it cannot list", async (t) => {
    const locked = join(base, "locked");
    await mkdir(locked);
    await chmod(locked, 0o000);
    try {
      await readdir(locked);
      return t.skip("permissions are not enforced for this user or platform");
    } catch {
      const result = await resolveRoot("locked", base);
      assert.deepEqual(result, { ok: false, message: `Permission denied: ${locked}` });
    } finally {
      await chmod(locked, 0o755);
    }
  });
});

describe("baseDirectory", () => {
  it("uses the folder npm was started from for Codefield's own scripts", () => {
    const env = { npm_package_name: "@keremcanozkurt/codefield", npm_lifecycle_event: "dev", INIT_CWD: "/work/other" };
    assert.equal(baseDirectory(env, "/opt/codefield"), "/work/other");
  });

  it("uses the working directory otherwise, even when INIT_CWD is set", () => {
    assert.equal(baseDirectory({ INIT_CWD: "/somewhere" }, "/work/project"), "/work/project");
    assert.equal(
      baseDirectory({ npm_package_name: "other-app", npm_lifecycle_event: "dev", INIT_CWD: "/x" }, "/work/project"),
      "/work/project",
    );
  });
});
