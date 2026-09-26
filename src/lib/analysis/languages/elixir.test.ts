import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { analyzeFixture, edges, edgesFrom, languagesOf, unresolvedOf } from "./testing.ts";

describe("Elixir", () => {
  it("detects .ex and .exs files outside _build and deps", () => {
    assert.deepEqual(languagesOf(["lib/a.ex", "test/a_test.exs", "_build/x.ex", "deps/y.ex"]), { "lib/a.ex": "elixir", "test/a_test.exs": "elixir" });
  });

  it("resolves alias, import, require and use to module files", () => {
    const analysis = analyzeFixture({
      "lib/shop/cart.ex": "defmodule Shop.Cart do\n  alias Shop.Pricing\n  import Shop.Helpers\n  require Shop.Log\n  use Shop.Schema\nend\n",
      "lib/shop/pricing.ex": "defmodule Shop.Pricing do\nend\n",
      "lib/shop/helpers.ex": "defmodule Shop.Helpers do\nend\n",
      "lib/shop/log.ex": "defmodule Shop.Log do\n  defmacro info(x), do: x\nend\n",
      "lib/shop/schema.ex": "defmodule Shop.Schema do\nend\n",
    });

    assert.deepEqual(edgesFrom(analysis, "lib/shop/cart.ex"), [
      "lib/shop/cart.ex -> lib/shop/helpers.ex",
      "lib/shop/cart.ex -> lib/shop/log.ex",
      "lib/shop/cart.ex -> lib/shop/pricing.ex",
      "lib/shop/cart.ex -> lib/shop/schema.ex",
    ]);
  });

  it("resolves module names in code through aliases, groups and as:", () => {
    const analysis = analyzeFixture({
      "lib/web.ex": "defmodule Web do\n  alias Shop.{Cart, Accounts.User}\n  alias Shop.Pricing, as: P\n  def run, do: {Cart.new(), %User{}, P.total(), Shop.Repo.all()}\nend\n",
      "lib/cart.ex": "defmodule Shop.Cart do\nend\n",
      "lib/user.ex": "defmodule Shop.Accounts.User do\n  defstruct [:name]\nend\n",
      "lib/pricing.ex": "defmodule Shop.Pricing do\nend\n",
      "lib/repo.ex": "defmodule Shop.Repo do\nend\n",
    });

    assert.deepEqual(edgesFrom(analysis, "lib/web.ex"), [
      "lib/web.ex -> lib/cart.ex",
      "lib/web.ex -> lib/pricing.ex",
      "lib/web.ex -> lib/repo.ex",
      "lib/web.ex -> lib/user.ex",
    ]);
  });

  it("names nested modules after their parent", () => {
    const analysis = analyzeFixture({
      "lib/outer.ex": "defmodule Outer do\n  defmodule Inner do\n  end\nend\n",
      "lib/use.ex": "defmodule Use do\n  def f, do: Outer.Inner.go()\nend\n",
    });

    assert.deepEqual(edges(analysis), ["lib/use.ex -> lib/outer.ex"]);
  });

  it("ignores standard library and dependency modules", () => {
    const analysis = analyzeFixture({ "lib/a.ex": "defmodule A do\n  use GenServer\n  alias Ecto.Changeset\n  def f, do: Enum.map([], &String.trim/1)\nend\n" });

    assert.deepEqual(edges(analysis), []);
    assert.deepEqual(unresolvedOf(analysis), []);
  });

  it("does not match a longer name to its prefix, or a module defined twice", () => {
    const analysis = analyzeFixture({
      "lib/a.ex": "defmodule Shop do\nend\n",
      "lib/b.ex": "defmodule Dup do\nend\n",
      "lib/c.ex": "defmodule Dup do\nend\n",
      "lib/d.ex": "defmodule D do\n  def f, do: {Shop.Generated.call(), Dup.x()}\nend\n",
    });

    assert.deepEqual(edgesFrom(analysis, "lib/d.ex"), []);
  });

  it("ignores modules in strings, sigils, heredocs and comments", () => {
    const analysis = analyzeFixture({
      "lib/a.ex": 'defmodule A do\n  # B.call()\n  @doc """\n  B.call()\n  """\n  def f, do: {"B", ~s(B.call), ~r/B/, ?"}\nend\n',
      "lib/b.ex": "defmodule B do\nend\n",
    });

    assert.deepEqual(edges(analysis), []);
  });

  it("keeps going after malformed code", () => {
    const analysis = analyzeFixture({ "lib/bad.ex": 'defmodule Bad do\n  alias Good\n  "unterminated', "lib/good.ex": "defmodule Good do end" });

    assert.deepEqual(edges(analysis), ["lib/bad.ex -> lib/good.ex"]);
  });
});
