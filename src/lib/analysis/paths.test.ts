import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { compareStrings, directoryOf, isRelativeSpecifier, joinRepositoryPath } from "./paths.ts";

describe("directoryOf", () => {
  it("returns everything before the last slash", () => {
    assert.equal(directoryOf("src/lib/paths.ts"), "src/lib");
  });

  it("returns the repository root for a top-level path", () => {
    assert.equal(directoryOf("index.ts"), "");
  });
});

describe("isRelativeSpecifier", () => {
  it("accepts ., .., ./ and ../ prefixes", () => {
    assert.equal(isRelativeSpecifier("."), true);
    assert.equal(isRelativeSpecifier(".."), true);
    assert.equal(isRelativeSpecifier("./foo"), true);
    assert.equal(isRelativeSpecifier("../foo"), true);
  });

  it("rejects package specifiers, including ones that merely start with a dot", () => {
    assert.equal(isRelativeSpecifier("react"), false);
    assert.equal(isRelativeSpecifier(".bin/thing"), false);
    assert.equal(isRelativeSpecifier("..hidden"), false);
  });
});

describe("joinRepositoryPath", () => {
  it("resolves a relative path against its base directory", () => {
    assert.equal(joinRepositoryPath("src/lib", "./paths.ts"), "src/lib/paths.ts");
    assert.equal(joinRepositoryPath("src/lib", "../app/page.tsx"), "src/app/page.tsx");
  });

  it("collapses . and repeated slashes without changing the result", () => {
    assert.equal(joinRepositoryPath("src", "./lib/././paths.ts"), "src/lib/paths.ts");
  });

  it("resolves against the repository root", () => {
    assert.equal(joinRepositoryPath("", "./src/index.ts"), "src/index.ts");
  });

  it("returns null when the result would leave the repository root", () => {
    assert.equal(joinRepositoryPath("src", "../../outside.ts"), null);
    assert.equal(joinRepositoryPath("", "../outside.ts"), null);
    assert.equal(joinRepositoryPath("", ".."), null);
  });

  it("only escapes as far as an intermediate .. actually climbs", () => {
    // "a/b/../../c" climbs back to the root and lands inside it, not past it.
    assert.equal(joinRepositoryPath("a/b", "../../c"), "c");
    assert.equal(joinRepositoryPath("a/b", "../../../c"), null);
  });
});

describe("compareStrings", () => {
  it("orders by UTF-16 code unit, not locale", () => {
    const sorted = ["b", "A", "a", "B"].sort(compareStrings);
    assert.deepEqual(sorted, ["A", "B", "a", "b"]);
  });

  it("treats equal strings as equal", () => {
    assert.equal(compareStrings("same", "same"), 0);
  });
});
