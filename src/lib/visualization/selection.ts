// The selected file and whether impact mode is on for it. Impact mode belongs
// to the selection: choosing another file, or none, turns it off. The graph is
// kept so a new analysis starts without a selection even if a file with the
// same path exists.
export type Selection<G> = { graph: G; id: string; impact: boolean };

// Choosing the file that is already selected keeps the current state, so
// clicking the impact source again does not leave impact mode.
export function selectFile<G>(current: Selection<G> | null, graph: G, id: string | null): Selection<G> | null {
  if (id === null) return null;
  if (current !== null && current.graph === graph && current.id === id) return current;
  return { graph, id, impact: false };
}

export function setImpactMode<G>(current: Selection<G> | null, impact: boolean): Selection<G> | null {
  if (current === null || current.impact === impact) return current;
  return { ...current, impact };
}
