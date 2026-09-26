import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { analyzeFixture, edges, edgesFrom, languagesOf, unresolvedOf } from "./testing.ts";

describe("Kotlin", () => {
  it("detects .kt and .kts files", () => {
    assert.deepEqual(languagesOf(["App.kt", "build.gradle.kts", ".gradle/x.kt"]), { "App.kt": "kotlin", "build.gradle.kts": "kotlin" });
  });

  it("resolves imports, aliases and imported top-level functions", () => {
    const analysis = analyzeFixture({
      "app/Main.kt": "package com.acme.app\n\nimport com.acme.data.Repository as Repo\nimport com.acme.data.formatPrice\nimport kotlinx.coroutines.launch\n\nfun main() { Repo() }\n",
      "data/Repository.kt": "package com.acme.data\n\nclass Repository\n",
      "data/Format.kt": "package com.acme.data\n\nfun formatPrice(cents: Long): String = \"$cents\"\n",
    });

    assert.deepEqual(edges(analysis), ["app/Main.kt -> data/Format.kt", "app/Main.kt -> data/Repository.kt"]);
  });

  it("resolves classes, objects and type aliases used from the same package", () => {
    const analysis = analyzeFixture({
      "Cart.kt": "package shop\n\ndata class Cart(val items: List<Item>, val rules: Rules, val id: Id)\n",
      "Item.kt": "package shop\n\nsealed interface Item\n",
      "Rules.kt": "package shop\n\nobject Rules\n",
      "Ids.kt": "package shop\n\ntypealias Id = String\n",
    });

    assert.deepEqual(edgesFrom(analysis, "Cart.kt"), ["Cart.kt -> Ids.kt", "Cart.kt -> Item.kt", "Cart.kt -> Rules.kt"]);
  });

  it("uses a wildcard import only for the names actually used", () => {
    const analysis = analyzeFixture({
      "ui/Screen.kt": "package ui\nimport model.*\nclass Screen(val user: User)\n",
      "model/User.kt": "package model\nclass User\n",
      "model/Order.kt": "package model\nclass Order\n",
    });

    assert.deepEqual(edgesFrom(analysis, "ui/Screen.kt"), ["ui/Screen.kt -> model/User.kt"]);
  });

  it("ignores library imports and reports missing types in known packages", () => {
    const analysis = analyzeFixture({
      "a/A.kt": "package a\nimport androidx.compose.runtime.Composable\nimport a.Gone\nclass A\n",
    });

    assert.deepEqual(edges(analysis), []);
    assert.deepEqual(unresolvedOf(analysis), ["a/A.kt: a.Gone (not_found)"]);
  });

  it("skips a name declared in two files of the package", () => {
    const analysis = analyzeFixture({
      "one/Config.kt": "package p\nclass Config\n",
      "two/Config.kt": "package p\nclass Config\n",
      "Use.kt": "package p\nclass Use(val c: Config)\n",
    });

    assert.deepEqual(edgesFrom(analysis, "Use.kt"), []);
  });

  it("ignores names in strings, templates and nested comments", () => {
    const analysis = analyzeFixture({
      "A.kt": 'package p\n/* /* Helper */ Helper */\nval s = "Helper ${1}"\nval r = """\nHelper\n"""\n',
      "Helper.kt": "package p\nclass Helper\n",
    });

    assert.deepEqual(edges(analysis), []);
  });

  it("keeps going after malformed code", () => {
    const analysis = analyzeFixture({ "Bad.kt": "package p\nclass Bad(val g: Good\n\"unterminated", "Good.kt": "package p\nclass Good" });

    assert.deepEqual(edges(analysis), ["Bad.kt -> Good.kt"]);
  });
});
