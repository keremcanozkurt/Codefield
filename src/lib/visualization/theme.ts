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

// --color-surface, the graph background.
export const SURFACE: Rgb = [13, 15, 19];

// Appearance while a file is selected. Everything derives from the language
// colors; files outside the selection are mixed towards the background rather
// than made transparent, so they stay visible without blending into edges.
export const FOCUS = {
  selectedSizeScale: 1.4,
  // Share of white mixed into the selected file and its neighbours.
  selectedLighten: 0.55,
  neighborLighten: 0.2,
  // Share of the background mixed into files outside the selection.
  contextFade: 0.7,
  contextEdgeOpacity: 0.05,
  // Neighbours always show their labels when there are at most this many.
  labelledNeighbors: 16,
  // Graphs with at most this many files label every file; there is room.
  labelledGraphSize: 12,
} as const;

// Appearance in impact mode. Depth is shown through brightness only: files
// move from slightly lighter than their own color at depth 1 towards the
// background as depth grows, but never as far as FOCUS.contextFade, so every
// potentially affected file stays distinguishable from unaffected ones.
export const IMPACT = {
  // Strength is 1 at depth 1 and keeps this share per further level, down to
  // minStrength.
  depthFalloff: 0.65,
  minStrength: 0.25,
  // Share of white mixed into a file at full strength.
  lighten: 0.3,
  // Share of the background mixed into a file at zero strength.
  fade: 0.5,
  edgeMinOpacity: 0.2,
  edgeMaxOpacity: 0.6,
  // Potentially affected files always show their labels when there are at
  // most this many; otherwise only direct dependents do, under the same limit.
  labelledFiles: 16,
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
