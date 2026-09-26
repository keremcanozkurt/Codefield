import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { extractModuleReferences, type EcmaScriptExtension } from "./imports.ts";

function references(content: string, extension: EcmaScriptExtension = ".ts") {
  return extractModuleReferences(`src/file${extension}`, content, extension);
}

describe("extractModuleReferences", () => {
  it("reads default, named, namespace and side-effect imports", () => {
    const content = [
      'import x from "./default";',
      'import { a, b as c } from "../named";',
      'import * as util from "./util";',
      'import "./setup";',
      'import def, { named } from "./mixed";',
    ].join("\n");

    assert.deepEqual(references(content), [
      { specifier: "./default", kind: "import" },
      { specifier: "../named", kind: "import" },
      { specifier: "./util", kind: "import" },
      { specifier: "./setup", kind: "import" },
      { specifier: "./mixed", kind: "import" },
    ]);
  });

  it("reads type-only imports as imports", () => {
    assert.deepEqual(references('import type { Props } from "./types";'), [
      { specifier: "./types", kind: "import" },
    ]);
  });

  it("reads re-exports", () => {
    const content = [
      'export { x } from "./x";',
      'export { default as y } from "./y";',
      'export * from "./all";',
      'export * as foo from "./foo";',
      'export type { T } from "./types";',
    ].join("\n");

    assert.deepEqual(references(content), [
      { specifier: "./x", kind: "reexport" },
      { specifier: "./y", kind: "reexport" },
      { specifier: "./all", kind: "reexport" },
      { specifier: "./foo", kind: "reexport" },
      { specifier: "./types", kind: "reexport" },
    ]);
  });

  it("ignores exports without a module specifier", () => {
    const content = "const a = 1;\nexport { a };\nexport default a;\nexport const b = 2;\n";
    assert.deepEqual(references(content), []);
  });

  it("reads dynamic imports with a literal argument", () => {
    const content = [
      "async function load() {",
      '  const feature = await import("./feature");',
      "  const other = await import(`./other`);",
      '  return import("./lazy", { with: { type: "module" } });',
      "}",
    ].join("\n");

    assert.deepEqual(references(content), [
      { specifier: "./feature", kind: "dynamic_import" },
      { specifier: "./other", kind: "dynamic_import" },
      { specifier: "./lazy", kind: "dynamic_import" },
    ]);
  });

  it("ignores dynamic imports that are not static", () => {
    const content = [
      "const name = './a';",
      "import(name);",
      "import('./pages/' + page);",
      "import(`./locales/${locale}`);",
      "import();",
    ].join("\n");

    assert.deepEqual(references(content), []);
  });

  it("reads require calls with a literal argument", () => {
    const content = [
      'const x = require("./x");',
      "require('../setup');",
      "const { a } = require(`./a`);",
      "function lazy() { return require('./lazy'); }",
    ].join("\n");

    assert.deepEqual(references(content, ".js"), [
      { specifier: "./x", kind: "require" },
      { specifier: "../setup", kind: "require" },
      { specifier: "./a", kind: "require" },
      { specifier: "./lazy", kind: "require" },
    ]);
  });

  it("reads TypeScript import-equals require", () => {
    assert.deepEqual(references('import fs = require("./fs");'), [
      { specifier: "./fs", kind: "require" },
    ]);
  });

  it("ignores require calls that are not static", () => {
    const content = [
      "const path = './x';",
      "require(path);",
      "require('./a' + suffix);",
      "require(`./${name}`);",
      "require();",
      "require.resolve('./resolved');",
      "module.require('./member');",
      "other('./other');",
    ].join("\n");

    assert.deepEqual(references(content, ".js"), []);
  });

  it("ignores import-like text in comments", () => {
    const content = [
      '// import x from "./line-comment";',
      '/* import y from "./block-comment"; require("./block-require"); */',
      "/**",
      ' * @example import("./jsdoc")',
      " */",
      'import real from "./real";',
    ].join("\n");

    assert.deepEqual(references(content), [{ specifier: "./real", kind: "import" }]);
  });

  it("ignores import-like text in strings and templates", () => {
    const content = [
      "const a = 'import x from \"./in-string\"';",
      'const b = "require(\'./in-string-require\')";',
      "const c = `import(\"./in-template\")`;",
      "const d = `export * from './in-template-reexport'`;",
    ].join("\n");

    assert.deepEqual(references(content), []);
  });

  it("ignores empty specifiers", () => {
    assert.deepEqual(references('import x from "";\nrequire("");'), []);
  });

  it("parses JSX in .jsx, .tsx and .js files", () => {
    const jsx = 'import Button from "./Button";\nexport const App = () => <Button label="import(\'./fake\')" />;\n';
    for (const extension of [".jsx", ".tsx", ".js"] as const) {
      assert.deepEqual(references(jsx, extension), [{ specifier: "./Button", kind: "import" }]);
    }
  });

  it("parses TypeScript generics in .ts files that would be JSX in .tsx", () => {
    const content = 'import { id } from "./id";\nconst f = <T,>(value: T) => id<T>(value);\nconst g = <T>value;\n';
    assert.deepEqual(references(content, ".ts"), [{ specifier: "./id", kind: "import" }]);
  });

  it("recovers what it can from malformed source", () => {
    const content = [
      'import a from "./a";',
      "const = ;",
      "let x = {;",
      'import b from "./b";',
      'const c = require("./c"',
    ].join("\n");

    assert.deepEqual(
      references(content).map((reference) => reference.specifier),
      ["./a", "./b", "./c"],
    );
  });

  it("does not throw on text that is not JavaScript", () => {
    for (const content of ["<html><body>", "\u0000\u0001binary", "}}}{{{", "import from from from"]) {
      assert.ok(Array.isArray(references(content)));
    }
  });

  it("returns references in source order", () => {
    const content = [
      'const a = require("./first");',
      'import b from "./second";',
      'export * from "./third";',
      'async function f() { await import("./fourth"); }',
    ].join("\n");

    assert.deepEqual(
      references(content).map((reference) => reference.specifier),
      ["./first", "./second", "./third", "./fourth"],
    );
  });
});
