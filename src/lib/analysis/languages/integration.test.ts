import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { afterEach, describe, it } from "node:test";

import { strToU8, zipSync } from "fflate";

import { discoverRepository } from "../../discovery.ts";
import { buildDependencyGraph } from "../../graph/build.ts";
import { deriveRepositoryInsights } from "../../graph/insights.ts";
import { selectSourceFiles } from "../../source-files.ts";
import { DEFAULT_FILTERS, languageOptions, visibleNodeIds } from "../../visualization/filters.ts";
import { traceImpact } from "../../visualization/impact.ts";
import { buildGraphIndex } from "../../visualization/inspection.ts";
import { toRenderGraph } from "../../visualization/payload.ts";
import type { RenderGraph } from "../../visualization/types.ts";
import { analyzeModuleRelationships } from "../relationships.ts";
import type { Fixture } from "./testing.ts";

// The whole analysis, as discovery runs it after download: source selection,
// relationship analysis, graph construction and the browser payload.
function repositoryGraph(sources: Fixture, configs: Fixture = {}): RenderGraph {
  const entries = [...Object.entries(sources), ...Object.entries(configs)].map(([path, content]) => ({
    path,
    type: "blob" as const,
    sha: path,
    size: content.length,
  }));
  const selection = selectSourceFiles(entries);
  const files = selection.candidates.map((candidate) => ({ ...candidate, content: sources[candidate.path] }));
  const analysis = analyzeModuleRelationships(files, {
    configFiles: Object.entries(configs).map(([path, content]) => ({ path, content })),
    repositoryPaths: entries.map((entry) => entry.path),
  });
  return toRenderGraph(buildDependencyGraph(files, analysis.relationships));
}

function edgeList(graph: RenderGraph): string[] {
  return graph.edges.map((edge) => `${edge.source} -> ${edge.target}`);
}

function languages(graph: RenderGraph): Record<string, string> {
  return Object.fromEntries(graph.nodes.map((node) => [node.id, node.language]));
}

const REPOSITORY_A = {
  sources: {
    "web/src/api.ts": 'import { get } from "./http";\nexport const load = () => get("/items");\n',
    "web/src/http.ts": "export const get = (url: string) => fetch(url);\n",
    "server/app/__init__.py": "",
    "server/app/main.py": "from fastapi import FastAPI\nfrom app.routes import items\n",
    "server/app/routes/__init__.py": "",
    "server/app/routes/items.py": "from ..db import session\n",
    "server/app/db.py": "import sqlalchemy\n",
  },
};

describe("multi-language repositories", () => {
  it("A: TypeScript and Python in one graph", () => {
    const graph = repositoryGraph(REPOSITORY_A.sources);

    assert.deepEqual(languages(graph), {
      "server/app/__init__.py": "python",
      "server/app/db.py": "python",
      "server/app/main.py": "python",
      "server/app/routes/__init__.py": "python",
      "server/app/routes/items.py": "python",
      "web/src/api.ts": "typescript",
      "web/src/http.ts": "typescript",
    });
    assert.deepEqual(edgeList(graph), [
      "server/app/main.py -> server/app/routes/items.py",
      "server/app/routes/items.py -> server/app/db.py",
      "web/src/api.ts -> web/src/http.ts",
    ]);
    const insights = deriveRepositoryInsights(graph);
    assert.deepEqual(insights.totals.languages, { python: 5, typescript: 2 });
    assert.equal(insights.totals.edges, 3);
    assert.equal(insights.totals.isolatedFiles, 2);
  });

  it("B: Go and Rust", () => {
    const graph = repositoryGraph(
      {
        "cmd/tool/main.go": 'package main\nimport "github.com/acme/tool/internal/parse"\n',
        "internal/parse/parse.go": 'package parse\nimport "strings"\n',
        "native/src/lib.rs": "pub mod ffi;\nuse crate::ffi::Handle;\n",
        "native/src/ffi.rs": "use std::ffi::CStr;\n",
      },
      { "go.mod": "module github.com/acme/tool\n", "native/Cargo.toml": '[package]\nname = "native"\n' },
    );

    assert.deepEqual(edgeList(graph), ["cmd/tool/main.go -> internal/parse/parse.go", "native/src/lib.rs -> native/src/ffi.rs"]);
    assert.deepEqual(languageOptions(buildGraphIndex(graph)), ["go", "rust"]);
    assert.deepEqual([...visibleNodeIds(buildGraphIndex(graph), { ...DEFAULT_FILTERS, language: "rust" })!].sort(), [
      "native/src/ffi.rs",
      "native/src/lib.rs",
    ]);
  });

  it("C: Java and Kotlin, with Impact Mode over the normalized edges", () => {
    const graph = repositoryGraph({
      "src/main/java/shop/Money.java": "package shop;\npublic final class Money {}\n",
      "src/main/java/shop/Cart.java": "package shop;\nimport java.util.List;\npublic class Cart { Money total; }\n",
      "src/main/kotlin/shop/ui/CartScreen.kt": "package shop.ui\n\nimport shop.Cart\n\nclass CartScreen(val cart: Cart)\n",
      "src/main/kotlin/shop/ui/App.kt": "package shop.ui\n\nfun main() { CartScreen(TODO()) }\n",
    });

    assert.deepEqual(edgeList(graph), [
      "src/main/java/shop/Cart.java -> src/main/java/shop/Money.java",
      "src/main/kotlin/shop/ui/App.kt -> src/main/kotlin/shop/ui/CartScreen.kt",
      "src/main/kotlin/shop/ui/CartScreen.kt -> src/main/java/shop/Cart.java",
    ]);
    const impact = traceImpact(buildGraphIndex(graph), "src/main/java/shop/Money.java")!;
    assert.deepEqual(impact.levels, [
      ["src/main/java/shop/Cart.java"],
      ["src/main/kotlin/shop/ui/CartScreen.kt"],
      ["src/main/kotlin/shop/ui/App.kt"],
    ]);
  });

  it("D: C and C++", () => {
    const graph = repositoryGraph({
      "include/engine/core.h": "#pragma once\n#include <stddef.h>\n",
      "src/core.c": '#include "engine/core.h"\n',
      "src/renderer.cpp": '#include <engine/core.h>\n#include "renderer.hpp"\n#include <vector>\n',
      "src/renderer.hpp": '#include "engine/core.h"\n',
    });

    assert.deepEqual(languages(graph), {
      "include/engine/core.h": "c",
      "src/core.c": "c",
      "src/renderer.cpp": "cpp",
      "src/renderer.hpp": "cpp",
    });
    assert.deepEqual(edgeList(graph), [
      "src/core.c -> include/engine/core.h",
      "src/renderer.cpp -> include/engine/core.h",
      "src/renderer.cpp -> src/renderer.hpp",
      "src/renderer.hpp -> include/engine/core.h",
    ]);
    assert.deepEqual(traceImpact(buildGraphIndex(graph), "include/engine/core.h")!.levels, [
      ["src/core.c", "src/renderer.cpp", "src/renderer.hpp"],
    ]);
  });

  it("E: C#, PHP and Ruby", () => {
    const graph = repositoryGraph(
      {
        "dotnet/Models/Invoice.cs": "namespace Billing.Models;\npublic class Invoice {}\n",
        "dotnet/Services/InvoiceService.cs": "using Billing.Models;\nusing System.Linq;\nnamespace Billing.Services;\nclass InvoiceService { Invoice Load() => new(); }\n",
        "php/src/Invoice.php": "<?php\nnamespace Billing;\nclass Invoice {}\n",
        "php/src/Controller.php": "<?php\nnamespace Billing;\nuse Billing\\Invoice;\nuse Symfony\\Component\\HttpFoundation\\Response;\n",
        "ruby/lib/billing.rb": "require 'json'\nrequire_relative 'billing/invoice'\n",
        "ruby/lib/billing/invoice.rb": "",
      },
      { "php/composer.json": JSON.stringify({ autoload: { "psr-4": { "Billing\\": "src/" } } }) },
    );

    assert.deepEqual(edgeList(graph), [
      "dotnet/Services/InvoiceService.cs -> dotnet/Models/Invoice.cs",
      "php/src/Controller.php -> php/src/Invoice.php",
      "ruby/lib/billing.rb -> ruby/lib/billing/invoice.rb",
    ]);
    assert.deepEqual(languageOptions(buildGraphIndex(graph)), ["csharp", "php", "ruby"]);
  });

  it("F: Dart, Elixir, Lua, Swift and Scala", () => {
    const graph = repositoryGraph(
      {
        "app/lib/main.dart": "import 'package:app/src/cart.dart';\nimport 'package:flutter/material.dart';\n",
        "app/lib/src/cart.dart": "",
        "server/lib/shop.ex": "defmodule Shop do\n  alias Shop.Repo\n  def all, do: Repo.all()\nend\n",
        "server/lib/shop/repo.ex": "defmodule Shop.Repo do\n  use Ecto.Repo, otp_app: :shop\nend\n",
        "scripts/init.lua": "local cfg = require('scripts.config')\n",
        "scripts/config.lua": "",
        "ios/App/Store.swift": "final class Store { let cart = CartModel() }\n",
        "ios/App/CartModel.swift": "import Foundation\nstruct CartModel {}\n",
        "jobs/src/Main.scala": "package jobs\nimport jobs.tasks.Cleanup\nobject Main\n",
        "jobs/src/tasks/Cleanup.scala": "package jobs.tasks\nclass Cleanup\n",
      },
      { "app/pubspec.yaml": "name: app\n" },
    );

    assert.deepEqual(edgeList(graph), [
      "app/lib/main.dart -> app/lib/src/cart.dart",
      "ios/App/Store.swift -> ios/App/CartModel.swift",
      "jobs/src/Main.scala -> jobs/src/tasks/Cleanup.scala",
      "scripts/init.lua -> scripts/config.lua",
      "server/lib/shop.ex -> server/lib/shop/repo.ex",
    ]);
    assert.deepEqual(languageOptions(buildGraphIndex(graph)), ["dart", "elixir", "scala", "lua", "swift"]);
    assert.equal(graph.nodes.length, 10);
  });

  it("never adds nodes for external packages", () => {
    const graph = repositoryGraph(REPOSITORY_A.sources);

    assert.ok(graph.nodes.every((node) => node.id in REPOSITORY_A.sources));
    assert.ok(graph.edges.every((edge) => edge.source in REPOSITORY_A.sources && edge.target in REPOSITORY_A.sources));
  });

  it("produces identical output regardless of input order", () => {
    const sources = { ...REPOSITORY_A.sources };
    const reversed = Object.fromEntries(Object.entries(sources).reverse());

    assert.deepEqual(repositoryGraph(reversed), repositoryGraph(sources));
  });
});

// The same pipeline, end to end through discovery with a mocked GitHub API,
// so manifest files are selected from the tree and read from the archive.
describe("discovery of a multi-language repository", () => {
  const files: Fixture = {
    "go.mod": "module example.com/mono\n",
    "Cargo.toml": '[package]\nname = "mono"\n',
    "cmd/main.go": 'package main\nimport "example.com/mono/pkg/util"\n',
    "pkg/util/util.go": "package util\n",
    "src/lib.rs": "mod parse;\n",
    "src/parse.rs": "",
    "tools/report.py": "from tools import format\n",
    "tools/__init__.py": "",
    "tools/format.py": "",
    "README.md": "# mono",
  };
  const base = "https://api.github.com/repos/octo/mono";
  let restore = () => {};
  afterEach(() => restore());

  it("analyzes every language through the one pipeline", async () => {
    const sha1 = (content: string) => {
      const bytes = strToU8(content);
      return createHash("sha1").update(`blob ${bytes.length}\0`).update(bytes).digest("hex");
    };
    const json = (body: unknown) => new Response(JSON.stringify(body), { headers: { "content-type": "application/json" } });
    const routes: Record<string, () => Response> = {
      [base]: () =>
        json({ name: "mono", full_name: "octo/mono", owner: { login: "octo" }, private: false, archived: false, html_url: "https://github.com/octo/mono", default_branch: "main", size: 1 }),
      [`${base}/git/trees/main?recursive=1`]: () =>
        json({
          sha: "root",
          truncated: false,
          tree: Object.entries(files).map(([path, content]) => ({ path, mode: "100644", type: "blob", sha: sha1(content), size: strToU8(content).length })),
        }),
      [`${base}/zipball/main`]: () =>
        new Response(zipSync({ "octo-mono-1": Object.fromEntries(Object.entries(files).map(([p, c]) => [p, strToU8(c)])) })),
    };
    const original = globalThis.fetch;
    globalThis.fetch = (async (input: RequestInfo | URL) => {
      const route = routes[String(input)];
      if (route === undefined) throw new Error(`unexpected request: ${String(input)}`);
      return route();
    }) as typeof fetch;
    restore = () => {
      globalThis.fetch = original;
    };

    const result = await discoverRepository("https://github.com/octo/mono");

    assert.equal(result.status, "success");
    if (result.status !== "success") return;
    assert.deepEqual(edgeList(result.graph), [
      "cmd/main.go -> pkg/util/util.go",
      "src/lib.rs -> src/parse.rs",
      "tools/report.py -> tools/format.py",
    ]);
    assert.equal(result.graph.nodes.length, 7);
  });
});
