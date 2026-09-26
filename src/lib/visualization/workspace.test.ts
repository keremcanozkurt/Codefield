import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { buildStructureTree } from "./structure.ts";
import type { RenderGraph } from "./types.ts";
import { escapeTarget, structureFocusFor, viewForMode } from "./workspace.ts";

function graphOf(paths: string[]): RenderGraph {
  return {
    nodes: paths.map((path) => ({
      id: path,
      path,
      directory: path.includes("/") ? path.slice(0, path.lastIndexOf("/")) : "",
      language: "typescript",
      size: 1,
      incoming: 0,
      outgoing: 0,
      degree: 0,
    })),
    edges: [],
  };
}

describe("escapeTarget", () => {
  it("leaves full screen first, then a special mode, then the selection", () => {
    assert.equal(escapeTarget({ immersive: true, mode: "choosingPath", hasSelection: true }), "immersive");
    assert.equal(escapeTarget({ immersive: false, mode: "choosingPath", hasSelection: true }), "mode");
    assert.equal(escapeTarget({ immersive: false, mode: "impact", hasSelection: true }), "mode");
    assert.equal(escapeTarget({ immersive: false, mode: "path", hasSelection: true }), "mode");
    assert.equal(escapeTarget({ immersive: false, mode: "none", hasSelection: true }), "selection");
    assert.equal(escapeTarget({ immersive: false, mode: null, hasSelection: false }), null);
  });

  it("exits full screen even with nothing selected", () => {
    assert.equal(escapeTarget({ immersive: true, mode: null, hasSelection: false }), "immersive");
  });
});

describe("structureFocusFor", () => {
  const tree = buildStructureTree(
    graphOf(["src/lib/visualization/path.ts", "src/lib/local/walk.ts", "src/app/page.ts", "cli/codefield.ts"]),
  );

  it("opens at the selected file's directory", () => {
    assert.equal(structureFocusFor(tree, "src/lib/visualization/path.ts", ""), "src/lib/visualization");
  });

  it("keeps the previous location without a selection", () => {
    assert.equal(structureFocusFor(tree, null, "src/app"), "src/app");
  });

  it("falls back to the nearest surviving directory after a new analysis", () => {
    const next = buildStructureTree(graphOf(["src/lib/local/walk.ts", "cli/codefield.ts", "src/other.ts"]));

    assert.equal(structureFocusFor(next, "src/lib/visualization/path.ts", "src/lib/visualization"), "src");
    assert.equal(structureFocusFor(next, null, "src/lib/visualization"), "src");
  });
});

describe("viewForMode", () => {
  it("switches to the graph for Impact Mode and Path Finder", () => {
    assert.equal(viewForMode("impact", "structure"), "graph");
    assert.equal(viewForMode("choosingPath", "structure"), "graph");
    assert.equal(viewForMode("path", "structure"), "graph");
    assert.equal(viewForMode("none", "structure"), "structure");
  });
});
