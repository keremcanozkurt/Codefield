import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { candidatePaths, createModuleResolver } from "./resolve.ts";

function resolver(sourcePaths: string[], repositoryPaths?: string[]) {
  return createModuleResolver({
    sourcePaths: new Set(sourcePaths),
    repositoryPaths: repositoryPaths && new Set([...sourcePaths, ...repositoryPaths]),
  });
}

function resolved(path: string) {
  return { status: "resolved", path };
}

function unresolved(reason: string) {
  return { status: "unresolved", reason };
}

describe("candidatePaths", () => {
  it("tries the exact path, then extensions, then index files", () => {
    assert.deepEqual(candidatePaths("src/foo"), [
      "src/foo",
      "src/foo.ts",
      "src/foo.tsx",
      "src/foo.js",
      "src/foo.jsx",
      "src/foo/index.ts",
      "src/foo/index.tsx",
      "src/foo/index.js",
      "src/foo/index.jsx",
    ]);
  });

  it("tries TypeScript files for .js and .jsx specifiers after the exact path", () => {
    assert.deepEqual(candidatePaths("src/foo.js").slice(0, 3), [
      "src/foo.js",
      "src/foo.ts",
      "src/foo.tsx",
    ]);
    assert.deepEqual(candidatePaths("src/foo.jsx").slice(0, 2), ["src/foo.jsx", "src/foo.tsx"]);
  });

  it("only tries index files for directory specifiers", () => {
    assert.deepEqual(candidatePaths("src", true), [
      "src/index.ts",
      "src/index.tsx",
      "src/index.js",
      "src/index.jsx",
    ]);
    assert.deepEqual(candidatePaths("", true), ["index.ts", "index.tsx", "index.js", "index.jsx"]);
  });
});

describe("createModuleResolver", () => {
  describe("explicit extensions", () => {
    const resolve = resolver(["src/a.ts", "src/b.tsx", "src/c.js", "src/d.jsx", "src/e/index.tsx"]);

    for (const [specifier, target] of [
      ["./a.ts", "src/a.ts"],
      ["./b.tsx", "src/b.tsx"],
      ["./c.js", "src/c.js"],
      ["./d.jsx", "src/d.jsx"],
      ["./e/index.tsx", "src/e/index.tsx"],
    ]) {
      it(`resolves ${specifier}`, () => {
        assert.deepEqual(resolve("src/app.ts", specifier), resolved(target));
      });
    }

    it("does not rewrite other extensions", () => {
      assert.deepEqual(resolve("src/app.ts", "./a.tsx"), unresolved("not_found"));
      assert.deepEqual(resolve("src/app.ts", "./c.ts"), unresolved("not_found"));
      assert.deepEqual(resolve("src/app.ts", "./a.mjs"), unresolved("not_found"));
    });
  });

  describe("extensionless specifiers", () => {
    for (const extension of [".ts", ".tsx", ".js", ".jsx"]) {
      it(`resolves to ${extension}`, () => {
        const resolve = resolver([`src/foo${extension}`]);
        assert.deepEqual(resolve("src/app.ts", "./foo"), resolved(`src/foo${extension}`));
      });

      it(`resolves a directory to index${extension}`, () => {
        const resolve = resolver([`src/utils/index${extension}`]);
        assert.deepEqual(resolve("src/app.ts", "./utils"), resolved(`src/utils/index${extension}`));
      });
    }

    it("prefers .ts over .tsx, .js and .jsx", () => {
      const resolve = resolver(["src/foo.jsx", "src/foo.js", "src/foo.tsx", "src/foo.ts"]);
      assert.deepEqual(resolve("src/app.ts", "./foo"), resolved("src/foo.ts"));
    });

    it("prefers a file over a directory index", () => {
      const resolve = resolver(["src/utils.js", "src/utils/index.ts"]);
      assert.deepEqual(resolve("src/app.ts", "./utils"), resolved("src/utils.js"));
    });

    it("keeps dots in file names", () => {
      const resolve = resolver(["src/app.config.ts", "src/button.test.tsx"]);
      assert.deepEqual(resolve("src/app.ts", "./app.config"), resolved("src/app.config.ts"));
      assert.deepEqual(resolve("src/app.ts", "./button.test"), resolved("src/button.test.tsx"));
    });
  });

  describe("TypeScript .js specifiers", () => {
    it("resolves ./x.js to x.ts when no x.js exists", () => {
      const resolve = resolver(["src/x.ts", "src/view.tsx"]);
      assert.deepEqual(resolve("src/app.ts", "./x.js"), resolved("src/x.ts"));
      assert.deepEqual(resolve("src/app.ts", "./view.js"), resolved("src/view.tsx"));
      assert.deepEqual(resolve("src/app.ts", "./view.jsx"), resolved("src/view.tsx"));
    });

    it("prefers an existing .js file", () => {
      const resolve = resolver(["src/x.ts", "src/x.js"]);
      assert.deepEqual(resolve("src/app.ts", "./x.js"), resolved("src/x.js"));
    });
  });

  describe("relative paths", () => {
    const resolve = resolver(["index.ts", "src/a.ts", "src/lib/b.ts", "lib/c.ts", "src/lib/index.ts"]);

    it("resolves ../ against the importing file's directory", () => {
      assert.deepEqual(resolve("src/lib/b.ts", "../a"), resolved("src/a.ts"));
      assert.deepEqual(resolve("src/lib/b.ts", "../../lib/c"), resolved("lib/c.ts"));
      assert.deepEqual(resolve("src/lib/b.ts", "./../lib/./b"), resolved("src/lib/b.ts"));
    });

    it("resolves ., .. and trailing slashes to index files", () => {
      assert.deepEqual(resolve("src/lib/b.ts", "."), resolved("src/lib/index.ts"));
      assert.deepEqual(resolve("src/lib/b.ts", "./"), resolved("src/lib/index.ts"));
      assert.deepEqual(resolve("src/a.ts", "./lib/"), resolved("src/lib/index.ts"));
      assert.deepEqual(resolve("src/a.ts", ".."), resolved("index.ts"));
      assert.deepEqual(resolve("src/lib/b.ts", "../.."), resolved("index.ts"));
    });

    it("does not resolve outside the repository root", () => {
      assert.deepEqual(resolve("src/a.ts", "../../outside"), unresolved("outside_repository"));
      assert.deepEqual(resolve("index.ts", "../index"), unresolved("outside_repository"));
      assert.deepEqual(resolve("src/lib/b.ts", "../../../src/a"), unresolved("outside_repository"));
    });

    it("treats a path that returns into the repository as inside it", () => {
      assert.deepEqual(resolve("src/lib/b.ts", "../../src/a"), resolved("src/a.ts"));
    });

    it("does not treat backslashes as separators", () => {
      assert.deepEqual(resolve("src/lib/b.ts", "..\\a"), { status: "external" });
      assert.deepEqual(resolve("src/lib/b.ts", ".\\b"), { status: "external" });
    });
  });

  describe("unresolved and external specifiers", () => {
    const resolve = resolver(["src/a.ts"], ["src/styles.css", "src/data.json", "src/types.d.ts", "src/big.js"]);

    it("records a relative specifier with no matching file", () => {
      assert.deepEqual(resolve("src/a.ts", "./missing"), unresolved("not_found"));
    });

    it("records references to repository files that are not analyzed", () => {
      assert.deepEqual(resolve("src/a.ts", "./styles.css"), unresolved("not_source"));
      assert.deepEqual(resolve("src/a.ts", "./data.json"), unresolved("not_source"));
      assert.deepEqual(resolve("src/a.ts", "./types"), unresolved("not_source"));
      assert.deepEqual(resolve("src/a.ts", "./big"), unresolved("not_source"));
    });

    it("reports not_found when the repository tree is not provided", () => {
      assert.deepEqual(resolver(["src/a.ts"])("src/a.ts", "./styles.css"), unresolved("not_found"));
    });

    it("ignores packages", () => {
      for (const specifier of ["react", "next/link", "lodash", "lodash/fp", "node:fs", "fs", "https://esm.sh/x"]) {
        assert.deepEqual(resolve("src/a.ts", specifier), { status: "external" }, specifier);
      }
    });

    it("ignores scoped packages", () => {
      for (const specifier of ["@scope/package", "@scope/package/sub/path", "@types/node"]) {
        assert.deepEqual(resolve("src/a.ts", specifier), { status: "external" }, specifier);
      }
    });

    it("does not resolve bare specifiers against the repository without a config", () => {
      assert.deepEqual(resolve("src/a.ts", "src/a"), { status: "external" });
    });

    it("records alias-looking specifiers that nothing maps", () => {
      for (const specifier of ["@/lib/x", "~/lib/x", "#internal", "/src/a"]) {
        assert.deepEqual(resolve("src/a.ts", specifier), unresolved("unsupported_alias"), specifier);
      }
    });
  });
});
