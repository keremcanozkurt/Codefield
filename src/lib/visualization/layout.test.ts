import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { layoutNodes } from "./layout.ts";

function paths(count: number): string[] {
  return Array.from({ length: count }, (_, i) => `src/module-${i % 17}/file-${i}.ts`);
}

describe("layoutNodes", () => {
  it("gives every node finite coordinates inside the unit disk", () => {
    const positions = layoutNodes(paths(50));

    assert.equal(positions.size, 50);
    for (const { x, y } of positions.values()) {
      assert.ok(Number.isFinite(x) && Number.isFinite(y));
      assert.ok(Math.hypot(x, y) <= 1);
    }
  });

  it("returns the same coordinates for the same nodes", () => {
    assert.deepEqual(layoutNodes(paths(40)), layoutNodes(paths(40)));
  });

  it("does not depend on input order", () => {
    const ids = paths(40);
    const forward = layoutNodes(ids);
    const reversed = layoutNodes([...ids].reverse());

    for (const id of ids) assert.deepEqual(reversed.get(id), forward.get(id));
  });

  it("keeps a node's position when other nodes are added", () => {
    const small = layoutNodes(["src/a.ts", "src/b.ts"]);
    const large = layoutNodes(["src/a.ts", "src/b.ts", ...paths(30)]);

    assert.deepEqual(large.get("src/a.ts"), small.get("src/a.ts"));
    assert.deepEqual(large.get("src/b.ts"), small.get("src/b.ts"));
  });

  it("places a single node", () => {
    const positions = layoutNodes(["index.ts"]);

    assert.equal(positions.size, 1);
    const { x, y } = positions.get("index.ts")!;
    assert.ok(Number.isFinite(x) && Number.isFinite(y));
  });

  it("places two nodes at different positions", () => {
    const positions = layoutNodes(["src/a.ts", "src/b.ts"]);

    assert.equal(positions.size, 2);
    assert.notDeepEqual(positions.get("src/a.ts"), positions.get("src/b.ts"));
  });

  it("places 500 nodes without overlapping any two", () => {
    const positions = layoutNodes(paths(500));

    assert.equal(positions.size, 500);
    const keys = new Set([...positions.values()].map(({ x, y }) => `${x},${y}`));
    assert.equal(keys.size, 500);
  });

  it("spreads nodes over the disk", () => {
    const positions = [...layoutNodes(paths(500)).values()];
    const inner = positions.filter(({ x, y }) => Math.hypot(x, y) < Math.SQRT1_2).length;
    const right = positions.filter(({ x }) => x > 0).length;

    // Half of the disk's area lies within radius 1/sqrt(2), and half to the right of the y-axis.
    assert.ok(inner > 200 && inner < 300, `inner: ${inner}`);
    assert.ok(right > 200 && right < 300, `right: ${right}`);
  });

  it("returns an empty map for no nodes", () => {
    assert.equal(layoutNodes([]).size, 0);
  });

  it("does not depend on locale-sensitive APIs", () => {
    const ids = ["src/ä.ts", "src/Z.ts", "src/a.ts", "src/é/ß.tsx", "src/日本.js"];
    const expected = layoutNodes(ids);

    const localeCompare = String.prototype.localeCompare;
    const toLocaleString = Number.prototype.toLocaleString;
    String.prototype.localeCompare = () => {
      throw new Error("localeCompare called");
    };
    Number.prototype.toLocaleString = () => {
      throw new Error("toLocaleString called");
    };
    try {
      assert.deepEqual(layoutNodes(ids), expected);
    } finally {
      String.prototype.localeCompare = localeCompare;
      Number.prototype.toLocaleString = toLocaleString;
    }
  });

  it("does not modify its input", () => {
    const ids = Object.freeze(paths(10));
    const copy = [...ids];

    layoutNodes(ids);
    assert.deepEqual([...ids], copy);
  });
});
