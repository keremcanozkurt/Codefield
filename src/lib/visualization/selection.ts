// The selected file, and the special mode it is in. Impact Mode and Path
// Finder both belong to the selection and exclude each other: entering one
// leaves the other, and choosing another file, or none, leaves both. The
// graph the selection was made in is kept, so a new analysis can decide what
// carries over (see carrySelection).
export type SelectionMode =
  | { type: "none" }
  | { type: "impact" }
  // Path Finder, waiting for the destination file.
  | { type: "choosingPath" }
  | { type: "path"; target: string };

export type Selection<G> = { graph: G; id: string; mode: SelectionMode };

const NONE: SelectionMode = { type: "none" };

// Choosing the file that is already selected keeps the current state, so
// clicking the impact source again does not leave impact mode. While Path
// Finder waits for a destination, choosing another file completes the path
// instead of changing the selection.
export function selectFile<G>(current: Selection<G> | null, graph: G, id: string | null): Selection<G> | null {
  if (id === null) return null;
  if (current !== null && current.graph === graph) {
    if (current.id === id) return current;
    if (current.mode.type === "choosingPath") return { ...current, mode: { type: "path", target: id } };
  }
  return { graph, id, mode: NONE };
}

export function setImpactMode<G>(current: Selection<G> | null, impact: boolean): Selection<G> | null {
  if (current === null) return current;
  if (impact) return current.mode.type === "impact" ? current : { ...current, mode: { type: "impact" } };
  return current.mode.type === "impact" ? { ...current, mode: NONE } : current;
}

export function startPathFinding<G>(current: Selection<G> | null): Selection<G> | null {
  if (current === null || current.mode.type === "choosingPath") return current;
  return { ...current, mode: { type: "choosingPath" } };
}

export function exitPathFinding<G>(current: Selection<G> | null): Selection<G> | null {
  if (current === null || (current.mode.type !== "choosingPath" && current.mode.type !== "path")) return current;
  return { ...current, mode: NONE };
}

export function reversePath<G>(current: Selection<G> | null): Selection<G> | null {
  if (current === null || current.mode.type !== "path") return current;
  return { ...current, id: current.mode.target, mode: { type: "path", target: current.id } };
}

// Escape first leaves a special mode, then the selection.
export function escapeSelection<G>(current: Selection<G> | null): Selection<G> | null {
  if (current === null) return null;
  return current.mode.type === "none" ? null : { ...current, mode: NONE };
}

// Carries a selection into a new analysis of the same repository: the file
// stays selected if it still exists, without its special mode, whose result
// may no longer hold; a file that is gone leaves nothing selected.
export function carrySelection<G>(
  current: Selection<G> | null,
  graph: G,
  exists: (id: string) => boolean,
): Selection<G> | null {
  if (current === null || current.graph === graph) return current;
  return exists(current.id) ? { graph, id: current.id, mode: NONE } : null;
}
