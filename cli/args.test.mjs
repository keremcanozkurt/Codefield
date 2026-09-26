import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { parseArguments } from "./args.mjs";

describe("parseArguments", () => {
  it("opens the current folder by default", () => {
    assert.deepEqual(parseArguments([]), { command: "open", path: ".", port: null, open: true, dev: false });
  });

  it("opens a given folder, with options in any position", () => {
    assert.deepEqual(parseArguments(["--no-open", "../project", "--port", "5000"]), {
      command: "open",
      path: "../project",
      port: 5000,
      open: false,
      dev: false,
    });
    assert.equal(parseArguments(["--port=5001", "."]).port, 5001);
  });

  it("clones a remote into an optional folder", () => {
    assert.deepEqual(parseArguments(["clone", "git@example.com:team/app.git"]), {
      command: "clone",
      remote: "git@example.com:team/app.git",
      directory: null,
      port: null,
      open: true,
      dev: false,
    });
    const withFolder = parseArguments(["clone", "https://example.com/app.git", "work/app"]);
    assert.equal(withFolder.command === "clone" && withFolder.directory, "work/app");
  });

  it("opens a folder named clone when it is written as a path", () => {
    assert.deepEqual(parseArguments(["./clone"]).command, "open");
  });

  it("treats everything after -- as positional, so a remote cannot become an option", () => {
    const command = parseArguments(["clone", "--", "--upload-pack=touch x"]);
    assert.equal(command.command === "clone" && command.remote, "--upload-pack=touch x");
  });

  it("rejects unknown options, bad ports and extra arguments", () => {
    assert.equal(parseArguments(["--shell"]).command, "error");
    assert.equal(parseArguments(["--port", "0"]).command, "error");
    assert.equal(parseArguments(["--port", "http"]).command, "error");
    assert.equal(parseArguments(["--port"]).command, "error");
    assert.equal(parseArguments(["a", "b"]).command, "error");
    assert.equal(parseArguments(["clone"]).command, "error");
    assert.equal(parseArguments(["clone", "r", "d", "extra"]).command, "error");
  });

  it("shows help and version", () => {
    assert.equal(parseArguments(["--help"]).command, "help");
    assert.equal(parseArguments(["-v"]).command, "version");
  });
});
