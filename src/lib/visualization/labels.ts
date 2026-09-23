import type { NodeLabelDrawingFunction } from "sigma/rendering";

import { LABEL } from "./theme.ts";
import type { EdgeAttributes, NodeAttributes } from "./types.ts";

const PADDING_X = 4;
const PADDING_Y = 3;
const GAP = 4;

// Replaces Sigma's default hover drawing, which puts the label on a white box.
export const drawHoverLabel: NodeLabelDrawingFunction<NodeAttributes, EdgeAttributes> = (
  context,
  data,
  settings,
) => {
  if (!data.label) return;

  const size = settings.labelSize;
  context.font = `${settings.labelWeight} ${size}px ${settings.labelFont}`;
  const width = context.measureText(data.label).width;
  const x = data.x + data.size + GAP;
  const top = data.y - size / 2 - PADDING_Y;

  context.fillStyle = LABEL.hoverBackground;
  context.fillRect(x - PADDING_X, top, width + PADDING_X * 2, size + PADDING_Y * 2);

  context.fillStyle = LABEL.hoverColor;
  context.fillText(data.label, x, data.y + size / 3);
};
