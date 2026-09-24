import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  composeExport,
  EXPORT_MAX_DIMENSION,
  EXPORT_MAX_PIXELS,
  EXPORT_SCALE,
  computeExportDimensions,
  exportFileName,
} from "./export.ts";

describe("computeExportDimensions", () => {
  it("returns null for an empty viewport", () => {
    assert.equal(computeExportDimensions(0, 600, 1), null);
    assert.equal(computeExportDimensions(800, 0, 1), null);
    assert.equal(computeExportDimensions(-10, 600, 1), null);
  });

  it("scales by EXPORT_SCALE at device pixel ratio 1", () => {
    const dimensions = computeExportDimensions(800, 600, 1);
    assert.deepEqual(dimensions, {
      outputWidth: 800 * EXPORT_SCALE,
      outputHeight: 600 * EXPORT_SCALE,
      containerWidth: 800 * EXPORT_SCALE,
      containerHeight: 600 * EXPORT_SCALE,
    });
  });

  it("derives container size from the output size and device pixel ratio", () => {
    const dimensions = computeExportDimensions(1000, 500, 2);
    assert.ok(dimensions);
    assert.equal(dimensions.outputWidth, 2000);
    assert.equal(dimensions.outputHeight, 1000);
    // Sigma multiplies container CSS size by devicePixelRatio internally, so
    // the container must be half the output size at dpr 2.
    assert.equal(dimensions.containerWidth, 1000);
    assert.equal(dimensions.containerHeight, 500);
  });

  it("falls back to a device pixel ratio of 1 when given zero or a negative value", () => {
    const zero = computeExportDimensions(800, 600, 0);
    const negative = computeExportDimensions(800, 600, -2);
    const one = computeExportDimensions(800, 600, 1);
    assert.deepEqual(zero, one);
    assert.deepEqual(negative, one);
  });

  it("preserves aspect ratio when scaled down by the max-dimension guard", () => {
    const dimensions = computeExportDimensions(6000, 3000, 1);
    assert.ok(dimensions);
    assert.ok(dimensions.outputWidth <= EXPORT_MAX_DIMENSION);
    assert.ok(dimensions.outputHeight <= EXPORT_MAX_DIMENSION);
    assert.equal(dimensions.outputWidth, EXPORT_MAX_DIMENSION);
    // 6000x3000 is 2:1; the guard must scale both sides equally.
    assert.equal(Math.round(dimensions.outputWidth / dimensions.outputHeight), 2);
  });

  it("preserves aspect ratio when scaled down by the max-pixel guard", () => {
    const dimensions = computeExportDimensions(5000, 5000, 1);
    assert.ok(dimensions);
    assert.ok(dimensions.outputWidth * dimensions.outputHeight <= EXPORT_MAX_PIXELS);
    assert.equal(dimensions.outputWidth, dimensions.outputHeight);
  });

  it("never scales a small viewport up past EXPORT_SCALE", () => {
    const dimensions = computeExportDimensions(200, 100, 1);
    assert.ok(dimensions);
    assert.equal(dimensions.outputWidth, 200 * EXPORT_SCALE);
    assert.equal(dimensions.outputHeight, 100 * EXPORT_SCALE);
  });
});

describe("exportFileName", () => {
  it("builds a codefield-prefixed name from owner/repo", () => {
    assert.equal(exportFileName("vercel/next.js"), "codefield-vercel-next.js.png");
  });

  it("collapses unsafe characters to a single dash", () => {
    assert.equal(exportFileName("weird/name with spaces!!"), "codefield-weird-name-with-spaces.png");
  });

  it("trims leading and trailing dashes produced by sanitization", () => {
    assert.equal(exportFileName("/leading-and-trailing/"), "codefield-leading-and-trailing.png");
  });

  it("falls back to a generic name when nothing safe remains", () => {
    assert.equal(exportFileName("   "), "codefield-repository.png");
    assert.equal(exportFileName("!!!"), "codefield-repository.png");
  });
});

describe("composeExport", () => {
  function fakeCanvas(id: string): HTMLCanvasElement {
    return { id } as unknown as HTMLCanvasElement;
  }

  it("fills the background before drawing any layer", () => {
    const calls: string[] = [];
    const target = {
      fillStyle: "",
      fillRect: () => calls.push("fillRect"),
      drawImage: () => calls.push("drawImage"),
    };
    composeExport(target, { nodes: fakeCanvas("nodes") }, { outputWidth: 10, outputHeight: 10 }, [13, 15, 19]);
    assert.deepEqual(calls, ["fillRect", "drawImage"]);
    assert.equal(target.fillStyle, "rgb(13, 15, 19)");
  });

  it("draws layers in Sigma's own z-order, skipping missing ones", () => {
    const drawn: string[] = [];
    const target = {
      fillStyle: "",
      fillRect: () => {},
      drawImage: (canvas: unknown) => drawn.push((canvas as { id: string }).id),
    };
    composeExport(
      target,
      {
        hovers: fakeCanvas("hovers"),
        nodes: fakeCanvas("nodes"),
        edges: fakeCanvas("edges"),
        mouse: fakeCanvas("mouse"),
      },
      { outputWidth: 10, outputHeight: 10 },
      [13, 15, 19],
    );
    assert.deepEqual(drawn, ["edges", "nodes", "hovers"]);
  });
});
