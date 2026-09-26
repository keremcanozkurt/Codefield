import { propagationDepth, type Impact } from "./impact.ts";
import type { Neighborhood } from "./inspection.ts";
import { pathEdgeKey, type PathView } from "./path.ts";
import type { Frame } from "./layout.ts";
import { blend, hoveredEdgeStyle, hoveredNodeStyle, premultiplied } from "./mapping.ts";
import { EDGE, FOCUS, IMPACT, SURFACE } from "./theme.ts";
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
  // Set while impact mode is on for the selected file; it then decides the
  // look of every node and edge instead of the neighbourhood.
  impact?: Impact | null;
  // Set while Path Finder shows a path (or its absence); it then decides the
  // look of every node and edge, before impact or the neighbourhood.
  path?: PathView | null;
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

// With a selection, the selection sets the look of every node and hover only
// adds a label, so moving the pointer never changes which files appear related.
export function focusNode(id: string, data: NodeAttributes, state: FocusState): NodeDisplay {
  const { neighborhood, hovered, labelAll, visible } = state;
  if (visible !== null && !visible.has(id)) {
    return { ...data, hidden: true };
  }
  if (state.path) return pathNode(id, data, state.path, id === hovered);
  if (state.impact) return impactNode(id, data, state.impact, id === hovered, labelAll);
  if (neighborhood === null) {
    const base = labelAll ? { ...data, forceLabel: true } : data;
    return id === hovered ? hoveredNodeStyle(base) : base;
  }

  const isHovered = id === hovered;
  switch (nodeRole(neighborhood, id)) {
    case "selected":
      return selectedNode(data);
    case "neighbor":
      return {
        ...data,
        color: blend(data.color, [255, 255, 255], FOCUS.neighborLighten),
        forceLabel: labelAll || neighborhood.neighbors.size <= FOCUS.labelledNeighbors,
        highlighted: isHovered,
        zIndex: 1,
      };
    case "context":
      return contextNode(data, isHovered);
  }
}

function selectedNode(data: NodeAttributes): NodeDisplay {
  return {
    ...data,
    size: data.size * FOCUS.selectedSizeScale,
    color: blend(data.color, [255, 255, 255], FOCUS.selectedLighten),
    highlighted: true,
    zIndex: 2,
  };
}

function contextNode(data: NodeAttributes, isHovered: boolean): NodeDisplay {
  return isHovered
    ? { ...data, highlighted: true, zIndex: 0 }
    : { ...data, color: blend(data.color, SURFACE, FOCUS.contextFade), label: null, zIndex: 0 };
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
  if (state.path) {
    if (!state.path.edges.has(pathEdgeKey(source, target))) return contextEdge(data);
    return { ...hoveredEdgeStyle(data), size: Math.max(data.size, EDGE.hoverSize) * 1.25, zIndex: 2 };
  }
  if (state.impact) {
    const depth = propagationDepth(state.impact, source, target);
    return depth === null ? contextEdge(data) : impactEdge(data, depth);
  }
  if (neighborhood === null) {
    return hovered !== null && (source === hovered || target === hovered) ? hoveredEdgeStyle(data) : data;
  }
  if (source === neighborhood.selected || target === neighborhood.selected) {
    return { ...hoveredEdgeStyle(data), zIndex: 1 };
  }
  return contextEdge(data);
}

function contextEdge(data: EdgeAttributes): EdgeDisplay {
  return {
    ...data,
    size: EDGE.minSize,
    color: premultiplied(EDGE.color, FOCUS.contextEdgeOpacity),
    zIndex: 0,
  };
}

// The path's ends look like a selected file, the files between like
// neighbours of a selection; everything else is faded context.
function pathNode(id: string, data: NodeAttributes, path: PathView, isHovered: boolean): NodeDisplay {
  if (id === path.source || id === path.target) return { ...selectedNode(data), forceLabel: true };
  if (!path.order.has(id)) return contextNode(data, isHovered);
  return {
    ...data,
    color: blend(data.color, [255, 255, 255], FOCUS.neighborLighten),
    forceLabel: true,
    highlighted: isHovered,
    zIndex: 1,
  };
}

// 1 for direct dependents, lower for each further level of dependency depth.
export function impactStrength(depth: number): number {
  if (!(depth >= 1)) return 0;
  return Math.max(IMPACT.minStrength, IMPACT.depthFalloff ** (depth - 1));
}

// The impact source looks like a selected file. Potentially affected files keep
// their own color, lightened or faded by depth; everything else is faded like
// the context of a selection. Hover only adds a label, as with a selection.
function impactNode(id: string, data: NodeAttributes, impact: Impact, isHovered: boolean, labelAll: boolean): NodeDisplay {
  if (id === impact.source) return selectedNode(data);
  const depth = impact.depths.get(id);
  if (depth === undefined) return contextNode(data, isHovered);
  const strength = impactStrength(depth);
  const direct = impact.levels[0].length;
  return {
    ...data,
    color: blend(blend(data.color, [255, 255, 255], IMPACT.lighten * strength), SURFACE, IMPACT.fade * (1 - strength)),
    forceLabel:
      labelAll ||
      impact.depths.size <= IMPACT.labelledFiles ||
      (depth === 1 && direct <= IMPACT.labelledFiles),
    highlighted: isHovered,
    zIndex: 1,
  };
}

function impactEdge(data: EdgeAttributes, depth: number): EdgeDisplay {
  const strength = impactStrength(depth);
  return {
    ...data,
    size: EDGE.minSize + (EDGE.hoverSize - EDGE.minSize) * strength,
    color: premultiplied(EDGE.hoverColor, IMPACT.edgeMinOpacity + (IMPACT.edgeMaxOpacity - IMPACT.edgeMinOpacity) * strength),
    zIndex: 1,
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
