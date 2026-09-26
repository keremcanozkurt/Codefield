import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { analyzeFixture, edges, edgesFrom, languagesOf, unresolvedOf } from "./testing.ts";

const main = "src/main/java/com/acme/shop";

describe("Java", () => {
  it("detects .java files outside target and build", () => {
    assert.deepEqual(languagesOf(["A.java", "target/gen/B.java", "build/C.java"]), { "A.java": "java" });
  });

  it("resolves explicit imports through package declarations", () => {
    const analysis = analyzeFixture({
      [`${main}/App.java`]: "package com.acme.shop;\n\nimport com.acme.shop.cart.Cart;\nimport java.util.List;\n\npublic class App {}\n",
      [`${main}/cart/Cart.java`]: "package com.acme.shop.cart;\nimport com.acme.shop.money.Price;\npublic final class Cart {}\n",
      [`${main}/money/Price.java`]: "package com.acme.shop.money;\npublic record Price(long cents) {}\n",
    });

    assert.deepEqual(edges(analysis), [`${main}/App.java -> ${main}/cart/Cart.java`, `${main}/cart/Cart.java -> ${main}/money/Price.java`]);
  });

  it("resolves static imports and nested types to the declaring file", () => {
    const analysis = analyzeFixture({
      "a/Util.java": "package a;\npublic class Util { public static class Inner {} public static int max(int x) { return x; } }\n",
      "b/Use.java": "package b;\nimport static a.Util.max;\nimport a.Util.Inner;\nimport static a.Util.*;\n",
    });

    assert.deepEqual(edges(analysis), ["b/Use.java -> a/Util.java"]);
  });

  it("resolves types used from the same package without an import", () => {
    const analysis = analyzeFixture({
      "shop/Order.java": "package shop;\npublic class Order { private Customer customer; List<LineItem> items; }\n",
      "shop/Customer.java": "package shop;\npublic class Customer {}\n",
      "shop/LineItem.java": "package shop;\nclass LineItem {}\n",
      "other/Customer.java": "package other;\npublic class Customer {}\n",
    });

    assert.deepEqual(edgesFrom(analysis, "shop/Order.java"), ["shop/Order.java -> shop/Customer.java", "shop/Order.java -> shop/LineItem.java"]);
  });

  it("never connects a wildcard import to every file of the package", () => {
    const analysis = analyzeFixture({
      "model/User.java": "package model;\npublic class User {}\n",
      "model/Role.java": "package model;\npublic class Role {}\n",
      "model/Audit.java": "package model;\npublic class Audit {}\n",
      "app/Main.java": "package app;\nimport model.*;\nclass Main { User user; }\n",
    });

    assert.deepEqual(edgesFrom(analysis, "app/Main.java"), ["app/Main.java -> model/User.java"]);
  });

  it("skips a name found in two wildcard-imported packages", () => {
    const analysis = analyzeFixture({
      "a/Node.java": "package a;\npublic class Node {}\n",
      "b/Node.java": "package b;\npublic class Node {}\n",
      "app/Main.java": "package app;\nimport a.*;\nimport b.*;\nclass Main { Node n; }\n",
    });

    assert.deepEqual(edgesFrom(analysis, "app/Main.java"), []);
  });

  it("ignores the JDK and libraries, and reports a missing type in a known package", () => {
    const analysis = analyzeFixture({
      "shop/A.java": "package shop;\nimport java.util.Map;\nimport org.junit.jupiter.api.Test;\nimport shop.Missing;\nclass A { String s; Map<String, Integer> m; }\n",
      "shop/B.java": "package shop;\nclass B {}\n",
    });

    assert.deepEqual(edges(analysis), []);
    assert.deepEqual(unresolvedOf(analysis), ["shop/A.java: shop.Missing (not_found)"]);
  });

  it("does not treat locally declared types, comments or strings as references", () => {
    const analysis = analyzeFixture({
      "p/Outer.java": 'package p;\n// Helper h;\nclass Outer { class Helper {} Helper h; String s = "Helper"; }\n',
      "p/Helper.java": "package p;\nclass Helper {}\n",
    });

    assert.deepEqual(edges(analysis), []);
  });

  it("keeps going after malformed code", () => {
    const analysis = analyzeFixture({ "p/Bad.java": "package p;\nclass Bad { Good g; \"unterminated\n", "p/Good.java": "package p; class Good {}" });

    assert.deepEqual(edges(analysis), ["p/Bad.java -> p/Good.java"]);
  });
});
