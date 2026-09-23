import type { SourceLanguage } from "../source-files.ts";

export type Rgb = readonly [number, number, number];

export const NODE = {
  minSize: 2.5,
  maxSize: 8,
  // Files at or below minBytes get minSize, files at or above maxBytes get maxSize.
  minBytes: 128,
  maxBytes: 64 * 1024,
  // Degree at which connection emphasis stops increasing.
  degreeReference: 24,
  // Largest size increase from connections, as a fraction of the file-size radius.
  degreeSizeBoost: 0.2,
  hoverSizeScale: 1.25,
  // Share of white mixed into the color of a hovered node.
  hoverLighten: 0.5,
} as const;

// Isolated files use `quiet`; connected files move towards `bright`.
export const LANGUAGE_COLORS: Record<SourceLanguage, { quiet: Rgb; bright: Rgb }> = {
  typescript: { quiet: [112, 124, 140], bright: [190, 202, 217] },
  javascript: { quiet: [140, 131, 115], bright: [216, 205, 182] },
};

export const EDGE = {
  color: [172, 177, 186] as Rgb,
  minOpacity: 0.22,
  maxOpacity: 0.42,
  minSize: 0.8,
  maxSize: 1.4,
  // Weight at which edge emphasis stops increasing.
  weightReference: 8,
  hoverColor: [214, 218, 225] as Rgb,
  hoverOpacity: 0.55,
  hoverSize: 1.4,
} as const;

export const LABEL = {
  font: "ui-sans-serif, system-ui, sans-serif",
  size: 11,
  color: "#9d9b95",
  hoverColor: "#eeede8",
  // The graph background (--color-surface) with some transparency.
  hoverBackground: "rgba(13, 15, 19, 0.88)",
  // Rendered radius in pixels a node needs before its label is considered.
  renderedSizeThreshold: 6,
  // Sigma shows at most one label per grid cell at the default zoom.
  gridCellSize: 140,
} as const;
