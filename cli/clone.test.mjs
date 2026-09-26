import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { EventEmitter } from "node:events";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, readdir, readFile, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PassThrough, Writable } from "node:stream";
import { after, before, describe, it } from "node:test";

import {
  classifyCloneFailure,
  cloneArguments,
  cloneDestination,
  cloneRepository,
  defaultDirectoryName,
  validateRemote,
} from "./clone.mjs";

const sink = () => new Writable({ write: (_chunk, _encoding, done) => done() });

function fakeSpawn({ code = 0, stderr = "", error = null } = {}) {
  const calls = [];
  const spawn = (command, args, options) => {
    calls.push({ command, args, options });
    const child = new EventEmitter();
    child.stderr = new PassThrough();
    setImmediate(() => {
      if (error) {
        child.emit("error", error);
        return;
      }
      child.stderr.end(stderr);
      child.emit("close", code);
    });
    return child;
  };
  return { spawn, calls };
}

let base;
before(async () => {
  base = await realpath(await mkdtemp(join(tmpdir(), "codefield-clone-")));
});
after(async () => {
  await rm(base, { recursive: true, force: true });
});

describe("validateRemote", () => {
  it("accepts remotes on any Git host, over SSH, HTTPS or a local path", () => {
    for (const remote of [
      "git@github.com:user/project.git",
      "git@gitlab.com:user/project.git",
      "git@bitbucket.org:user/project.git",
      "git@git.company.com:team/project.git",
      "ssh://git@codeberg.org/user/project.git",
      "https://gitea.example.com/user/project.git",
      "git://example.com/project.git",
      "file:///srv/git/project.git",
      "/srv/git/project.git",
      "../project",
    ]) {
      assert.deepEqual(validateRemote(remote), { ok: true }, remote);
    }
  });

  it("refuses remotes git could read as options or commands", () => {
    for (const remote of [
      "--upload-pack=touch /tmp/x",
      "-u touch",
      "ext::sh -c touch% /tmp/x",
      "fd::17",
      "EXT::sh",
      "evil://host/repo",
      "git@host:repo\n--upload-pack=x",
      " git@host:repo",
      "",
    ]) {
      assert.equal(validateRemote(remote).ok, false, JSON.stringify(remote));
    }
  });
});

describe("defaultDirectoryName", () => {
  it("picks the folder name git would", () => {
    assert.equal(defaultDirectoryName("git@github.com:user/project.git"), "project");
    assert.equal(defaultDirectoryName("https://example.com/team/app/"), "app");
    assert.equal(defaultDirectoryName("git@host:app"), "app");
    assert.equal(defaultDirectoryName("C:\\repos\\tool.git"), "tool");
  });

  it("gives up instead of inventing a name", () => {
    assert.equal(defaultDirectoryName("git@host:"), null);
    assert.equal(defaultDirectoryName("https://example.com/.."), null);
  });

  it("resolves the destination against the working directory", () => {
    assert.equal(cloneDestination("git@h:a/b.git", null, base), join(base, "b"));
    assert.equal(cloneDestination("git@h:a/b.git", "custom", base), join(base, "custom"));
  });
});

describe("cloneArguments", () => {
  it("passes the remote and destination as plain arguments after --", () => {
    assert.deepEqual(cloneArguments("$(touch x); rm -rf ~", "dest"), [
      "-c",
      "protocol.ext.allow=never",
      "clone",
      "--",
      "$(touch x); rm -rf ~",
      "dest",
    ]);
  });
});

describe("cloneRepository", () => {
  it("runs the system git without a shell and with the user's environment", async () => {
    const { spawn, calls } = fakeSpawn();
    const env = { PATH: "/usr/bin", SSH_AUTH_SOCK: "/run/agent.sock", GIT_SSH_COMMAND: "ssh -i key" };

    const result = await cloneRepository({ remote: "git@host:a/b.git", destination: join(base, "b"), spawn, stderr: sink(), env });

    assert.deepEqual(result, { ok: true });
    assert.equal(calls.length, 1);
    assert.equal(calls[0].command, "git");
    assert.equal(calls[0].options.shell, false);
    assert.equal(calls[0].options.env, env);
    assert.deepEqual(calls[0].args.slice(-3), ["--", "git@host:a/b.git", join(base, "b")]);
  });

  it("reports a missing git", async () => {
    const error = Object.assign(new Error("spawn git ENOENT"), { code: "ENOENT" });
    const { spawn } = fakeSpawn({ error });

    assert.deepEqual(await cloneRepository({ remote: "r", destination: join(base, "x"), spawn, stderr: sink() }), {
      ok: false,
      failure: "git_missing",
    });
  });

  it("refuses a non-empty destination without starting git", async () => {
    await mkdir(join(base, "taken"));
    await writeFile(join(base, "taken", "keep.txt"), "mine");
    const { spawn, calls } = fakeSpawn();

    const result = await cloneRepository({ remote: "r", destination: join(base, "taken"), spawn, stderr: sink() });

    assert.deepEqual(result, { ok: false, failure: "destination_exists" });
    assert.equal(calls.length, 0);
    assert.equal(await readFile(join(base, "taken", "keep.txt"), "utf8"), "mine");
  });

  it("classifies a failure from git's output", async () => {
    const { spawn } = fakeSpawn({ code: 128, stderr: "git@github.com: Permission denied (publickey).\nfatal: Could not read from remote repository.\n" });

    assert.deepEqual(await cloneRepository({ remote: "r", destination: join(base, "y"), spawn, stderr: sink() }), {
      ok: false,
      failure: "ssh_permission",
    });
  });
});

describe("classifyCloneFailure", () => {
  it("recognizes common git and ssh failures", () => {
    assert.equal(classifyCloneFailure("Host key verification failed.\nfatal: Could not read from remote repository."), "host_verification");
    assert.equal(classifyCloneFailure("ssh: Could not resolve hostname git.nowhere: Name or service not known"), "network");
    assert.equal(classifyCloneFailure("fatal: unable to access 'https://x/': Failed to connect to x port 443"), "network");
    assert.equal(classifyCloneFailure("remote: Invalid username or password.\nfatal: Authentication failed for 'https://x/'"), "authentication");
    assert.equal(classifyCloneFailure("fatal: could not read Username for 'https://x': terminal prompts disabled"), "authentication");
    assert.equal(classifyCloneFailure("ERROR: Repository not found.\nfatal: Could not read from remote repository."), "not_found");
    assert.equal(classifyCloneFailure("fatal: destination path 'x' already exists and is not an empty directory."), "destination_exists");
    assert.equal(classifyCloneFailure("fatal: something unexpected"), "failed");
  });
});

// With a real git, when one is installed: a local repository stands in for a
// remote, so no network is needed.
describe("cloneRepository with the system git", () => {
  let hasGit = true;
  try {
    execFileSync("git", ["--version"], { stdio: "ignore" });
  } catch {
    hasGit = false;
  }

  it("clones a repository and writes nothing but the clone", { skip: !hasGit && "git is not installed" }, async () => {
    const source = join(base, "source");
    await mkdir(source);
    const git = (...args) =>
      execFileSync("git", args, {
        cwd: source,
        stdio: "ignore",
        env: { ...process.env, GIT_AUTHOR_NAME: "t", GIT_AUTHOR_EMAIL: "t@t", GIT_COMMITTER_NAME: "t", GIT_COMMITTER_EMAIL: "t@t" },
      });
    git("init", "-q");
    await writeFile(join(source, "main.py"), "import util\n");
    git("add", ".");
    git("commit", "-q", "-m", "init");

    const workspace = join(base, "workspace");
    await mkdir(workspace);
    const result = await cloneRepository({ remote: source, destination: join(workspace, "copy"), stderr: sink() });

    assert.deepEqual(result, { ok: true });
    assert.deepEqual(await readdir(workspace), ["copy"]);
    assert.equal(await readFile(join(workspace, "copy", "main.py"), "utf8"), "import util\n");
  });

  it("never runs a remote string as a command", { skip: !hasGit && "git is not installed" }, async () => {
    const workspace = join(base, "injection");
    await mkdir(workspace);
    const marker = join(workspace, "pwned");
    for (const remote of [`$(touch ${marker})`, `x;touch ${marker}`, `\`touch ${marker}\``, `x|touch ${marker}`]) {
      const result = await cloneRepository({ remote, destination: join(workspace, "dest"), stderr: sink() });
      assert.equal(result.ok, false, remote);
    }
    assert.equal(existsSync(marker), false);
  });
});
