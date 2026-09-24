import type { Settings } from "sigma/settings";

import { drawHoverLabel } from "./labels.ts";
import { EDGE, LABEL } from "./theme.ts";
import type { EdgeAttributes, NodeAttributes } from "./types.ts";

export const RENDERER_SETTINGS = {
  defaultEdgeType: "arrow",
  minEdgeThickness: EDGE.minSize,
  labelFont: LABEL.font,
  labelSize: LABEL.size,
  labelWeight: "normal",
  labelColor: { color: LABEL.color },
  labelRenderedSizeThreshold: LABEL.renderedSizeThreshold,
  labelGridCellSize: LABEL.gridCellSize,
  labelDensity: 1,
  defaultDrawNodeHover: drawHoverLabel,
  // Lets the selected file and its edges draw above the faded rest of the graph.
  zIndex: true,
} satisfies Partial<Settings<NodeAttributes, EdgeAttributes>>;
