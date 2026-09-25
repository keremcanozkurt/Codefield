import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { selectFile, setImpactMode } from "./selection.ts";

const graph = { name: "first" };
const other = { name: "second" };

describe("selection and impact mode", () => {
  it("starts a new selection without impact mode", () => {
    assert.deepEqual(selectFile(null, graph, "a.ts"), { graph, id: "a.ts", impact: false });
  });

  it("turns impact mode on and off for the selected file", () => {
    const traced = setImpactMode(selectFile(null, graph, "a.ts"), true);

    assert.deepEqual(traced, { graph, id: "a.ts", impact: true });
    assert.deepEqual(setImpactMode(traced, false), { graph, id: "a.ts", impact: false });
    assert.equal(setImpactMode(traced, true), traced);
    assert.equal(setImpactMode(null, true), null);
  });

  it("leaves impact mode when another file is selected", () => {
    const traced = setImpactMode(selectFile(null, graph, "a.ts"), true);

    assert.deepEqual(selectFile(traced, graph, "b.ts"), { graph, id: "b.ts", impact: false });
  });

  it("keeps impact mode when the same file is selected again", () => {
    const traced = setImpactMode(selectFile(null, graph, "a.ts"), true);

    assert.equal(selectFile(traced, graph, "a.ts"), traced);
  });

  it("clears impact mode with the selection", () => {
    const traced = setImpactMode(selectFile(null, graph, "a.ts"), true);

    assert.equal(selectFile(traced, graph, null), null);
  });

  it("starts over for a new analysis, even for the same path", () => {
    const traced = setImpactMode(selectFile(null, graph, "a.ts"), true);

    assert.deepEqual(selectFile(traced, other, "a.ts"), { graph: other, id: "a.ts", impact: false });
  });
});
