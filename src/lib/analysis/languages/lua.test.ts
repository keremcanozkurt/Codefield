import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { analyzeFixture, edges, languagesOf, unresolvedOf } from "./testing.ts";

describe("Lua", () => {
  it("detects .lua files", () => {
    assert.deepEqual(languagesOf(["init.lua", "lua/plugin/core.lua"]), { "init.lua": "lua", "lua/plugin/core.lua": "lua" });
  });

  it("resolves dotted module names to files and init.lua", () => {
    const analysis = analyzeFixture({
      "main.lua": 'local game = require("game")\nlocal util = require "game.util"\n',
      "game/init.lua": "local state = require('game.state')\n",
      "game/util.lua": "",
      "game/state.lua": "",
    });

    assert.deepEqual(edges(analysis), [
      "game/init.lua -> game/state.lua",
      "main.lua -> game/init.lua",
      "main.lua -> game/util.lua",
    ]);
  });

  it("uses lua/ as a module root, as Neovim plugins do", () => {
    const analysis = analyzeFixture({
      "plugin/setup.lua": "require('myplugin.config')\n",
      "lua/myplugin/config.lua": "",
    });

    assert.deepEqual(edges(analysis), ["plugin/setup.lua -> lua/myplugin/config.lua"]);
  });

  it("ignores modules outside the repository", () => {
    const analysis = analyzeFixture({ "main.lua": "local json = require('cjson')\nlocal lpeg = require 'lpeg'\n" });

    assert.deepEqual(edges(analysis), []);
    assert.deepEqual(unresolvedOf(analysis), []);
  });

  it("reports a missing module in a local package", () => {
    const analysis = analyzeFixture({ "main.lua": "require('game.missing')\n", "game/init.lua": "" });

    assert.deepEqual(unresolvedOf(analysis), ["main.lua: game.missing (not_found)"]);
  });

  it("skips a module found under two roots", () => {
    const analysis = analyzeFixture({ "util.lua": "", "src/util.lua": "", "main.lua": "require('util')" });

    assert.deepEqual(unresolvedOf(analysis), ["main.lua: util (ambiguous)"]);
  });

  it("ignores computed names and requires in comments and strings", () => {
    const analysis = analyzeFixture({
      "main.lua": "-- require('b')\n--[[ require('b') ]]\nlocal s = [[require('b')]]\nrequire(name)\nrequire('pre' .. x)\nobj:require('b')\n",
      "b.lua": "",
      "pre.lua": "",
    });

    assert.deepEqual(edges(analysis), []);
  });

  it("keeps going after malformed code", () => {
    const analysis = analyzeFixture({ "bad.lua": "function (\n'unterminated\nrequire('b')", "b.lua": "" });

    assert.deepEqual(edges(analysis), ["bad.lua -> b.lua"]);
  });
});
