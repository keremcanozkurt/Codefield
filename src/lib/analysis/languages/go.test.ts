import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { representativeFile } from "./go.ts";
import { analyzeFixture, edges, edgesFrom, languagesOf, unresolvedOf } from "./testing.ts";

const goMod = { "go.mod": "module github.com/acme/shop\n\ngo 1.22\n\nrequire github.com/google/uuid v1.6.0\n" };

describe("Go", () => {
  it("detects .go files outside vendor", () => {
    assert.deepEqual(languagesOf(["main.go", "vendor/x/y.go"]), { "main.go": "go" });
  });

  it("maps module import paths to one representative file per package", () => {
    const analysis = analyzeFixture(
      {
        "cmd/shop/main.go": 'package main\n\nimport (\n\t"fmt"\n\t"github.com/acme/shop/internal/store"\n)\n',
        "internal/store/store.go": 'package store\n\nimport db "github.com/acme/shop/internal/db"\n',
        "internal/store/cache.go": "package store\n",
        "internal/store/store_test.go": 'package store\n\nimport "testing"\n',
        "internal/db/conn.go": "package db\n",
        "internal/db/query.go": "package db\n",
      },
      { configs: goMod },
    );

    assert.deepEqual(edges(analysis), [
      "cmd/shop/main.go -> internal/store/store.go",
      "internal/store/store.go -> internal/db/conn.go",
    ]);
  });

  it("picks the file named after the package directory, then the first non-test file", () => {
    assert.equal(representativeFile(["a/x/b.go", "a/x/x.go", "a/x/a.go"], "a/x"), "a/x/x.go");
    assert.equal(representativeFile(["a/x/b.go", "a/x/a_test.go", "a/x/c.go"], "a/x"), "a/x/b.go");
    assert.equal(representativeFile(["a/x/a_test.go"], "a/x"), null);
    assert.equal(representativeFile(["active_help.go", "args.go", "cobra.go"], "", "cobra"), "cobra.go");
  });

  it("uses the package clause for a package at the module root", () => {
    const analysis = analyzeFixture(
      {
        "args.go": "package cobra\n",
        "cobra.go": "package cobra\n",
        "doc/gen.go": 'package doc\nimport "github.com/acme/shop"\n',
      },
      { configs: goMod },
    );

    assert.deepEqual(edges(analysis), ["doc/gen.go -> cobra.go"]);
  });

  it("ignores the standard library and other modules", () => {
    const analysis = analyzeFixture(
      { "main.go": 'package main\nimport (\n "net/http"\n _ "embed"\n u "github.com/google/uuid"\n . "strings"\n)\n' },
      { configs: goMod },
    );

    assert.deepEqual(edges(analysis), []);
    assert.deepEqual(unresolvedOf(analysis), []);
  });

  it("reports an import of a package directory with no Go files", () => {
    const analysis = analyzeFixture({ "main.go": 'package main\nimport "github.com/acme/shop/missing"\n' }, { configs: goMod });

    assert.deepEqual(unresolvedOf(analysis), ["main.go: github.com/acme/shop/missing (not_found)"]);
  });

  it("uses the innermost go.mod in a multi-module repository", () => {
    const analysis = analyzeFixture(
      {
        "api/server.go": 'package api\nimport "github.com/acme/shop/tools/gen"\n',
        "tools/gen/gen.go": "package gen\n",
      },
      { configs: { ...goMod, "tools/go.mod": "module github.com/acme/shop/tools\n" } },
    );

    assert.deepEqual(edges(analysis), ["api/server.go -> tools/gen/gen.go"]);
  });

  it("ignores imports in comments and raw strings", () => {
    const analysis = analyzeFixture(
      {
        "main.go": 'package main\n// import "github.com/acme/shop/lib"\nvar s = `\nimport "github.com/acme/shop/lib"\n`\n',
        "lib/lib.go": "package lib\n",
      },
      { configs: goMod },
    );

    assert.deepEqual(edges(analysis), []);
  });

  it("maps nothing without a go.mod", () => {
    const analysis = analyzeFixture({ "main.go": 'package main\nimport "example.com/x/lib"\n', "lib/lib.go": "package lib" });

    assert.deepEqual(edges(analysis), []);
  });

  it("keeps going after malformed code", () => {
    const analysis = analyzeFixture(
      { "bad.go": 'package main\nimport (\n"github.com/acme/shop/lib"', "lib/lib.go": "package lib" },
      { configs: goMod },
    );

    assert.deepEqual(edgesFrom(analysis, "bad.go"), ["bad.go -> lib/lib.go"]);
  });
});
