import assert from "node:assert/strict";
import { describe, it } from "node:test";

import type { Settings } from "sigma/settings";

import { drawHoverLabel } from "./labels.ts";
import { fileSizeToNodeSize, nodeSize } from "./mapping.ts";
import { RENDERER_SETTINGS } from "./settings.ts";
import { LABEL, NODE } from "./theme.ts";
import type { EdgeAttributes, NodeAttributes } from "./types.ts";

function fakeContext() {
  const calls: { method: string; args: unknown[]; fillStyle: unknown }[] = [];
  const context = {
    font: "",
    fillStyle: "" as unknown,
    measureText: (text: string) => ({ width: text.length * 6 }),
    fillRect(...args: unknown[]) {
      calls.push({ method: "fillRect", args, fillStyle: this.fillStyle });
    },
    fillText(...args: unknown[]) {
      calls.push({ method: "fillText", args, fillStyle: this.fillStyle });
    },
  };
  return { context: context as unknown as CanvasRenderingContext2D, calls };
}

const settings = RENDERER_SETTINGS as unknown as Settings<NodeAttributes, EdgeAttributes>;

describe("drawHoverLabel", () => {
  it("draws the label in the hover color over a dark backing", () => {
    const { context, calls } = fakeContext();
    drawHoverLabel(context, { x: 100, y: 50, size: 4, label: "repository.ts", color: "#fff" }, settings);

    assert.deepEqual(
      calls.map((call) => call.method),
      ["fillRect", "fillText"],
    );
    assert.equal(calls[0].fillStyle, LABEL.hoverBackground);
    assert.equal(calls[1].fillStyle, LABEL.hoverColor);
    assert.equal(calls[1].args[0], "repository.ts");
    assert.ok((calls[1].args[1] as number) > 104, "text starts right of the node");
  });

  it("draws nothing without a label", () => {
    const { context, calls } = fakeContext();
    drawHoverLabel(context, { x: 0, y: 0, size: 4, label: null, color: "#fff" }, settings);

    assert.equal(calls.length, 0);
  });
});

describe("label settings", () => {
  it("uses the theme label settings", () => {
    assert.equal(RENDERER_SETTINGS.labelRenderedSizeThreshold, LABEL.renderedSizeThreshold);
    assert.equal(RENDERER_SETTINGS.labelSize, LABEL.size);
    assert.deepEqual(RENDERER_SETTINGS.labelColor, { color: LABEL.color });
    assert.equal(RENDERER_SETTINGS.defaultDrawNodeHover, drawHoverLabel);
  });

  it("hides labels of small files at the default zoom", () => {
    assert.ok(nodeSize(0, 1_000) < LABEL.renderedSizeThreshold);
    assert.ok(fileSizeToNodeSize(1_000) < LABEL.renderedSizeThreshold);
  });

  it("shows labels of large files at the default zoom", () => {
    assert.ok(NODE.maxSize >= LABEL.renderedSizeThreshold);
    assert.ok(fileSizeToNodeSize(16_000) >= LABEL.renderedSizeThreshold);
  });
});
