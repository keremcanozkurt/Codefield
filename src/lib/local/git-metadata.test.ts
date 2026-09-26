import assert from "node:assert/strict";
import { join } from "node:path";
import { afterEach, beforeEach, describe, it } from "node:test";

import { branchFromHead, displayRemote, originUrl, readGitMetadata } from "./git-metadata.ts";
import { temporaryDirectory, writeFiles } from "./testing.ts";

describe("displayRemote", () => {
  it("shows host and path for SSH and HTTPS remotes of any host", () => {
    assert.equal(displayRemote("git@github.com:user/project.git"), "github.com/user/project");
    assert.equal(displayRemote("git@gitlab.com:group/sub/project.git"), "gitlab.com/group/sub/project");
    assert.equal(displayRemote("git@git.company.com:team/project.git"), "git.company.com/team/project");
    assert.equal(displayRemote("ssh://git@bitbucket.org:2222/team/project.git"), "bitbucket.org/team/project");
    assert.equal(displayRemote("https://codeberg.org/user/project"), "codeberg.org/user/project");
  });

  it("drops user names, passwords and tokens", () => {
    assert.equal(displayRemote("https://oauth2:glpat-secret@gitlab.com/g/p.git"), "gitlab.com/g/p");
    assert.equal(displayRemote("https://x-access-token:ghs_secret@github.com/o/r"), "github.com/o/r");
  });

  it("hides local paths", () => {
    assert.equal(displayRemote("/srv/git/project.git"), null);
    assert.equal(displayRemote("../project"), null);
    assert.equal(displayRemote("file:///srv/git/project.git"), null);
    assert.equal(displayRemote("C:\\repos\\project"), null);
  });
});

describe("originUrl", () => {
  it("reads the origin url and ignores other remotes", () => {
    const config = [
      "[core]",
      "\trepositoryformatversion = 0",
      '[remote "upstream"]',
      "\turl = git@example.com:upstream/project.git",
      '[remote "origin"]',
      "\turl = git@example.com:me/project.git",
      "\tfetch = +refs/heads/*:refs/remotes/origin/*",
    ].join("\r\n");
    assert.equal(originUrl(config), "git@example.com:me/project.git");
  });

  it("returns null without an origin", () => {
    assert.equal(originUrl("[core]\n\tbare = false\n"), null);
  });
});

describe("branchFromHead", () => {
  it("reads the branch, or null for a detached HEAD", () => {
    assert.equal(branchFromHead("ref: refs/heads/main\n"), "main");
    assert.equal(branchFromHead("4b825dc642cb6eb9a060e54bf8d69288fbee4904\n"), null);
  });
});

describe("readGitMetadata", () => {
  let root: string;
  let remove: () => Promise<void>;
  beforeEach(async () => {
    ({ path: root, remove } = await temporaryDirectory());
  });
  afterEach(async () => {
    await remove();
  });

  it("finds the repository from a subdirectory", async () => {
    await writeFiles(root, { ".git/HEAD": "ref: refs/heads/dev\n", ".git/config": "", "src/a.ts": "" });

    assert.deepEqual(await readGitMetadata(join(root, "src")), { branch: "dev", remote: null });
  });

  it("follows a .git file to a worktree's directory and its common config", async () => {
    await writeFiles(root, {
      "main/.git/config": '[remote "origin"]\n\turl = git@example.com:team/app.git\n',
      "main/.git/worktrees/wt/HEAD": "ref: refs/heads/topic\n",
      "main/.git/worktrees/wt/commondir": "../..\n",
      "wt/.git": `gitdir: ${join(root, "main/.git/worktrees/wt")}\n`,
    });

    assert.deepEqual(await readGitMetadata(join(root, "wt")), { branch: "topic", remote: "example.com/team/app" });
  });
});
