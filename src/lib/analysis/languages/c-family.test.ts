import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { analyzeFixture, edges, languagesOf, unresolvedOf } from "./testing.ts";

describe("C and C++", () => {
  it("detects C and C++ files, treating .h as C", () => {
    assert.deepEqual(
      languagesOf(["a.c", "a.h", "b.cc", "b.cpp", "b.cxx", "b.hh", "b.hpp", "b.hxx", "build/gen.c", "notes.txt"]),
      { "a.c": "c", "a.h": "c", "b.cc": "cpp", "b.cpp": "cpp", "b.cxx": "cpp", "b.hh": "cpp", "b.hpp": "cpp", "b.hxx": "cpp" },
    );
  });

  it("resolves quoted includes next to the file and through several hops", () => {
    const analysis = analyzeFixture({
      "src/main.c": '#include "app.h"\n#include "../include/lib/core.h"\n',
      "src/app.h": '#include "util.h"\n',
      "src/util.h": "",
      "include/lib/core.h": "",
    });

    assert.deepEqual(edges(analysis), [
      "src/app.h -> src/util.h",
      "src/main.c -> include/lib/core.h",
      "src/main.c -> src/app.h",
    ]);
  });

  it("finds headers in include directories, for quotes and angle brackets", () => {
    const analysis = analyzeFixture({
      "include/mylib/api.hpp": "",
      "src/api.cpp": "#include <mylib/api.hpp>\n#include \"mylib/api.hpp\"\n",
    });

    assert.deepEqual(edges(analysis), ["src/api.cpp -> include/mylib/api.hpp"]);
  });

  it("links C++ sources to C headers", () => {
    const analysis = analyzeFixture({ "legacy.h": "", "modern.cpp": '#include "legacy.h"\n' });

    assert.deepEqual(edges(analysis), ["modern.cpp -> legacy.h"]);
  });

  it("ignores system headers", () => {
    const analysis = analyzeFixture({ "main.cpp": "#include <stdio.h>\n#include <vector>\n#include <sys/types.h>\n" });

    assert.deepEqual(edges(analysis), []);
    assert.deepEqual(unresolvedOf(analysis), []);
  });

  it("reports a missing quoted header and a non-source include", () => {
    const analysis = analyzeFixture(
      { "main.c": '#include "config.h"\n#include "table.inc"\n' },
      { otherFiles: ["table.inc"] },
    );

    assert.deepEqual(unresolvedOf(analysis), ["main.c: config.h (not_found)", "main.c: table.inc (not_source)"]);
  });

  it("skips a header name that matches several files", () => {
    const analysis = analyzeFixture({
      "a/util.h": "",
      "b/util.h": "",
      "main.c": '#include "util.h"\n',
    });

    assert.deepEqual(edges(analysis), []);
    assert.deepEqual(unresolvedOf(analysis), ["main.c: util.h (ambiguous)"]);
  });

  it("only reads #include at the start of a line, outside comments and strings", () => {
    const analysis = analyzeFixture({
      "a.h": "",
      "main.cpp": [
        "// #include \"a.h\"",
        "/* #include \"a.h\" */",
        'const char* s = "#include \\"a.h\\"";',
        'auto r = R"(',
        '#include "a.h"',
        ')";',
        "int x; #include \"a.h\"",
        "#define HEADER \"a.h\"",
        "#include HEADER",
      ].join("\n"),
    });

    assert.deepEqual(edges(analysis), []);
  });

  it("accepts spacing and comments around the directive", () => {
    const analysis = analyzeFixture({ "a.h": "", "b.c": '  #  include /* x */ "a.h"\n' });

    assert.deepEqual(edges(analysis), ["b.c -> a.h"]);
  });

  it("keeps going after malformed code", () => {
    const analysis = analyzeFixture({ "bad.c": '"unterminated\n#include "a.h"\n{{{', "a.h": "" });

    assert.deepEqual(edges(analysis), ["bad.c -> a.h"]);
  });
});
