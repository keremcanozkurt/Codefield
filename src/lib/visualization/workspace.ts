import type { SelectionMode } from "./selection.ts";
import { canonicalFocus, survivingFocus, type StructureTree } from "./structure.ts";

export type WorkspaceView = "graph" | "structure";

export type EscapeTarget = "immersive" | "mode" | "selection" | null;

// What Escape undoes, from the outside in:
// 1. full screen, because a browser in full screen handles Escape itself and
//    leaves full screen first, so the in-app fallback behaves the same way;
// 2. Impact Mode or Path Finder, including choosing a path's destination;
// 3. the selection.
// Search handles Escape itself while it has text or open results.
export function escapeTarget(state: {
  immersive: boolean;
  mode: SelectionMode["type"] | null;
  hasSelection: boolean;
}): EscapeTarget {
  if (state.immersive) return "immersive";
  if (state.mode !== null && state.mode !== "none") return "mode";
  if (state.hasSelection) return "selection";
  return null;
}

// Where Structure opens: at the selected file's directory when there is a
// selection, so switching views keeps the file in sight, otherwise wherever
// Structure last was, or its nearest surviving ancestor after a new analysis.
export function structureFocusFor(tree: StructureTree, selected: string | null, previous: string): string {
  if (selected !== null) {
    const directory = tree.fileDirectory.get(selected);
    if (directory !== undefined) return canonicalFocus(tree, directory);
  }
  return survivingFocus(tree, previous);
}

// Impact Mode and Path Finder draw on the graph, so starting either from
// Structure switches to the graph rather than drawing them a second way.
export function viewForMode(mode: SelectionMode["type"], current: WorkspaceView): WorkspaceView {
  return mode === "impact" || mode === "choosingPath" || mode === "path" ? "graph" : current;
}
