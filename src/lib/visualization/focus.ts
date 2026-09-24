import type { Neighborhood } from "./inspection.ts";
import type { Frame } from "./layout.ts";
import { blend, hoveredEdgeStyle, hoveredNodeStyle, premultiplied } from "./mapping.ts";
import { EDGE, FOCUS, SURFACE } from "./theme.ts";
import type { EdgeAttributes, NodeAttributes } from "./types.ts";

// What the renderer reducers need besides the stored attributes. Kept outside
// React state: hover changes on every pointer move.
export type FocusState = {
  neighborhood: Neighborhood | null;
  hovered: string | null;
  // Whether every file is labelled, for very small graphs.
  labelAll: boolean;
  // Files that pass the active graph filters, or null when no filter is
  // active. A filtered-out node or edge is hidden rather than removed, so the
  // layout never recomputes when filters change.
  visible: Set<string> | null;
};

export function labelsAllFiles(nodeCount: number): boolean {
  return nodeCount <= FOCUS.labelledGraphSize;
}

export type NodeDisplay = Omit<NodeAttributes, "label"> & {
  label: string | null;
  highlighted?: boolean;
  forceLabel?: boolean;
  zIndex?: number;
  hidden?: boolean;
};

export type EdgeDisplay = EdgeAttributes & { zIndex?: number; hidden?: boolean };

export type NodeRole = "selected" | "neighbor" | "context";

export function nodeRole(neighborhood: Neighborhood, id: string): NodeRole {
  if (id === neighborhood.selected) return "selected";
  return neighborhood.neighbors.has(id) ? "neighbor" : "context";
}

// Without a selection, hover behaves as before. With one, the selection sets
// the look of every node and hover only adds a label, so moving the pointer
// never changes which files appear related.
export function focusNode(id: string, data: NodeAttributes, state: FocusState): NodeDisplay {
  const { neighborhood, hovered, labelAll, visible } = state;
  if (visible !== null && !visible.has(id)) {
    return { ...data, hidden: true };
  }
  if (neighborhood === null) {
    const base = labelAll ? { ...data, forceLabel: true } : data;
    return id === hovered ? hoveredNodeStyle(base) : base;
  }

  const isHovered = id === hovered;
  switch (nodeRole(neighborhood, id)) {
    case "selected":
      return {
        ...data,
        size: data.size * FOCUS.selectedSizeScale,
        color: blend(data.color, [255, 255, 255], FOCUS.selectedLighten),
        highlighted: true,
        zIndex: 2,
      };
    case "neighbor":
      return {
        ...data,
        color: blend(data.color, [255, 255, 255], FOCUS.neighborLighten),
        forceLabel: labelAll || neighborhood.neighbors.size <= FOCUS.labelledNeighbors,
        highlighted: isHovered,
        zIndex: 1,
      };
    case "context":
      return isHovered
        ? { ...data, highlighted: true, zIndex: 0 }
        : { ...data, color: blend(data.color, SURFACE, FOCUS.contextFade), label: null, zIndex: 0 };
  }
}

export function focusEdge(
  source: string,
  target: string,
  data: EdgeAttributes,
  state: FocusState,
): EdgeDisplay {
  const { neighborhood, hovered, visible } = state;
  if (visible !== null && (!visible.has(source) || !visible.has(target))) {
    return { ...data, hidden: true };
  }
  if (neighborhood === null) {
    return hovered !== null && (source === hovered || target === hovered) ? hoveredEdgeStyle(data) : data;
  }
  if (source === neighborhood.selected || target === neighborhood.selected) {
    return { ...hoveredEdgeStyle(data), zIndex: 1 };
  }
  return {
    ...data,
    size: EDGE.minSize,
    color: premultiplied(EDGE.color, FOCUS.contextEdgeOpacity),
    zIndex: 0,
  };
}

export const CAMERA = {
  // Share of the frame a small layout should span at the initial zoom.
  targetFill: 0.6,
  // The closest initial zoom. Sigma draws nodes larger as the ratio drops,
  // so tiny repositories also get larger stars, not only wider spacing.
  minInitialRatio: 0.25,
  // Focusing a file does not zoom graphs of up to focusNodes files. Larger
  // ones zoom in with the square root of their size, to at most focusRatio.
  focusNodes: 60,
  focusRatio: 0.45,
  // Double-clicking a file zooms by this factor, down to minRatio.
  closerFactor: 0.5,
  minRatio: 0.08,
  // A file clicked in the graph only pulls the camera when it lies within
  // this share of the viewport from an edge.
  edgeMargin: 0.12,
  duration: 260,
} as const;

// Sigma frames the layout's `frame` at ratio 1. Small layouts leave most of
// that frame empty, so they start zoomed in until they span about
// CAMERA.targetFill of it. Larger layouts start at ratio 1.
export function initialCameraRatio(bounds: Frame, frame: Frame): number {
  const fill = Math.max(
    (bounds.x[1] - bounds.x[0]) / (frame.x[1] - frame.x[0]),
    (bounds.y[1] - bounds.y[0]) / (frame.y[1] - frame.y[0]),
  );
  if (!(fill > 0)) return 1;
  return clamp(fill / CAMERA.targetFill, CAMERA.minInitialRatio, 1);
}

// The ratio to use when bringing a file into focus. It never zooms out, and
// zooms in only on graphs dense enough for neighbouring stars to crowd.
export function focusRatio(currentRatio: number, nodeCount: number, initialRatio: number): number {
  const wanted = clamp(Math.sqrt(CAMERA.focusNodes / Math.max(nodeCount, 1)), CAMERA.focusRatio, 1);
  return clamp(Math.min(currentRatio, wanted, initialRatio), CAMERA.minRatio, 1);
}

export function closerRatio(currentRatio: number): number {
  return Math.max(currentRatio * CAMERA.closerFactor, CAMERA.minRatio);
}

export function isComfortablyVisible(
  point: { x: number; y: number },
  size: { width: number; height: number },
): boolean {
  const marginX = size.width * CAMERA.edgeMargin;
  const marginY = size.height * CAMERA.edgeMargin;
  return (
    point.x >= marginX &&
    point.x <= size.width - marginX &&
    point.y >= marginY &&
    point.y <= size.height - marginY
  );
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}
