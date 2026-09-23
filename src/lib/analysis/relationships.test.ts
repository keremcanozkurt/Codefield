import assert from "node:assert/strict";
import { describe, it } from "node:test";

import type { SourceExtension } from "../source-files.ts";
import { analyzeModuleRelationships, type AnalysisOptions } from "./relationships.ts";

function sources(files: Record<string, string>) {
  return Object.entries(files).map(([path, content]) => ({
    path,
    content,
    extension: path.slice(path.lastIndexOf(".")) as SourceExtension,
  }));
}

function analyze(files: Record<string, string>, options?: AnalysisOptions) {
  return analyzeModuleRelationships(sources(files), options);
}

function edges(files: Record<string, string>, options?: AnalysisOptions) {
  return analyze(files, options).relationships.map(
    ({ sourcePath, targetPath, kind }) => `${sourcePath} -> ${targetPath} (${kind})`,
  );
}

const nextConfig = {
  path: "tsconfig.json",
  content: JSON.stringify({ compilerOptions: { paths: { "@/*": ["./src/*"] } } }),
};

describe("analyzeModuleRelationships", () => {
  it("builds relationships for a small repository", () => {
    const result = analyze({
      "src/app.ts": [
        'import { util } from "./lib";',
        'import React from "react";',
        'const feature = () => import("./feature");',
        "export const app = () => util(feature);",
      ].join("\n"),
      "src/lib/index.ts": 'export * from "./util";\n',
      "src/lib/util.ts": "export const util = (x: unknown) => x;\n",
      "src/feature.ts": "export default 1;\n",
    });

    assert.deepEqual(result, {
      relationships: [
        { sourcePath: "src/app.ts", targetPath: "src/feature.ts", kind: "dynamic_import", specifier: "./feature" },
        { sourcePath: "src/app.ts", targetPath: "src/lib/index.ts", kind: "import", specifier: "./lib" },
        { sourcePath: "src/lib/index.ts", targetPath: "src/lib/util.ts", kind: "reexport", specifier: "./util" },
      ],
      unresolved: [],
      skipped: [],
      configs: [],
      stats: { filesAnalyzed: 4, filesSkipped: 0, relationships: 3, unresolvedReferences: 0 },
    });
  });

  it("keeps only the expected relationship fields", () => {
    const { relationships } = analyze({ "a.ts": 'import "./b";', "b.ts": "" });
    assert.deepEqual(Object.keys(relationships[0]).sort(), ["kind", "sourcePath", "specifier", "targetPath"]);
  });

  describe("normalization", () => {
    it("removes identical duplicate relationships", () => {
      const result = analyze({
        "a.ts": 'import { x } from "./b";\nimport { y } from "./b";\nimport type { Z } from "./b";\n',
        "b.ts": "export const x = 1, y = 2; export type Z = 3;\n",
      });

      assert.deepEqual(result.relationships, [
        { sourcePath: "a.ts", targetPath: "b.ts", kind: "import", specifier: "./b" },
      ]);
    });

    it("keeps relationships that differ in kind or specifier", () => {
      const result = analyze({
        "src/a.ts": [
          'import { x } from "./b";',
          'import { y } from "./b.ts";',
          'export { z } from "./b";',
          'const lazy = import("./b");',
          'const cjs = require("./b");',
        ].join("\n"),
        "src/b.ts": "export const x = 1, y = 2, z = 3;\n",
      });

      assert.deepEqual(
        result.relationships.map(({ kind, specifier }) => `${kind} ${specifier}`),
        ["dynamic_import ./b", "import ./b", "import ./b.ts", "reexport ./b", "require ./b"],
      );
    });

    it("ignores references a file makes to itself", () => {
      const result = analyze({
        "src/a.ts": 'import "./a";\nexport * from "./a.ts";\nconst self = require(".");\n',
        "src/index.ts": 'import "./index";\nimport "./a";\n',
      });

      assert.deepEqual(result.relationships, [
        { sourcePath: "src/a.ts", targetPath: "src/index.ts", kind: "require", specifier: "." },
        { sourcePath: "src/index.ts", targetPath: "src/a.ts", kind: "import", specifier: "./a" },
      ]);
      assert.deepEqual(result.unresolved, []);
    });

    it("orders output the same way regardless of input order", () => {
      const files = {
        "src/z.ts": 'import "./a";\nimport "./m";\nimport "./missing-z";\n',
        "src/a.ts": 'import "./z";\nimport "./missing-a";\n',
        "src/m.ts": 'import "./a";\n',
        "src/B.ts": 'import "./a";\n',
      };
      const forward = analyzeModuleRelationships(sources(files));
      const reversed = analyzeModuleRelationships(sources(files).reverse());

      assert.deepEqual(forward, reversed);
      assert.deepEqual(
        forward.relationships.map(({ sourcePath, targetPath }) => `${sourcePath} ${targetPath}`),
        ["src/B.ts src/a.ts", "src/a.ts src/z.ts", "src/m.ts src/a.ts", "src/z.ts src/a.ts", "src/z.ts src/m.ts"],
      );
      assert.deepEqual(
        forward.unresolved.map(({ sourcePath }) => sourcePath),
        ["src/a.ts", "src/z.ts"],
      );
    });

    it("uses repository-relative POSIX paths", () => {
      const result = analyze(
        {
          "src/deep/nested/file.ts": 'import "../../lib/./util";\nimport "@/lib/util";\n',
          "src/lib/util.ts": "",
        },
        { configFiles: [nextConfig] },
      );

      for (const { sourcePath, targetPath } of result.relationships) {
        for (const path of [sourcePath, targetPath]) {
          assert.equal(path.includes("\\"), false);
          assert.equal(path.startsWith("/") || path.startsWith("./"), false);
          assert.equal(path.split("/").includes(".."), false);
        }
      }
      assert.deepEqual(result.relationships.map((r) => r.targetPath), ["src/lib/util.ts", "src/lib/util.ts"]);
    });
  });

  describe("unresolved references", () => {
    it("records local references and skips packages", () => {
      const result = analyze(
        {
          "src/app.tsx": [
            'import React from "react";',
            'import { clsx } from "@scope/clsx";',
            'import "./globals.css";',
            'import { gone } from "./gone";',
            'import { up } from "../../up";',
            'import { alias } from "~/alias";',
            'import { gone as again } from "./gone";',
          ].join("\n"),
        },
        { repositoryPaths: ["src/app.tsx", "src/globals.css"] },
      );

      assert.deepEqual(result.unresolved, [
        { sourcePath: "src/app.tsx", specifier: "../../up", kind: "import", reason: "outside_repository" },
        { sourcePath: "src/app.tsx", specifier: "./globals.css", kind: "import", reason: "not_source" },
        { sourcePath: "src/app.tsx", specifier: "./gone", kind: "import", reason: "not_found" },
        { sourcePath: "src/app.tsx", specifier: "~/alias", kind: "import", reason: "unsupported_alias" },
      ]);
      assert.equal(result.stats.unresolvedReferences, 4);
      assert.deepEqual(result.relationships, []);
    });
  });

  describe("parse failures", () => {
    it("keeps analyzing other files when one is malformed", () => {
      const result = analyze({
        "src/broken.ts": 'import a from "./a";\nexport function (((( {\n  <<<>>> ;;\n',
        "src/ok.ts": 'import a from "./a";\n',
        "src/a.ts": "export default 1;\n",
      });

      assert.deepEqual(
        result.relationships.map((r) => r.sourcePath),
        ["src/broken.ts", "src/ok.ts"],
      );
      assert.equal(result.stats.filesSkipped, 0);
    });

    it("skips a file the parser cannot handle and keeps the rest", () => {
      const nested = `const x = ${"(".repeat(20_000)}1${")".repeat(20_000)};\nimport "./a";\n`;
      const result = analyze({
        "src/nested.ts": nested,
        "src/ok.ts": 'import "./a";\n',
        "src/a.ts": "",
      });

      assert.deepEqual(result.skipped, [{ path: "src/nested.ts", reason: "parse_failed" }]);
      assert.deepEqual(result.relationships.map((r) => r.sourcePath), ["src/ok.ts"]);
      assert.deepEqual(result.stats, {
        filesAnalyzed: 2,
        filesSkipped: 1,
        relationships: 1,
        unresolvedReferences: 0,
      });
    });
  });

  describe("realistic layouts", () => {
    it("follows a barrel file to its modules", () => {
      assert.deepEqual(
        edges({
          "src/components/index.ts": [
            'export { Button } from "./Button";',
            'export * from "./Card";',
            'export { default as Modal } from "./Modal";',
          ].join("\n"),
          "src/components/Button.tsx": "export const Button = () => null;\n",
          "src/components/Card/index.tsx": "export const Card = () => null;\n",
          "src/components/Modal.jsx": "export default function Modal() { return null; }\n",
          "src/page.tsx": 'import { Button, Card } from "./components";\n',
        }),
        [
          "src/components/index.ts -> src/components/Button.tsx (reexport)",
          "src/components/index.ts -> src/components/Card/index.tsx (reexport)",
          "src/components/index.ts -> src/components/Modal.jsx (reexport)",
          "src/page.tsx -> src/components/index.ts (import)",
        ],
      );
    });

    it("resolves a Next.js @/ alias from tsconfig.json", () => {
      const result = analyze(
        {
          "src/app/page.tsx": [
            'import Link from "next/link";',
            'import { Button } from "@/components/ui/button";',
            'import { cn } from "@/lib/utils";',
            'import "./globals.css";',
          ].join("\n"),
          "src/components/ui/button.tsx": 'import { cn } from "@/lib/utils";\n',
          "src/lib/utils.ts": 'import { clsx } from "clsx";\n',
        },
        {
          configFiles: [nextConfig],
          repositoryPaths: ["src/app/globals.css", "tsconfig.json", "package.json"],
        },
      );

      assert.deepEqual(
        result.relationships.map(({ sourcePath, targetPath }) => `${sourcePath} -> ${targetPath}`),
        [
          "src/app/page.tsx -> src/components/ui/button.tsx",
          "src/app/page.tsx -> src/lib/utils.ts",
          "src/components/ui/button.tsx -> src/lib/utils.ts",
        ],
      );
      assert.deepEqual(result.unresolved.map((r) => r.reason), ["not_source"]);
      assert.deepEqual(result.configs, [{ path: "tsconfig.json", valid: true }]);
    });

    it("resolves sibling modules", () => {
      assert.deepEqual(
        edges({
          "lib/parse.js": 'const { tokenize } = require("./tokenize");\n',
          "lib/tokenize.js": "module.exports = { tokenize() {} };\n",
        }),
        ["lib/parse.js -> lib/tokenize.js (require)"],
      );
    });

    it("resolves between JavaScript and TypeScript files", () => {
      assert.deepEqual(
        edges({
          "src/index.ts": 'import legacy from "./legacy";\nimport { view } from "./view.js";\n',
          "src/legacy.js": 'module.exports = require("./helpers");\n',
          "src/helpers.ts": "export const helpers = {};\n",
          "src/view.tsx": 'import Old from "./Old";\nexport const view = <Old />;\n',
          "src/Old.jsx": "export default () => null;\n",
        }),
        [
          "src/index.ts -> src/legacy.js (import)",
          "src/index.ts -> src/view.tsx (import)",
          "src/legacy.js -> src/helpers.ts (require)",
          "src/view.tsx -> src/Old.jsx (import)",
        ],
      );
    });

    it("keeps local modules and drops packages from the same file", () => {
      const result = analyze({
        "src/server.ts": [
          'import express from "express";',
          'import { join } from "node:path";',
          'import { routes } from "./routes";',
          'import type { Config } from "@acme/config";',
          'const db = require("./db");',
          'const pg = require("pg");',
        ].join("\n"),
        "src/routes.ts": "export const routes = [];\n",
        "src/db.js": "module.exports = {};\n",
      });

      assert.deepEqual(
        result.relationships.map(({ targetPath, kind }) => `${targetPath} (${kind})`),
        ["src/db.js (require)", "src/routes.ts (import)"],
      );
      assert.deepEqual(result.unresolved, []);
    });
  });

  it("handles an empty file list", () => {
    assert.deepEqual(analyzeModuleRelationships([]), {
      relationships: [],
      unresolved: [],
      skipped: [],
      configs: [],
      stats: { filesAnalyzed: 0, filesSkipped: 0, relationships: 0, unresolvedReferences: 0 },
    });
  });
});
