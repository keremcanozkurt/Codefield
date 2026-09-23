import type { SourceLanguage } from "../source-files.ts";
import { EDGE, LANGUAGE_COLORS, NODE, type Rgb } from "./theme.ts";
import type { EdgeAttributes, NodeAttributes, RenderEdge, RenderNode } from "./types.ts";

export type NodeStyle = Pick<NodeAttributes, "size" | "color" | "label">;

const LOG_MIN_BYTES = Math.log2(NODE.minBytes);
const LOG_MAX_BYTES = Math.log2(NODE.maxBytes);

// Source files range from a few bytes to hundreds of kilobytes, so the radius
// follows log2 of the byte count. The bounds are fixed rather than taken from
// the repository, so a file keeps its size when other files are added.
export function fileSizeToNodeSize(bytes: number): number {
  if (!(bytes > 1)) return NODE.minSize;
  const t = unitRange(Math.log2(bytes), LOG_MIN_BYTES, LOG_MAX_BYTES);
  return NODE.minSize + (NODE.maxSize - NODE.minSize) * t;
}

// 0 for isolated files, rising quickly over the first few edges and capped at
// NODE.degreeReference, so degree adds presence without turning hubs into the
// largest shapes on the canvas.
export function degreeEmphasis(degree: number): number {
  if (!(degree > 0)) return 0;
  return Math.min(1, Math.log1p(degree) / Math.log1p(NODE.degreeReference));
}

export function nodeSize(bytes: number, degree: number): number {
  return fileSizeToNodeSize(bytes) * (1 + NODE.degreeSizeBoost * degreeEmphasis(degree));
}

export function languageColors(language: SourceLanguage): { quiet: Rgb; bright: Rgb } {
  return LANGUAGE_COLORS[language];
}

export function nodeColor(language: SourceLanguage, emphasis: number): string {
  const { quiet, bright } = languageColors(language);
  return toHex(mix(quiet, bright, emphasis));
}

export function edgeEmphasis(weight: number): number {
  if (!(weight > 1)) return 0;
  return Math.min(1, Math.log2(weight) / Math.log2(EDGE.weightReference));
}

export function edgeSize(weight: number): number {
  return EDGE.minSize + (EDGE.maxSize - EDGE.minSize) * edgeEmphasis(weight);
}

export function edgeOpacity(weight: number): number {
  return EDGE.minOpacity + (EDGE.maxOpacity - EDGE.minOpacity) * edgeEmphasis(weight);
}

export function edgeColor(weight: number): string {
  return premultiplied(EDGE.color, edgeOpacity(weight));
}

export function fileName(path: string): string {
  return path.slice(path.lastIndexOf("/") + 1);
}

export function nodeStyle(node: RenderNode): NodeStyle {
  const emphasis = degreeEmphasis(node.degree);
  return {
    size: nodeSize(node.size, node.degree),
    color: nodeColor(node.language, emphasis),
    label: fileName(node.path),
  };
}

export function edgeStyle(edge: RenderEdge): EdgeAttributes {
  return { size: edgeSize(edge.weight), color: edgeColor(edge.weight) };
}

export function hoveredNodeStyle<T extends NodeStyle>(attributes: T): T {
  return {
    ...attributes,
    size: attributes.size * NODE.hoverSizeScale,
    color: toHex(mix(fromHex(attributes.color), [255, 255, 255], NODE.hoverLighten)),
  };
}

export function hoveredEdgeStyle<T extends EdgeAttributes>(attributes: T): T {
  return {
    ...attributes,
    size: Math.max(attributes.size, EDGE.hoverSize),
    color: premultiplied(EDGE.hoverColor, EDGE.hoverOpacity),
  };
}

// Sigma blends with premultiplied alpha: the color channels have to be
// multiplied by the opacity already, or a translucent edge renders at full
// brightness.
export function premultiplied(rgb: Rgb, opacity: number): string {
  const [r, g, b] = rgb.map((channel) => Math.round(channel * opacity));
  return `rgba(${r}, ${g}, ${b}, ${round(opacity, 3)})`;
}

function unitRange(value: number, min: number, max: number): number {
  return Math.min(1, Math.max(0, (value - min) / (max - min)));
}

function mix(from: Rgb, to: Rgb, amount: number): Rgb {
  const t = Math.min(1, Math.max(0, amount));
  return [0, 1, 2].map((i) => Math.round(from[i] + (to[i] - from[i]) * t)) as unknown as Rgb;
}

function toHex(rgb: Rgb): string {
  return `#${rgb.map((channel) => channel.toString(16).padStart(2, "0")).join("")}`;
}

function fromHex(color: string): Rgb {
  const value = Number.parseInt(color.slice(1), 16);
  return [(value >> 16) & 0xff, (value >> 8) & 0xff, value & 0xff];
}

function round(value: number, digits: number): number {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}
