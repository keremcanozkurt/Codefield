import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  carrySelection,
  escapeSelection,
  exitPathFinding,
  reversePath,
  selectFile,
  setImpactMode,
  startPathFinding,
} from "./selection.ts";

const graph = { name: "first" };
const other = { name: "second" };
const none = { type: "none" } as const;

describe("selection and impact mode", () => {
  it("starts a new selection without a special mode", () => {
    assert.deepEqual(selectFile(null, graph, "a.ts"), { graph, id: "a.ts", mode: none });
  });

  it("turns impact mode on and off for the selected file", () => {
    const traced = setImpactMode(selectFile(null, graph, "a.ts"), true);

    assert.deepEqual(traced, { graph, id: "a.ts", mode: { type: "impact" } });
    assert.deepEqual(setImpactMode(traced, false), { graph, id: "a.ts", mode: none });
    assert.equal(setImpactMode(traced, true), traced);
    assert.equal(setImpactMode(null, true), null);
  });

  it("leaves impact mode when another file is selected", () => {
    const traced = setImpactMode(selectFile(null, graph, "a.ts"), true);

    assert.deepEqual(selectFile(traced, graph, "b.ts"), { graph, id: "b.ts", mode: none });
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
    const choosing = startPathFinding(selectFile(null, graph, "a.ts"));

    assert.deepEqual(selectFile(traced, other, "a.ts"), { graph: other, id: "a.ts", mode: none });
    assert.deepEqual(selectFile(choosing, other, "b.ts"), { graph: other, id: "b.ts", mode: none });
  });
});

describe("selection and Path Finder", () => {
  const selected = selectFile(null, graph, "a.ts");

  it("completes the path with the next file chosen, keeping the source selected", () => {
    const choosing = startPathFinding(selected);

    assert.deepEqual(choosing, { graph, id: "a.ts", mode: { type: "choosingPath" } });
    assert.deepEqual(selectFile(choosing, graph, "d.ts"), { graph, id: "a.ts", mode: { type: "path", target: "d.ts" } });
    assert.equal(selectFile(choosing, graph, "a.ts"), choosing);
  });

  it("leaves the path when another file is selected afterwards", () => {
    const shown = selectFile(startPathFinding(selected), graph, "d.ts");

    assert.deepEqual(selectFile(shown, graph, "c.ts"), { graph, id: "c.ts", mode: none });
  });

  it("excludes Impact Mode, in both directions", () => {
    const traced = setImpactMode(selected, true);
    const choosing = startPathFinding(traced);

    assert.deepEqual(choosing?.mode, { type: "choosingPath" });
    assert.deepEqual(setImpactMode(choosing, true)?.mode, { type: "impact" });
    assert.deepEqual(setImpactMode(selectFile(choosing, graph, "d.ts"), true)?.mode, { type: "impact" });
  });

  it("exits and reverses a path", () => {
    const shown = selectFile(startPathFinding(selected), graph, "d.ts");

    assert.deepEqual(exitPathFinding(shown), { graph, id: "a.ts", mode: none });
    assert.deepEqual(exitPathFinding(startPathFinding(selected)), { graph, id: "a.ts", mode: none });
    assert.equal(exitPathFinding(selected), selected);
    assert.deepEqual(reversePath(shown), { graph, id: "d.ts", mode: { type: "path", target: "a.ts" } });
  });

  it("uses Escape to leave the mode first, then the selection", () => {
    const shown = selectFile(startPathFinding(selected), graph, "d.ts");

    assert.deepEqual(escapeSelection(startPathFinding(selected)), { graph, id: "a.ts", mode: none });
    assert.deepEqual(escapeSelection(shown), { graph, id: "a.ts", mode: none });
    assert.deepEqual(escapeSelection(setImpactMode(selected, true)), { graph, id: "a.ts", mode: none });
    assert.equal(escapeSelection(selected), null);
    assert.equal(escapeSelection(null), null);
  });
});

describe("carrySelection", () => {
  const next = { name: "reanalyzed" };
  const exists = (id: string) => id !== "deleted.ts";

  it("keeps a file that still exists after a new analysis, leaving its mode", () => {
    const traced = setImpactMode(selectFile(null, graph, "a.ts"), true);

    assert.deepEqual(carrySelection(traced, next, exists), { graph: next, id: "a.ts", mode: none });
  });

  it("clears a file that no longer exists", () => {
    assert.equal(carrySelection(selectFile(null, graph, "deleted.ts"), next, exists), null);
  });

  it("changes nothing within the same analysis", () => {
    const selected = startPathFinding(selectFile(null, graph, "a.ts"));

    assert.equal(carrySelection(selected, graph, exists), selected);
    assert.equal(carrySelection(null, next, exists), null);
  });
});
