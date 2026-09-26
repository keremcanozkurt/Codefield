import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { analyzeFixture, edges, edgesFrom, languagesOf, unresolvedOf } from "./testing.ts";

const pubspec = { "pubspec.yaml": "name: shop\ndescription: A shop.\ndependencies:\n  http: ^1.0.0\n" };

describe("Dart", () => {
  it("detects .dart files", () => {
    assert.deepEqual(languagesOf(["lib/main.dart", ".dart_tool/x.dart"]), { "lib/main.dart": "dart" });
  });

  it("resolves relative imports and exports across several files", () => {
    const analysis = analyzeFixture({
      "lib/app.dart": "import 'src/cart.dart';\nexport 'src/models.dart' show Item;\n",
      "lib/src/cart.dart": "import '../src/models.dart' as m;\n",
      "lib/src/models.dart": "",
    });

    assert.deepEqual(edges(analysis), [
      "lib/app.dart -> lib/src/cart.dart",
      "lib/app.dart -> lib/src/models.dart",
      "lib/src/cart.dart -> lib/src/models.dart",
    ]);
    assert.deepEqual(
      analysis.relationships.filter((r) => r.sourcePath === "lib/app.dart").map((r) => r.kind),
      ["import", "reexport"],
    );
  });

  it("resolves package: imports of this repository's own package", () => {
    const analysis = analyzeFixture(
      { "test/cart_test.dart": "import 'package:shop/src/cart.dart';\n", "lib/src/cart.dart": "" },
      { configs: pubspec },
    );

    assert.deepEqual(edges(analysis), ["test/cart_test.dart -> lib/src/cart.dart"]);
  });

  it("ignores dart: libraries and other packages", () => {
    const analysis = analyzeFixture(
      { "lib/a.dart": "import 'dart:async';\nimport 'package:http/http.dart' as http;\nimport 'package:flutter/material.dart';\n" },
      { configs: pubspec },
    );

    assert.deepEqual(edges(analysis), []);
    assert.deepEqual(unresolvedOf(analysis), []);
  });

  it("reports a missing relative import", () => {
    const analysis = analyzeFixture({ "lib/a.dart": "import 'b.dart';\n" });

    assert.deepEqual(unresolvedOf(analysis), ["lib/a.dart: b.dart (not_found)"]);
  });

  it("connects parts with their library, by URI or by library name", () => {
    const analysis = analyzeFixture({
      "lib/model.dart": "library shop.model;\npart 'model.g.dart';\npart 'model_extra.dart';\n",
      "lib/model.g.dart": "part of 'model.dart';\n",
      "lib/model_extra.dart": "part of shop.model;\n",
    });

    assert.deepEqual(edges(analysis), [
      "lib/model.dart -> lib/model.g.dart",
      "lib/model.dart -> lib/model_extra.dart",
      "lib/model.g.dart -> lib/model.dart",
      "lib/model_extra.dart -> lib/model.dart",
    ]);
  });

  it("uses only the default URI of a conditional import", () => {
    const analysis = analyzeFixture({
      "lib/a.dart": "import 'stub.dart' if (dart.library.io) 'io.dart';\n",
      "lib/stub.dart": "",
      "lib/io.dart": "",
    });

    assert.deepEqual(edges(analysis), ["lib/a.dart -> lib/stub.dart"]);
  });

  it("does not resolve interpolated URIs or imports inside strings and comments", () => {
    const analysis = analyzeFixture({
      "lib/a.dart": "// import 'b.dart';\nfinal s = \"import 'b.dart';\";\n/* /* nested */ import 'b.dart'; */\n",
      "lib/b.dart": "",
    });

    assert.deepEqual(edges(analysis), []);
  });

  it("skips a package name that two pubspec.yaml files claim", () => {
    const analysis = analyzeFixture(
      { "a/lib/x.dart": "", "b/lib/x.dart": "", "c/main.dart": "import 'package:dup/x.dart';\n" },
      { configs: { "a/pubspec.yaml": "name: dup\n", "b/pubspec.yaml": "name: dup\n" } },
    );

    assert.deepEqual(unresolvedOf(analysis), ["c/main.dart: package:dup/x.dart (ambiguous)"]);
  });

  it("keeps going after malformed code", () => {
    const analysis = analyzeFixture({ "lib/bad.dart": "import 'unterminated\nclass {{{", "lib/ok.dart": "import 'bad.dart';" });

    assert.deepEqual(edgesFrom(analysis, "lib/ok.dart"), ["lib/ok.dart -> lib/bad.dart"]);
  });
});
