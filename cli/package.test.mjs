import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";

import { isSupportedNode, MINIMUM_NODE, PACKAGE_ROOT, parseMinimum, VERSION } from "./package.mjs";

const manifest = JSON.parse(readFileSync(join(PACKAGE_ROOT, "package.json"), "utf8"));
const cli = join(PACKAGE_ROOT, "cli", "codefield.mjs");

describe("package metadata", () => {
  it("installs a codefield command that runs with node", () => {
    assert.equal(manifest.bin.codefield, "cli/codefield.mjs");
    assert.ok(readFileSync(cli, "utf8").startsWith("#!/usr/bin/env node\n"));
  });

  it("ships the CLI, the production build and the license, without tests or build caches", () => {
    for (const entry of ["cli/*.mjs", "!cli/*.test.mjs", ".next", "!.next/cache", "!.next/dev", "LICENSE", "README.md"]) {
      assert.ok(manifest.files.includes(entry), entry);
    }
    assert.ok(!manifest.files.includes("src"));
    assert.ok(existsSync(join(PACKAGE_ROOT, "LICENSE")));
  });

  it("is MIT licensed and declares the Node.js versions it runs on", () => {
    assert.equal(manifest.license, "MIT");
    assert.deepEqual(MINIMUM_NODE, parseMinimum(manifest.engines.node));
  });

  it("keeps runtime dependencies to what the server needs", () => {
    assert.deepEqual(Object.keys(manifest.dependencies).sort(), ["graphology", "next", "react", "react-dom", "sigma", "typescript"]);
  });
});

describe("Node.js version check", () => {
  it("reads the minimum from an engines range", () => {
    assert.deepEqual(parseMinimum(">=20.9"), [20, 9]);
    assert.deepEqual(parseMinimum(">=22"), [22, 0]);
    assert.throws(() => parseMinimum("^20"));
  });

  it("accepts the minimum and anything newer", () => {
    assert.equal(isSupportedNode("20.9.0", [20, 9]), true);
    assert.equal(isSupportedNode("20.10.1", [20, 9]), true);
    assert.equal(isSupportedNode("22.0.0", [20, 9]), true);
    assert.equal(isSupportedNode("20.8.1", [20, 9]), false);
    assert.equal(isSupportedNode("18.20.4", [20, 9]), false);
  });
});

describe("codefield command", () => {
  const run = (...args) => spawnSync(process.execPath, [cli, ...args], { encoding: "utf8" });

  it("prints the version from package.json", () => {
    assert.equal(execFileSync(process.execPath, [cli, "--version"], { encoding: "utf8" }), `codefield ${VERSION}\n`);
    assert.equal(run("-v").stdout, `codefield ${manifest.version}\n`);
  });

  it("prints concise help without development flags", () => {
    const help = run("--help").stdout;
    for (const text of ["codefield [folder]", "codefield clone <remote> [folder]", "--port", "--no-open", "--help", "--version"]) {
      assert.ok(help.includes(text), text);
    }
    assert.ok(!help.includes("--dev"));
  });

  it("explains a mistake and exits with an error", () => {
    const unknown = run("--shell");
    assert.equal(unknown.status, 1);
    assert.match(unknown.stderr, /^codefield: Unknown option: --shell/);

    const missing = run("--no-open", join(PACKAGE_ROOT, "does-not-exist"));
    assert.equal(missing.status, 1);
    assert.match(missing.stderr, /Folder not found/);
    assert.ok(!missing.stderr.includes("    at "), "no stack trace");
  });
});
