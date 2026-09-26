import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { analyzeFixture, edges, languagesOf, unresolvedOf } from "./testing.ts";

describe("Ruby", () => {
  it("detects .rb files outside vendor/bundle", () => {
    assert.deepEqual(languagesOf(["lib/a.rb", "vendor/bundle/gems/x.rb", "Gemfile"]), { "lib/a.rb": "ruby" });
  });

  it("resolves require_relative and require from lib", () => {
    const analysis = analyzeFixture({
      "lib/shop.rb": "require_relative 'shop/cart'\nrequire 'shop/pricing'\n",
      "lib/shop/cart.rb": "require_relative('pricing')\n",
      "lib/shop/pricing.rb": "",
      "spec/cart_spec.rb": 'require "shop"\n',
    });

    assert.deepEqual(edges(analysis), [
      "lib/shop.rb -> lib/shop/cart.rb",
      "lib/shop.rb -> lib/shop/pricing.rb",
      "lib/shop/cart.rb -> lib/shop/pricing.rb",
      "spec/cart_spec.rb -> lib/shop.rb",
    ]);
  });

  it("follows autoload paths", () => {
    const analysis = analyzeFixture({ "lib/shop.rb": 'autoload :Cart, "shop/cart"\n', "lib/shop/cart.rb": "" });

    assert.deepEqual(edges(analysis), ["lib/shop.rb -> lib/shop/cart.rb"]);
  });

  it("ignores gems and the standard library", () => {
    const analysis = analyzeFixture({ "app.rb": "require 'json'\nrequire 'rails/all'\n" });

    assert.deepEqual(edges(analysis), []);
    assert.deepEqual(unresolvedOf(analysis), []);
  });

  it("reports a missing require_relative and an interpolated path", () => {
    const analysis = analyzeFixture({ "a.rb": "require_relative 'missing'\nrequire \"plugins/#{name}\"\n" });

    assert.deepEqual(unresolvedOf(analysis), ['a.rb: missing (not_found)', "a.rb: plugins/#{name} (unsupported_dynamic)"]);
  });

  it("skips a path found in two lib directories", () => {
    const analysis = analyzeFixture({
      "gems/a/lib/util.rb": "",
      "gems/b/lib/util.rb": "",
      "app.rb": "require 'util'\n",
    });

    assert.deepEqual(unresolvedOf(analysis), ["app.rb: util (ambiguous)"]);
  });

  it("ignores requires in comments, heredocs, regexes and %-literals", () => {
    const analysis = analyzeFixture({
      "lib/a.rb": [
        "# require 'b'",
        "=begin",
        "require 'b'",
        "=end",
        "text = <<~EOS",
        "  require 'b'",
        "EOS",
        "pattern = /require 'b'/",
        "words = %w[require b]",
        "quoted = %q(require 'b')",
        "x = 10 % 3",
        "require_relative 'c'",
      ].join("\n"),
      "lib/b.rb": "",
      "lib/c.rb": "",
    });

    assert.deepEqual(edges(analysis), ["lib/a.rb -> lib/c.rb"]);
  });

  it("does not treat a method call on an object as require", () => {
    const analysis = analyzeFixture({ "a.rb": "loader.require 'b'\n", "b.rb": "" });

    assert.deepEqual(edges(analysis), []);
  });

  it("keeps going after malformed code", () => {
    const analysis = analyzeFixture({ "bad.rb": "def (\n'unterminated\nrequire_relative 'ok'\n", "ok.rb": "", "c.rb": "require_relative 'ok'" });

    assert.deepEqual(edges(analysis).includes("c.rb -> ok.rb"), true);
  });
});
