import type { Rgb } from "./theme.ts";

// Device pixels per viewport CSS pixel the export targets.
export const EXPORT_SCALE = 2;
// Guards against an export canvas large enough to exhaust memory on an
// unusually large or zoomed-out viewport.
export const EXPORT_MAX_DIMENSION = 8192;
export const EXPORT_MAX_PIXELS = 36_000_000;

export type ExportDimensions = {
  // The exported PNG's size, in device pixels.
  outputWidth: number;
  outputHeight: number;
  // The CSS size an offscreen container needs so that Sigma's own
  // devicePixelRatio scaling produces a canvas backing store of exactly
  // outputWidth x outputHeight.
  containerWidth: number;
  containerHeight: number;
};

// Derives export dimensions from the live viewport's CSS size, targeting
// EXPORT_SCALE device pixels per CSS pixel. Scales the whole export down,
// preserving aspect ratio, if that would exceed EXPORT_MAX_DIMENSION on
// either side or EXPORT_MAX_PIXELS in total. Returns null for a viewport
// with no visible area.
export function computeExportDimensions(
  viewportWidth: number,
  viewportHeight: number,
  devicePixelRatio: number,
): ExportDimensions | null {
  if (!(viewportWidth > 0) || !(viewportHeight > 0)) return null;
  const dpr = devicePixelRatio > 0 ? devicePixelRatio : 1;

  const rawWidth = viewportWidth * EXPORT_SCALE;
  const rawHeight = viewportHeight * EXPORT_SCALE;
  const dimensionGuard = EXPORT_MAX_DIMENSION / Math.max(rawWidth, rawHeight);
  const pixelGuard = Math.sqrt(EXPORT_MAX_PIXELS / (rawWidth * rawHeight));
  const guard = Math.min(1, dimensionGuard, pixelGuard);

  const outputWidth = Math.max(1, Math.round(rawWidth * guard));
  const outputHeight = Math.max(1, Math.round(rawHeight * guard));

  return {
    outputWidth,
    outputHeight,
    containerWidth: outputWidth / dpr,
    containerHeight: outputHeight / dpr,
  };
}

// The z-order Sigma creates its layer canvases in. "mouse" is interaction
// only and carries nothing to draw.
const CANVAS_LAYER_ORDER = ["edges", "edgeLabels", "nodes", "labels", "hovers"] as const;

type DrawableContext = Pick<CanvasRenderingContext2D, "fillStyle" | "fillRect" | "drawImage">;

// Paints the background and every Sigma layer canvas, in Sigma's own
// rendering order, onto a target 2D context. Takes the context directly
// (rather than a <canvas>) so it can be exercised with a recording fake.
export function composeExport(
  target: DrawableContext,
  canvases: Partial<Record<string, HTMLCanvasElement>>,
  dimensions: Pick<ExportDimensions, "outputWidth" | "outputHeight">,
  background: Rgb,
): void {
  target.fillStyle = `rgb(${background[0]}, ${background[1]}, ${background[2]})`;
  target.fillRect(0, 0, dimensions.outputWidth, dimensions.outputHeight);
  for (const layer of CANVAS_LAYER_ORDER) {
    const canvas = canvases[layer];
    if (canvas !== undefined) target.drawImage(canvas, 0, 0, dimensions.outputWidth, dimensions.outputHeight);
  }
}

// codefield-<repository>.png, with anything outside a conservative
// filename-safe set collapsed to a single "-".
export function exportFileName(repositoryName: string): string {
  const sanitized = repositoryName
    .trim()
    .replace(/[^a-zA-Z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return `codefield-${sanitized === "" ? "repository" : sanitized}.png`;
}
