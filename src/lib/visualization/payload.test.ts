import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { buildDependencyGraph } from "../graph/build.ts";
import type { SourceFile } from "../source-files.ts";
import { toRenderGraph } from "./payload.ts";

const CONTENT_MARKER = "codefield-source-content-marker";

function source(path: string, content: string): SourceFile {
  return {
    path,
    size: content.length,
    extension: ".ts",
    language: "typescript",
    content: `${content}\n// ${CONTENT_MARKER}`,
  };
}

function sampleGraph() {
  const files = [
    source("src/index.ts", 'import { parse } from "./parser";'),
    source("src/parser.ts", "export const parse = 1;"),
    source("src/unused.ts", "export {};"),
  ];
  return buildDependencyGraph(files, [
    { sourcePath: "src/index.ts", targetPath: "src/parser.ts", kind: "import", specifier: "./parser" },
    { sourcePath: "src/index.ts", targetPath: "src/parser.ts", kind: "reexport", specifier: "./parser" },
  ]);
}

describe("toRenderGraph", () => {
  it("includes only the fields the renderer needs", () => {
    const payload = toRenderGraph(sampleGraph());

    assert.deepEqual(Object.keys(payload).sort(), ["edges", "nodes"]);
    for (const node of payload.nodes) {
      assert.deepEqual(Object.keys(node).sort(), [
        "degree",
        "directory",
        "id",
        "incoming",
        "language",
        "outgoing",
        "path",
        "size",
      ]);
    }
    for (const edge of payload.edges) {
      assert.deepEqual(Object.keys(edge).sort(), ["id", "kinds", "source", "target", "weight"]);
    }
  });

  it("copies node and edge values from the dependency graph", () => {
    const graph = sampleGraph();
    const payload = toRenderGraph(graph);

    assert.deepEqual(payload.nodes[0], {
      id: "src/index.ts",
      path: "src/index.ts",
      directory: "src",
      language: "typescript",
      size: graph.nodes[0].size,
      incoming: 0,
      outgoing: 1,
      degree: 1,
    });
    assert.deepEqual(payload.edges, [
      {
        id: graph.edges[0].id,
        source: "src/index.ts",
        target: "src/parser.ts",
        weight: 2,
        kinds: ["import", "reexport"],
      },
    ]);
    assert.deepEqual(
      payload.nodes.map((node) => node.id),
      graph.nodes.map((node) => node.id),
    );
  });

  it("never includes source content or import specifiers", () => {
    const json = JSON.stringify(toRenderGraph(sampleGraph()));

    assert.ok(!json.includes(CONTENT_MARKER));
    assert.ok(!json.includes("export const"));
    assert.ok(!json.includes("./parser"));
    assert.ok(!json.includes('"content"'));
    assert.ok(!json.includes('"specifiers"'));
    assert.ok(!json.includes('"sha"'));
  });

  it("never includes the local session token or authorization data", () => {
    const token = "codefieldSessionToken0123456789";
    const previous = process.env.CODEFIELD_TOKEN;
    process.env.CODEFIELD_TOKEN = token;
    try {
      const json = JSON.stringify(toRenderGraph(sampleGraph()));

      assert.ok(!json.includes(token));
      assert.ok(!/authorization|bearer|token/i.test(json));
    } finally {
      if (previous === undefined) delete process.env.CODEFIELD_TOKEN;
      else process.env.CODEFIELD_TOKEN = previous;
    }
  });

  it("lists relationship kinds in a fixed order", () => {
    const files = ["a.ts", "b.ts", "c.ts"].map((path) => source(path, ""));
    const graph = buildDependencyGraph(files, [
      { sourcePath: "a.ts", targetPath: "b.ts", kind: "require", specifier: "./b" },
      { sourcePath: "a.ts", targetPath: "b.ts", kind: "dynamic_import", specifier: "./b.ts" },
      { sourcePath: "a.ts", targetPath: "b.ts", kind: "import", specifier: "./b.js" },
      { sourcePath: "c.ts", targetPath: "b.ts", kind: "reexport", specifier: "./b" },
    ]);
    const kinds = Object.fromEntries(toRenderGraph(graph).edges.map((e) => [e.source, e.kinds]));

    assert.deepEqual(kinds, { "a.ts": ["import", "dynamic_import", "require"], "c.ts": ["reexport"] });
  });

  it("survives a JSON round trip unchanged", () => {
    const payload = toRenderGraph(sampleGraph());

    assert.deepEqual(JSON.parse(JSON.stringify(payload)), payload);
  });

  it("handles an empty graph", () => {
    assert.deepEqual(toRenderGraph(buildDependencyGraph([], [])), { nodes: [], edges: [] });
  });
});
