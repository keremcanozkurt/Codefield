import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  degreeEmphasis,
  edgeColor,
  edgeEmphasis,
  edgeOpacity,
  edgeSize,
  edgeStyle,
  fileName,
  fileSizeToNodeSize,
  hoveredEdgeStyle,
  hoveredNodeStyle,
  languageColors,
  nodeColor,
  nodeSize,
  nodeStyle,
  premultiplied,
} from "./mapping.ts";
import { EDGE, LANGUAGE_COLORS, NODE } from "./theme.ts";
import type { RenderNode } from "./types.ts";

const HEX = /^#[0-9a-f]{6}$/;
const RGBA = /^rgba\((\d{1,3}), (\d{1,3}), (\d{1,3}), (0|1|0?\.\d+)\)$/;

function channels(hex: string): number[] {
  return [1, 3, 5].map((i) => Number.parseInt(hex.slice(i, i + 2), 16));
}

function brightness(hex: string): number {
  return channels(hex).reduce((sum, channel) => sum + channel, 0);
}

function renderNode(overrides: Partial<RenderNode> = {}): RenderNode {
  return {
    id: "src/lib/repository.ts",
    path: "src/lib/repository.ts",
    directory: "src/lib",
    language: "typescript",
    size: 2_000,
    incoming: 0,
    outgoing: 0,
    degree: 0,
    ...overrides,
  };
}

describe("fileSizeToNodeSize", () => {
  it("gives empty files the minimum size", () => {
    assert.equal(fileSizeToNodeSize(0), NODE.minSize);
  });

  it("keeps tiny files within bounds", () => {
    for (const bytes of [1, 12, 64, 128, 200]) {
      const size = fileSizeToNodeSize(bytes);
      assert.ok(size >= NODE.minSize && size <= NODE.maxSize, `${bytes}: ${size}`);
    }
  });

  it("makes larger files larger", () => {
    const tiny = fileSizeToNodeSize(300);
    const medium = fileSizeToNodeSize(4_000);
    const large = fileSizeToNodeSize(40_000);

    assert.ok(medium > tiny);
    assert.ok(large > medium);
  });

  it("never exceeds the maximum", () => {
    for (const bytes of [NODE.maxBytes, 512 * 1024, 10 ** 9, Number.MAX_SAFE_INTEGER, Infinity]) {
      assert.equal(fileSizeToNodeSize(bytes), NODE.maxSize);
    }
  });

  it("is monotonic", () => {
    let previous = -Infinity;
    for (let bytes = 0; bytes <= 200_000; bytes += 97) {
      const size = fileSizeToNodeSize(bytes);
      assert.ok(size >= previous, `${bytes}`);
      previous = size;
    }
  });

  it("compresses large differences in bytes", () => {
    const ratio = fileSizeToNodeSize(500 * 1024) / fileSizeToNodeSize(1024);

    assert.ok(ratio < 2.5, `ratio ${ratio}`);
  });

  it("is deterministic", () => {
    assert.equal(fileSizeToNodeSize(12_345), fileSizeToNodeSize(12_345));
  });

  it("depends only on the file's own size", () => {
    const alone = nodeStyle(renderNode({ size: 3_000 }));
    const inLargeRepository = [renderNode({ size: 400_000 }), renderNode({ size: 3_000 })].map(nodeStyle)[1];

    assert.deepEqual(inLargeRepository, alone);
  });

  it("treats invalid sizes as empty files", () => {
    assert.equal(fileSizeToNodeSize(-10), NODE.minSize);
    assert.equal(fileSizeToNodeSize(Number.NaN), NODE.minSize);
  });
});

describe("degreeEmphasis", () => {
  it("is 0 for isolated files", () => {
    assert.equal(degreeEmphasis(0), 0);
  });

  it("increases with degree", () => {
    const values = [0, 1, 2, 5, 10, 20].map(degreeEmphasis);

    for (let i = 1; i < values.length; i++) assert.ok(values[i] > values[i - 1]);
  });

  it("is bounded at 1", () => {
    assert.equal(degreeEmphasis(NODE.degreeReference), 1);
    assert.equal(degreeEmphasis(10_000), 1);
    assert.ok(degreeEmphasis(20) < 1);
  });

  it("is deterministic", () => {
    assert.equal(degreeEmphasis(7), degreeEmphasis(7));
  });

  it("cannot make a tiny file large", () => {
    const size = nodeSize(0, 10_000);

    assert.ok(size <= NODE.minSize * (1 + NODE.degreeSizeBoost));
    assert.ok(size < fileSizeToNodeSize(4_000));
  });

  it("adds at most degreeSizeBoost to the file-size radius", () => {
    for (const bytes of [0, 2_000, 100_000]) {
      const base = nodeSize(bytes, 0);
      assert.equal(base, fileSizeToNodeSize(bytes));
      assert.ok(nodeSize(bytes, 500) <= base * (1 + NODE.degreeSizeBoost) + 1e-9);
    }
  });
});

describe("language colors", () => {
  it("returns the TypeScript palette", () => {
    assert.equal(languageColors("typescript"), LANGUAGE_COLORS.typescript);
  });

  it("returns the JavaScript palette", () => {
    assert.equal(languageColors("javascript"), LANGUAGE_COLORS.javascript);
  });

  it("produces hex colors Sigma can parse", () => {
    for (const language of ["typescript", "javascript"] as const) {
      for (const emphasis of [0, 0.3, 1]) assert.match(nodeColor(language, emphasis), HEX);
    }
  });

  it("keeps TypeScript and JavaScript apart", () => {
    for (const emphasis of [0, 0.5, 1]) {
      assert.notEqual(nodeColor("typescript", emphasis), nodeColor("javascript", emphasis));
    }
    const [tr, , tb] = channels(nodeColor("typescript", 1));
    const [jr, , jb] = channels(nodeColor("javascript", 1));
    assert.ok(tb > tr, "TypeScript leans cool");
    assert.ok(jr > jb, "JavaScript leans warm");
  });

  it("stays low in saturation", () => {
    for (const { quiet, bright } of Object.values(LANGUAGE_COLORS)) {
      for (const rgb of [quiet, bright]) {
        const spread = Math.max(...rgb) - Math.min(...rgb);
        assert.ok(spread <= 40, `${rgb} spread ${spread}`);
      }
    }
  });

  it("is deterministic", () => {
    assert.equal(nodeColor("javascript", 0.4), nodeColor("javascript", 0.4));
  });

  it("gets brighter with emphasis but keeps isolated files visible", () => {
    for (const language of ["typescript", "javascript"] as const) {
      const quiet = nodeColor(language, 0);
      assert.ok(brightness(nodeColor(language, 1)) > brightness(quiet));
      // The graph background is #0d0f13.
      assert.ok(Math.min(...channels(quiet)) >= 100, quiet);
    }
  });
});

describe("edge mapping", () => {
  it("uses the base size and opacity for weight 1", () => {
    assert.equal(edgeEmphasis(1), 0);
    assert.equal(edgeSize(1), EDGE.minSize);
    assert.equal(edgeOpacity(1), EDGE.minOpacity);
  });

  it("increases emphasis with weight", () => {
    assert.ok(edgeSize(2) > edgeSize(1));
    assert.ok(edgeSize(4) > edgeSize(2));
    assert.ok(edgeOpacity(3) > edgeOpacity(1));
  });

  it("is bounded for extreme weights", () => {
    assert.equal(edgeSize(10_000), EDGE.maxSize);
    assert.equal(edgeOpacity(10_000), EDGE.maxOpacity);
  });

  it("stays below the smallest node", () => {
    assert.ok(edgeSize(10_000) < NODE.minSize);
    assert.ok(EDGE.hoverSize < NODE.minSize);
    assert.ok(EDGE.maxOpacity < 0.5);
    assert.ok(EDGE.hoverOpacity < 1);
  });

  it("uses premultiplied rgba colors", () => {
    const match = RGBA.exec(edgeColor(1));
    assert.ok(match);
    const [r, g, b, a] = match.slice(1).map(Number);
    assert.equal(a, EDGE.minOpacity);
    assert.deepEqual([r, g, b], EDGE.color.map((channel) => Math.round(channel * a)));
  });

  it("is deterministic", () => {
    assert.deepEqual(edgeStyle({ id: "e", source: "a", target: "b", weight: 3 }), {
      size: edgeSize(3),
      color: edgeColor(3),
    });
    assert.equal(edgeColor(3), edgeColor(3));
  });

  it("treats invalid weights as weight 1", () => {
    assert.equal(edgeSize(0), EDGE.minSize);
    assert.equal(edgeSize(Number.NaN), EDGE.minSize);
  });
});

describe("premultiplied", () => {
  it("multiplies the channels by the opacity", () => {
    assert.equal(premultiplied([200, 100, 50], 0.5), "rgba(100, 50, 25, 0.5)");
    assert.equal(premultiplied([200, 100, 50], 1), "rgba(200, 100, 50, 1)");
  });
});

describe("nodeStyle", () => {
  it("returns size, color and label", () => {
    assert.deepEqual(Object.keys(nodeStyle(renderNode())).sort(), ["color", "label", "size"]);
  });

  it("labels nodes with the file name", () => {
    assert.equal(nodeStyle(renderNode()).label, "repository.ts");
    assert.equal(nodeStyle(renderNode({ path: "index.js" })).label, "index.js");
    assert.equal(fileName("a/b/c/d.tsx"), "d.tsx");
  });

  it("uses the language for color", () => {
    const ts = nodeStyle(renderNode({ language: "typescript" }));
    const js = nodeStyle(renderNode({ language: "javascript" }));

    assert.notEqual(ts.color, js.color);
    assert.equal(ts.size, js.size);
  });
});

describe("hover styles", () => {
  it("makes the hovered node larger and brighter", () => {
    const base = nodeStyle(renderNode({ degree: 3 }));
    const hovered = hoveredNodeStyle(base);

    assert.ok(hovered.size > base.size);
    assert.ok(brightness(hovered.color) > brightness(base.color));
    assert.match(hovered.color, HEX);
    assert.equal(hovered.label, base.label);
  });

  it("keeps other attributes and does not modify the input", () => {
    const base = { x: 1, y: 2, ...nodeStyle(renderNode()) };
    const copy = { ...base };
    const hovered = hoveredNodeStyle(base);

    assert.deepEqual(base, copy);
    assert.equal(hovered.x, 1);
    assert.equal(hovered.y, 2);
  });

  it("makes edges of the hovered node easier to see", () => {
    const base = edgeStyle({ id: "e", source: "a", target: "b", weight: 1 });
    const hovered = hoveredEdgeStyle(base);
    const opacity = (color: string) => Number(RGBA.exec(color)![4]);

    assert.ok(hovered.size >= base.size);
    assert.ok(opacity(hovered.color) > opacity(base.color));
  });
});
