import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  MAX_CONFIG_FILE_BYTES,
  readProjectConfigs,
  selectConfigFiles,
  type ConfigFile,
} from "./config.ts";
import type { FileEntry } from "../source-files.ts";
import { createModuleResolver } from "./resolve.ts";

function configs(files: Record<string, string>): ConfigFile[] {
  return Object.entries(files).map(([path, content]) => ({ path, content }));
}

function resolver(sourcePaths: string[], configFiles: Record<string, string>) {
  const project = readProjectConfigs(configs(configFiles));
  return createModuleResolver({ sourcePaths: new Set(sourcePaths), configFor: project.configFor });
}

function resolved(path: string) {
  return { status: "resolved", path };
}

function unresolved(reason: string) {
  return { status: "unresolved", reason };
}

const nextConfig = JSON.stringify({
  compilerOptions: { baseUrl: ".", paths: { "@/*": ["./src/*"] } },
});

describe("selectConfigFiles", () => {
  function blob(path: string, size = 100): FileEntry {
    return { path, size };
  }

  it("selects tsconfig and jsconfig files outside ignored directories", () => {
    const selected = selectConfigFiles([
      blob("tsconfig.json"),
      blob("apps/web/jsconfig.json"),
      blob("tsconfig.base.json"),
      blob("packages/ui/tsconfig.build.json"),
      blob("node_modules/pkg/tsconfig.json"),
      blob("dist/tsconfig.json"),
      blob("package.json"),
      blob("tsconfig.json.bak"),
      blob("my-tsconfig.json"),
    ]);

    assert.deepEqual(
      selected.map((candidate) => candidate.path),
      ["apps/web/jsconfig.json", "packages/ui/tsconfig.build.json", "tsconfig.base.json", "tsconfig.json"],
    );
    assert.deepEqual(selected[3], { path: "tsconfig.json", size: 100 });
  });

  it("skips oversized config files", () => {
    const selected = selectConfigFiles([blob("tsconfig.json", MAX_CONFIG_FILE_BYTES + 1)]);
    assert.deepEqual(selected, []);
  });
});

describe("readProjectConfigs", () => {
  it("accepts comments and trailing commas", () => {
    const project = readProjectConfigs(
      configs({
        "tsconfig.json": `{
          // Next.js default
          "compilerOptions": {
            /* alias */
            "paths": { "@/*": ["./src/*",], },
          },
        }`,
      }),
    );

    assert.deepEqual(project.statuses, [{ path: "tsconfig.json", valid: true }]);
    assert.deepEqual(project.configFor("src/app.ts")?.paths.map((alias) => alias.pattern), ["@/*"]);
  });

  it("marks malformed configs as invalid and provides no aliases", () => {
    const project = readProjectConfigs(
      configs({
        "tsconfig.json": '{ "compilerOptions": { "paths": ',
        "a/tsconfig.json": "[1, 2]",
        "b/tsconfig.json": '{ "compilerOptions": { "baseUrl": "." } "extra": 1 }',
      }),
    );

    assert.deepEqual(project.statuses, [
      { path: "a/tsconfig.json", valid: false },
      { path: "b/tsconfig.json", valid: false },
      { path: "tsconfig.json", valid: false },
    ]);
    assert.equal(project.configFor("src/app.ts"), null);
    assert.equal(project.configFor("a/app.ts"), null);
  });

  it("ignores malformed paths entries and keeps valid ones", () => {
    const project = readProjectConfigs(
      configs({
        "tsconfig.json": JSON.stringify({
          compilerOptions: {
            paths: {
              "@/*": ["src/*"],
              "bad/*/*": ["src/*"],
              "not-array/*": "src/*",
              "numbers/*": [1, 2],
              "mixed/*": [3, "lib/*", "a/*/*"],
            },
          },
        }),
      }),
    );

    assert.deepEqual(project.configFor("x.ts")?.paths, [
      { pattern: "@/*", prefix: "@/", suffix: "", targets: ["src/*"] },
      { pattern: "mixed/*", prefix: "mixed/", suffix: "", targets: ["lib/*"] },
    ]);
  });

  it("uses the nearest config and prefers tsconfig.json over jsconfig.json", () => {
    const project = readProjectConfigs(
      configs({
        "tsconfig.json": "{}",
        "jsconfig.json": "{}",
        "apps/web/jsconfig.json": "{}",
        "apps/web/src/tsconfig.json": "{}",
      }),
    );

    assert.equal(project.configFor("index.ts")?.configPath, "tsconfig.json");
    assert.equal(project.configFor("apps/api/server.ts")?.configPath, "tsconfig.json");
    assert.equal(project.configFor("apps/web/next.config.js")?.configPath, "apps/web/jsconfig.json");
    assert.equal(project.configFor("apps/web/pages/index.jsx")?.configPath, "apps/web/jsconfig.json");
    assert.equal(project.configFor("apps/web/src/app.ts")?.configPath, "apps/web/src/tsconfig.json");
  });

  it("returns null for files without a config", () => {
    const project = readProjectConfigs(configs({ "packages/a/tsconfig.json": "{}" }));
    assert.equal(project.configFor("src/app.ts"), null);
    assert.equal(project.configFor("packages/b/index.ts"), null);
  });

  it("does not treat tsconfig.base.json as a project config", () => {
    const project = readProjectConfigs(configs({ "tsconfig.base.json": nextConfig }));
    assert.equal(project.configFor("src/app.ts"), null);
  });

  describe("extends", () => {
    it("inherits baseUrl and paths from a relative extends", () => {
      const project = readProjectConfigs(
        configs({
          "tsconfig.base.json": JSON.stringify({
            compilerOptions: { baseUrl: ".", paths: { "@shared/*": ["packages/shared/*"] } },
          }),
          "apps/web/tsconfig.json": JSON.stringify({ extends: "../../tsconfig.base.json" }),
        }),
      );

      const config = project.configFor("apps/web/app.ts");
      assert.equal(config?.baseUrl, "");
      assert.equal(config?.pathsBase, "");
      assert.deepEqual(config?.paths.map((alias) => alias.pattern), ["@shared/*"]);
    });

    it("resolves inherited paths relative to the config that declares them", () => {
      const project = readProjectConfigs(
        configs({
          "config/tsconfig.base.json": JSON.stringify({ compilerOptions: { paths: { "@/*": ["../src/*"] } } }),
          "tsconfig.json": JSON.stringify({ extends: "./config/tsconfig.base" }),
        }),
      );

      assert.equal(project.configFor("src/a.ts")?.pathsBase, "config");
    });

    it("lets the extending config override paths", () => {
      const project = readProjectConfigs(
        configs({
          "tsconfig.base.json": JSON.stringify({ compilerOptions: { baseUrl: "lib", paths: { "@/*": ["base/*"] } } }),
          "tsconfig.json": JSON.stringify({
            extends: "./tsconfig.base.json",
            compilerOptions: { paths: { "@/*": ["own/*"] } },
          }),
        }),
      );

      const config = project.configFor("a.ts");
      assert.deepEqual(config?.paths[0].targets, ["own/*"]);
      assert.equal(config?.baseUrl, "lib");
      assert.equal(config?.pathsBase, "lib");
    });

    it("applies array extends in order, later entries winning", () => {
      const project = readProjectConfigs(
        configs({
          "tsconfig.one.json": JSON.stringify({ compilerOptions: { paths: { "@/*": ["one/*"] } } }),
          "tsconfig.two.json": JSON.stringify({ compilerOptions: { paths: { "@/*": ["two/*"] } } }),
          "tsconfig.json": JSON.stringify({ extends: ["./tsconfig.one.json", "./tsconfig.two.json"] }),
        }),
      );

      assert.deepEqual(project.configFor("a.ts")?.paths[0].targets, ["two/*"]);
    });

    it("ignores package extends, missing targets and cycles", () => {
      const project = readProjectConfigs(
        configs({
          "tsconfig.json": JSON.stringify({
            extends: ["@tsconfig/next/tsconfig.json", "./missing.json", "./tsconfig.cycle.json"],
            compilerOptions: { paths: { "@/*": ["src/*"] } },
          }),
          "tsconfig.cycle.json": JSON.stringify({ extends: "./tsconfig.json" }),
        }),
      );

      assert.deepEqual(project.configFor("a.ts")?.paths[0].targets, ["src/*"]);
    });

    it("does not follow extends outside the repository", () => {
      const project = readProjectConfigs(
        configs({ "tsconfig.json": JSON.stringify({ extends: "../../tsconfig.json" }) }),
      );
      assert.deepEqual(project.configFor("a.ts")?.paths, []);
    });
  });
});

describe("alias resolution", () => {
  it("resolves bare specifiers from baseUrl", () => {
    const resolve = resolver(["src/lib/x.ts", "src/components/Button.tsx"], {
      "tsconfig.json": JSON.stringify({ compilerOptions: { baseUrl: "src" } }),
    });

    assert.deepEqual(resolve("src/app.ts", "lib/x"), resolved("src/lib/x.ts"));
    assert.deepEqual(resolve("src/app.ts", "components/Button"), resolved("src/components/Button.tsx"));
    assert.deepEqual(resolve("src/app.ts", "react"), { status: "external" });
  });

  it("resolves exact paths aliases", () => {
    const resolve = resolver(["src/config/index.ts", "src/env.ts"], {
      "tsconfig.json": JSON.stringify({
        compilerOptions: { paths: { config: ["./src/config"], "env-file": ["src/env.ts"] } },
      }),
    });

    assert.deepEqual(resolve("src/app.ts", "config"), resolved("src/config/index.ts"));
    assert.deepEqual(resolve("src/app.ts", "env-file"), resolved("src/env.ts"));
    assert.deepEqual(resolve("src/app.ts", "config/other"), { status: "external" });
  });

  it("resolves wildcard paths aliases", () => {
    const resolve = resolver(["src/lib/x.ts", "src/components/ui/button.tsx"], {
      "tsconfig.json": nextConfig,
    });

    assert.deepEqual(resolve("src/app.ts", "@/lib/x"), resolved("src/lib/x.ts"));
    assert.deepEqual(resolve("src/app.ts", "@/components/ui/button"), resolved("src/components/ui/button.tsx"));
  });

  it("applies extensionless and index resolution to alias targets", () => {
    const resolve = resolver(["src/lib/index.ts", "src/view.jsx", "src/model.ts"], {
      "tsconfig.json": nextConfig,
    });

    assert.deepEqual(resolve("src/app.ts", "@/lib"), resolved("src/lib/index.ts"));
    assert.deepEqual(resolve("src/app.ts", "@/view"), resolved("src/view.jsx"));
    assert.deepEqual(resolve("src/app.ts", "@/model.js"), resolved("src/model.ts"));
  });

  it("uses a suffix in the pattern and the longest matching prefix", () => {
    const resolve = resolver(["src/icons/star.tsx", "src/ui/button.ts", "src/ui/special/button.ts"], {
      "tsconfig.json": JSON.stringify({
        compilerOptions: {
          paths: {
            "icon:*!": ["src/icons/*"],
            "@ui/*": ["src/ui/*"],
            "@ui/special/*": ["src/ui/special/*"],
          },
        },
      }),
    });

    assert.deepEqual(resolve("a.ts", "icon:star!"), resolved("src/icons/star.tsx"));
    assert.deepEqual(resolve("a.ts", "@ui/button"), resolved("src/ui/button.ts"));
    assert.deepEqual(resolve("a.ts", "@ui/special/button"), resolved("src/ui/special/button.ts"));
  });

  it("tries each alias target in order", () => {
    const resolve = resolver(["generated/api.ts", "src/api.ts"], {
      "tsconfig.json": JSON.stringify({ compilerOptions: { paths: { "~/*": ["src/*", "generated/*"] } } }),
    });

    assert.deepEqual(resolve("a.ts", "~/api"), resolved("src/api.ts"));
  });

  it("resolves paths relative to a nested config", () => {
    const resolve = resolver(["apps/web/src/lib/x.ts", "src/lib/x.ts"], {
      "tsconfig.json": JSON.stringify({ compilerOptions: { paths: { "@/*": ["./src/*"] } } }),
      "apps/web/tsconfig.json": nextConfig,
    });

    assert.deepEqual(resolve("apps/web/src/app/page.tsx", "@/lib/x"), resolved("apps/web/src/lib/x.ts"));
    assert.deepEqual(resolve("src/app.ts", "@/lib/x"), resolved("src/lib/x.ts"));
  });

  it("falls back to relative resolution when the config is malformed", () => {
    const resolve = resolver(["src/lib/x.ts", "src/app.ts"], { "tsconfig.json": "{ not json" });

    assert.deepEqual(resolve("src/app.ts", "./lib/x"), resolved("src/lib/x.ts"));
    assert.deepEqual(resolve("src/app.ts", "@/lib/x"), unresolved("unsupported_alias"));
  });

  it("supports jsconfig.json", () => {
    const resolve = resolver(["src/lib/x.js"], { "jsconfig.json": nextConfig });
    assert.deepEqual(resolve("src/app.jsx", "@/lib/x"), resolved("src/lib/x.js"));
  });

  it("records a matched alias whose target does not exist", () => {
    const resolve = resolver(["src/lib/x.ts"], { "tsconfig.json": nextConfig });
    assert.deepEqual(resolve("src/app.ts", "@/lib/missing"), unresolved("not_found"));
  });

  it("records alias-looking specifiers that the config does not map", () => {
    const resolve = resolver(["src/lib/x.ts"], {
      "tsconfig.json": JSON.stringify({ compilerOptions: { paths: { "@app/*": ["src/*"] } } }),
    });

    assert.deepEqual(resolve("src/app.ts", "@/lib/x"), unresolved("unsupported_alias"));
    assert.deepEqual(resolve("src/app.ts", "~/lib/x"), unresolved("unsupported_alias"));
  });

  it("does not match packages that share a prefix with an alias", () => {
    const resolve = resolver(["src/lib/x.ts", "src/utils/index.ts"], {
      "tsconfig.json": JSON.stringify({
        compilerOptions: { paths: { "@/*": ["src/*"], "@app/*": ["src/*"], utils: ["src/utils"] } },
      }),
    });

    for (const specifier of ["@apple/pkg", "@scope/pkg", "@application/x", "utils-lib", "utilsx", "react"]) {
      assert.deepEqual(resolve("src/a.ts", specifier), { status: "external" }, specifier);
    }
  });

  it("treats aliases that only point into node_modules as packages", () => {
    const resolve = resolver(["src/a.ts"], {
      "tsconfig.json": JSON.stringify({
        compilerOptions: { paths: { lodash: ["node_modules/lodash-es"], "@/*": ["src/*"] } },
      }),
    });

    assert.deepEqual(resolve("src/b.ts", "lodash"), { status: "external" });
  });

  it("does not resolve root-absolute specifiers through baseUrl", () => {
    const resolve = resolver(["src/a.ts"], {
      "tsconfig.json": JSON.stringify({ compilerOptions: { baseUrl: "." } }),
    });

    assert.deepEqual(resolve("src/b.ts", "src/a"), resolved("src/a.ts"));
    assert.deepEqual(resolve("src/b.ts", "/src/a"), unresolved("unsupported_alias"));
  });

  it("does not report packages as unresolved when a catch-all pattern misses", () => {
    const resolve = resolver(["src/types/env.ts"], {
      "tsconfig.json": JSON.stringify({ compilerOptions: { paths: { "*": ["node_modules/*", "src/types/*"] } } }),
    });

    assert.deepEqual(resolve("a.ts", "env"), resolved("src/types/env.ts"));
    assert.deepEqual(resolve("a.ts", "react"), { status: "external" });
  });

  it("keeps alias targets inside the repository", () => {
    const resolve = resolver(["src/a.ts", "outside/x.ts"], {
      "packages/app/tsconfig.json": JSON.stringify({
        compilerOptions: { paths: { "@out/*": ["../../../outside/*"], "@abs/*": ["/etc/*"] } },
      }),
      "tsconfig.json": JSON.stringify({ compilerOptions: { baseUrl: "..", paths: { "@/*": ["src/*"] } } }),
    });

    assert.deepEqual(resolve("packages/app/index.ts", "@out/x"), unresolved("outside_repository"));
    assert.deepEqual(resolve("packages/app/index.ts", "@abs/passwd"), unresolved("outside_repository"));
    // A root baseUrl above the repository makes the whole config unusable.
    assert.deepEqual(resolve("src/b.ts", "@/a"), unresolved("unsupported_alias"));
  });

  it("does not apply aliases to relative specifiers", () => {
    const resolve = resolver(["src/x.ts", "lib/x.ts"], {
      "tsconfig.json": JSON.stringify({ compilerOptions: { paths: { "./*": ["lib/*"] } } }),
    });

    assert.deepEqual(resolve("src/a.ts", "./x"), resolved("src/x.ts"));
  });
});
