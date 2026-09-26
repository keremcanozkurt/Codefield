import assert from "node:assert/strict";
import { describe, it } from "node:test";

import type { TreeEntry } from "./github/types.ts";
import {
  MAX_SOURCE_FILE_BYTES,
  MAX_SOURCE_FILES,
  selectSourceFiles,
} from "./source-files.ts";

function blob(path: string, size = 100): TreeEntry {
  return { path, type: "blob", sha: `sha:${path}`, size };
}

function selectedPaths(entries: TreeEntry[]) {
  return selectSourceFiles(entries).candidates.map((candidate) => candidate.path);
}

describe("selectSourceFiles", () => {
  it("accepts .ts, .tsx, .js and .jsx files with their language", () => {
    const { candidates } = selectSourceFiles([
      blob("src/a.ts", 10),
      blob("src/b.tsx", 20),
      blob("src/c.js", 30),
      blob("src/d.jsx", 40),
    ]);

    assert.deepEqual(candidates, [
      { path: "src/a.ts", sha: "sha:src/a.ts", size: 10, extension: ".ts", language: "typescript" },
      { path: "src/b.tsx", sha: "sha:src/b.tsx", size: 20, extension: ".tsx", language: "typescript" },
      { path: "src/c.js", sha: "sha:src/c.js", size: 30, extension: ".js", language: "javascript" },
      { path: "src/d.jsx", sha: "sha:src/d.jsx", size: 40, extension: ".jsx", language: "javascript" },
    ]);
  });

  it("rejects unsupported extensions", () => {
    assert.deepEqual(
      selectedPaths([
        blob("README.md"),
        blob("package.json"),
        blob("package-lock.json"),
        blob("pnpm-lock.yaml"),
        blob("yarn.lock"),
        blob("src/index.js.map"),
        blob("src/styles.css"),
        blob("src/server.mjs"),
        blob("src/worker.cts"),
        blob("src/Upper.TS"),
        blob("Makefile"),
        blob(".js"),
      ]),
      [],
    );
  });

  it("rejects tree entries", () => {
    assert.deepEqual(
      selectedPaths([{ path: "src/components.tsx", type: "tree", sha: "t1" }]),
      [],
    );
  });

  it("ignores node_modules at any depth", () => {
    assert.deepEqual(
      selectedPaths([
        blob("node_modules/react/index.js"),
        blob("packages/app/node_modules/lodash/lodash.js"),
        blob("src/index.ts"),
      ]),
      ["src/index.ts"],
    );
  });

  it("ignores .next output", () => {
    assert.deepEqual(
      selectedPaths([blob(".next/server/app/page.js"), blob("app/page.tsx")]),
      ["app/page.tsx"],
    );
  });

  it("ignores dist, build, out, coverage and vendor directories", () => {
    assert.deepEqual(
      selectedPaths([
        blob("dist/index.js"),
        blob("packages/core/dist/index.js"),
        blob("build/main.js"),
        blob("out/app.js"),
        blob("coverage/lcov-report/prettify.js"),
        blob("vendor/jquery.js"),
        blob("src/build.ts"),
        blob("src/distance.ts"),
        blob("scripts/output.js"),
      ]),
      ["scripts/output.js", "src/build.ts", "src/distance.ts"],
    );
  });

  it("ignores minified and bundled files", () => {
    assert.deepEqual(
      selectedPaths([
        blob("public/jquery.min.js"),
        blob("src/widget.min.jsx"),
        blob("static/app.bundle.js"),
        blob("src/minify.js"),
      ]),
      ["src/minify.js"],
    );
  });

  it("ignores declaration files", () => {
    assert.deepEqual(
      selectedPaths([
        blob("src/env.d.ts"),
        blob("types/global.d.ts"),
        blob("next-env.d.ts"),
        blob("src/d.ts"),
      ]),
      ["src/d.ts"],
    );
  });

  it("accepts config files written in supported languages", () => {
    assert.deepEqual(
      selectedPaths([
        blob("next.config.ts"),
        blob("vite.config.ts"),
        blob("eslint.config.js"),
        blob("tailwind.config.js"),
      ]),
      ["eslint.config.js", "next.config.ts", "tailwind.config.js", "vite.config.ts"],
    );
  });

  it("skips files over the size limit and records the reason", () => {
    const selection = selectSourceFiles([
      blob("src/generated.ts", MAX_SOURCE_FILE_BYTES + 1),
      blob("src/limit.ts", MAX_SOURCE_FILE_BYTES),
      blob("src/small.ts", 1),
    ]);

    assert.deepEqual(
      selection.candidates.map((candidate) => candidate.path),
      ["src/limit.ts", "src/small.ts"],
    );
    assert.deepEqual(selection.skipped, [{ path: "src/generated.ts", reason: "too_large" }]);
    assert.equal(selection.eligibleCount, 3);
    assert.equal(selection.limited, false);
  });

  it("takes the first files by path when over the file limit", () => {
    const count = MAX_SOURCE_FILES + 25;
    const entries = Array.from({ length: count }, (_, i) =>
      blob(`src/file-${String(i).padStart(4, "0")}.ts`),
    ).reverse();

    const selection = selectSourceFiles(entries);

    assert.equal(selection.candidates.length, MAX_SOURCE_FILES);
    assert.equal(selection.eligibleCount, count);
    assert.equal(selection.limited, true);
    assert.equal(selection.candidates[0].path, "src/file-0000.ts");
    assert.equal(selection.candidates.at(-1)?.path, `src/file-${String(MAX_SOURCE_FILES - 1).padStart(4, "0")}.ts`);
    assert.deepEqual(selection.skipped, []);
  });

  it("returns the same selection regardless of tree order", () => {
    const entries = [
      blob("src/utils/b.ts"),
      blob("src/a.ts"),
      blob("lib/Z.js"),
      blob("lib/a.js"),
      blob("src/utils.ts"),
      blob("src/utils/a.ts"),
    ];
    const expected = [
      "lib/Z.js",
      "lib/a.js",
      "src/a.ts",
      "src/utils.ts",
      "src/utils/a.ts",
      "src/utils/b.ts",
    ];

    assert.deepEqual(selectedPaths(entries), expected);
    assert.deepEqual(selectedPaths([...entries].reverse()), expected);
  });

  it("does not report a limit when exactly at the file limit", () => {
    const entries = Array.from({ length: MAX_SOURCE_FILES }, (_, i) => blob(`src/f${i}.js`));
    const selection = selectSourceFiles(entries);

    assert.equal(selection.candidates.length, MAX_SOURCE_FILES);
    assert.equal(selection.limited, false);
  });
});

describe("selectSourceFiles across languages", () => {
  it("selects every supported language with its language ID, in path order", () => {
    const selection = selectSourceFiles(
      ["z.swift", "a/main.go", "lib/app.rb", "src/lib.rs", "App.java", "Main.kt", "Program.cs", "m.c", "n.hpp", "i.php", "x.dart", "e.ex", "s.scala", "l.lua", "p.py"].map((path) => blob(path)),
    );

    assert.deepEqual(
      selection.candidates.map((c) => `${c.path}:${c.language}`),
      ["App.java:java", "Main.kt:kotlin", "Program.cs:csharp", "a/main.go:go", "e.ex:elixir", "i.php:php", "l.lua:lua", "lib/app.rb:ruby", "m.c:c", "n.hpp:cpp", "p.py:python", "s.scala:scala", "src/lib.rs:rust", "x.dart:dart", "z.swift:swift"],
    );
  });

  it("ignores dependency and build directories of other ecosystems", () => {
    assert.deepEqual(
      selectedPaths([
        blob(".venv/lib/site.py"),
        blob("venv/x.py"),
        blob("pkg/__pycache__/m.py"),
        blob("pkg.egg-info/x.py"),
        blob("target/debug/build.rs"),
        blob(".gradle/x.kt"),
        blob("App/obj/Debug/Gen.cs"),
        blob(".dart_tool/x.dart"),
        blob("_build/dev/x.ex"),
        blob("deps/phoenix/lib/x.ex"),
        blob(".build/checkouts/x.swift"),
        blob("Pods/Lib/x.swift"),
        blob("vendor/bundle/ruby/x.rb"),
        blob("src/app.py"),
      ]),
      ["src/app.py"],
    );
  });

  it("keeps ordinary source directories whose names tools also use", () => {
    assert.deepEqual(selectedPaths([blob("src/bin/cli.rs"), blob("bin/setup.rb"), blob("lib/tasks/x.rb"), blob("app/targets.py")]), [
      "app/targets.py",
      "bin/setup.rb",
      "lib/tasks/x.rb",
      "src/bin/cli.rs",
    ]);
  });
});
