import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { analyzeFixture, edges, edgesFrom, languagesOf, unresolvedOf } from "./testing.ts";

describe("Scala", () => {
  it("detects .scala and .sc files", () => {
    assert.deepEqual(languagesOf(["A.scala", "script.sc", "target/B.scala"]), { "A.scala": "scala", "script.sc": "scala" });
  });

  it("resolves plain, selector, renamed and Scala 3 imports", () => {
    const analysis = analyzeFixture({
      "app/Main.scala": "package com.acme.app\n\nimport com.acme.model.User\nimport com.acme.model.{Order, Item => LineItem}\nimport com.acme.util.Json as J\nimport scala.concurrent.Future\n",
      "model/User.scala": "package com.acme.model\ncase class User(name: String)\n",
      "model/Order.scala": "package com.acme.model\nfinal case class Order()\n",
      "model/Item.scala": "package com.acme.model\ntrait Item\n",
      "util/Json.scala": "package com.acme.util\nobject Json\n",
    });

    assert.deepEqual(edgesFrom(analysis, "app/Main.scala"), [
      "app/Main.scala -> model/Item.scala",
      "app/Main.scala -> model/Order.scala",
      "app/Main.scala -> model/User.scala",
      "app/Main.scala -> util/Json.scala",
    ]);
  });

  it("resolves imports relative to the enclosing package and chained package clauses", () => {
    const analysis = analyzeFixture({
      "a/Use.scala": "package com.acme\npackage app\n\nimport model.User\nclass Use(s: Shared)\n",
      "model/User.scala": "package com.acme.app.model\nclass User\n",
      "Shared.scala": "package com.acme\nclass Shared\n",
    });

    assert.deepEqual(edgesFrom(analysis, "a/Use.scala"), ["a/Use.scala -> Shared.scala", "a/Use.scala -> model/User.scala"]);
  });

  it("uses wildcard imports only for names used", () => {
    const analysis = analyzeFixture({
      "Main.scala": "package app\nimport lib._\nobject Main { val c = new Codec() }\n",
      "lib/Codec.scala": "package lib\nclass Codec\n",
      "lib/Other.scala": "package lib\nclass Other\n",
    });

    assert.deepEqual(edgesFrom(analysis, "Main.scala"), ["Main.scala -> lib/Codec.scala"]);
  });

  it("ignores library imports and does not guess member imports", () => {
    const analysis = analyzeFixture({
      "A.scala": "package a\nimport cats.effect.IO\nimport b.Helpers.format\nclass A\n",
      "b/Helpers.scala": "package b\nobject Helpers { def format(x: Int) = x }\n",
    });

    assert.deepEqual(edges(analysis), ["A.scala -> b/Helpers.scala"]);
    assert.deepEqual(unresolvedOf(analysis), []);
  });

  it("skips ambiguous names and ignores strings, interpolation, chars and symbols", () => {
    const analysis = analyzeFixture({
      "x/Dup.scala": "package p\nclass Dup\n",
      "y/Dup.scala": "package p\nclass Dup\n",
      "Use.scala": 'package p\nclass Use(d: Dup) { val s = s"Helper $x"; val c = \'"\'; val sym = \'Helper }\n',
      "Helper.scala": "package p\nclass Helper\n",
    });

    assert.deepEqual(edgesFrom(analysis, "Use.scala"), []);
  });

  it("keeps going after malformed code", () => {
    const analysis = analyzeFixture({ "Bad.scala": "package p\nclass Bad(g: Good\n\"\"\"unterminated", "Good.scala": "package p\nclass Good" });

    assert.deepEqual(edges(analysis), ["Bad.scala -> Good.scala"]);
  });
});
