import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { edgeId } from "../graph/build.ts";
import { layoutConstellation, type ConstellationLayout, type Position } from "./layout.ts";
import { nodeSize } from "./mapping.ts";
import type { RenderEdge, RenderGraph, RenderNode } from "./types.ts";

function node(path: string, size = 2_000, degree = 0): RenderNode {
  const slash = path.lastIndexOf("/");
  return {
    id: path,
    path,
    directory: slash === -1 ? "" : path.slice(0, slash),
    language: /\.tsx?$/.test(path) ? "typescript" : "javascript",
    size,
    incoming: 0,
    outgoing: 0,
    degree,
  };
}

function edge(source: string, target: string, weight = 1): RenderEdge {
  return { id: edgeId(source, target), source, target, weight, kinds: ["import"] };
}

// Sets each node's degree from the edges, as the dependency graph does.
function graphOf(nodes: RenderNode[], edges: RenderEdge[] = []): RenderGraph {
  const degree = new Map<string, number>();
  for (const e of edges) {
    degree.set(e.source, (degree.get(e.source) ?? 0) + 1);
    degree.set(e.target, (degree.get(e.target) ?? 0) + 1);
  }
  return { nodes: nodes.map((n) => ({ ...n, degree: degree.get(n.id) ?? 0 })), edges };
}

function files(directory: string, count: number, size = 2_000): RenderNode[] {
  const prefix = directory === "" ? "" : `${directory}/`;
  return Array.from({ length: count }, (_, i) =>
    node(`${prefix}file-${String(i).padStart(3, "0")}.ts`, size + ((i * 7919) % 6_000)),
  );
}

function shuffled<T>(items: T[], seed: number): T[] {
  const result = [...items];
  let state = seed;
  for (let i = result.length - 1; i > 0; i--) {
    state = (state * 1103515245 + 12345) % 2147483648;
    const j = state % (i + 1);
    [result[i], result[j]] = [result[j], result[i]];
  }
  return result;
}

function deepFreeze<T>(value: T): T {
  if (value !== null && typeof value === "object") {
    for (const child of Object.values(value)) deepFreeze(child);
    Object.freeze(value);
  }
  return value;
}

function distance(a: Position, b: Position): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

function centroid(points: Position[]): Position {
  return {
    x: points.reduce((sum, p) => sum + p.x, 0) / points.length,
    y: points.reduce((sum, p) => sum + p.y, 0) / points.length,
  };
}

function directoryOf(path: string): string {
  const slash = path.lastIndexOf("/");
  return slash === -1 ? "" : path.slice(0, slash);
}

function pointsIn(layout: ConstellationLayout, directory: string): Position[] {
  const points = [...layout.positions]
    .filter(([id]) => directoryOf(id) === directory)
    .map(([, p]) => p);
  assert.ok(points.length > 0, `no nodes in ${directory}`);
  return points;
}

// Share of nodes whose nearest other node belongs to the same group, among
// nodes whose group has at least two members. `groupOf` defaults to the
// directory.
function grouping(
  layout: ConstellationLayout,
  groupOf: (id: string) => string = directoryOf,
): number {
  const entries = [...layout.positions];
  const sizes = new Map<string, number>();
  for (const [id] of entries) sizes.set(groupOf(id), (sizes.get(groupOf(id)) ?? 0) + 1);

  let same = 0;
  let total = 0;
  for (const [id, point] of entries) {
    if (sizes.get(groupOf(id))! < 2) continue;
    let nearest = "";
    let best = Infinity;
    for (const [other, p] of entries) {
      if (other === id) continue;
      const d = distance(point, p);
      if (d < best) {
        best = d;
        nearest = other;
      }
    }
    if (groupOf(nearest) === groupOf(id)) same++;
    total++;
  }
  return same / total;
}

// Clear space between the closest stars of two different directories,
// against the median clear space between a star and its nearest neighbour in
// its own directory, both in node-size units.
function separation(graph: RenderGraph, layout: ConstellationLayout): { across: number; within: number } {
  const radius = new Map(graph.nodes.map((n) => [n.id, nodeSize(n.size, n.degree)]));
  const ids = graph.nodes.map((n) => n.id);
  const clear = (a: string, b: string) => unitsBetween(layout, a, b) - radius.get(a)! - radius.get(b)!;
  let across = Infinity;
  const nearestWithin: number[] = [];
  for (const a of ids) {
    let own = Infinity;
    for (const b of ids) {
      if (a === b) continue;
      if (directoryOf(a) === directoryOf(b)) own = Math.min(own, clear(a, b));
      else across = Math.min(across, clear(a, b));
    }
    if (own < Infinity) nearestWithin.push(own);
  }
  nearestWithin.sort((x, y) => x - y);
  return { across, within: nearestWithin[Math.floor(nearestWithin.length / 2)] };
}

// Distances in node-size units, the unit star radii are given in.
function unitsBetween(layout: ConstellationLayout, a: string, b: string): number {
  return distance(layout.positions.get(a)!, layout.positions.get(b)!) * layout.scale;
}

function assertNoOverlap(graph: RenderGraph, layout: ConstellationLayout) {
  const nodes = graph.nodes;
  for (let i = 0; i < nodes.length; i++) {
    for (let j = i + 1; j < nodes.length; j++) {
      const gap =
        unitsBetween(layout, nodes[i].id, nodes[j].id) -
        nodeSize(nodes[i].size, nodes[i].degree) -
        nodeSize(nodes[j].size, nodes[j].degree);
      assert.ok(gap > 0, `${nodes[i].id} overlaps ${nodes[j].id} by ${-gap}`);
    }
  }
}

function assertNormalized(layout: ConstellationLayout, count: number) {
  assert.equal(layout.positions.size, count);
  for (const [id, { x, y }] of layout.positions) {
    assert.ok(Number.isFinite(x) && Number.isFinite(y), `${id}: ${x}, ${y}`);
    assert.ok(Math.abs(x) <= 1 && Math.abs(y) <= 1, `${id}: ${x}, ${y}`);
  }
  assert.ok(Number.isFinite(layout.scale) && layout.scale > 0);
}

// src/app, src/components, src/lib with nested lib directories, and config
// files at the root, with imports shaped like a small Next.js application.
function nextApp(): RenderGraph {
  const nodes = [
    node("next.config.ts", 300),
    node("eslint.config.mjs", 500),
    node("postcss.config.mjs", 100),
    ...["page.tsx", "layout.tsx", "actions.ts", "form.tsx", "error.tsx"].map((f) => node(`src/app/${f}`, 3_000)),
    ...["button.tsx", "dialog.tsx", "input.tsx", "graph.tsx", "footer.tsx", "header.tsx"].map((f) =>
      node(`src/components/${f}`, 2_500),
    ),
    ...["utils.ts", "env.ts"].map((f) => node(`src/lib/${f}`, 1_200)),
    ...["client.ts", "archive.ts", "repository.ts", "types.ts"].map((f) => node(`src/lib/github/${f}`, 6_000)),
    ...["build.ts", "types.ts", "layout.ts"].map((f) => node(`src/lib/graph/${f}`, 5_000)),
  ];
  const edges = [
    edge("src/app/page.tsx", "src/app/form.tsx"),
    edge("src/app/form.tsx", "src/app/actions.ts"),
    edge("src/app/form.tsx", "src/components/graph.tsx"),
    edge("src/app/form.tsx", "src/components/button.tsx"),
    edge("src/app/layout.tsx", "src/components/header.tsx"),
    edge("src/app/layout.tsx", "src/components/footer.tsx"),
    edge("src/app/actions.ts", "src/lib/github/repository.ts"),
    edge("src/app/actions.ts", "src/lib/graph/build.ts"),
    edge("src/components/dialog.tsx", "src/components/button.tsx"),
    edge("src/components/button.tsx", "src/lib/utils.ts"),
    edge("src/components/input.tsx", "src/lib/utils.ts"),
    edge("src/components/graph.tsx", "src/lib/graph/layout.ts"),
    edge("src/lib/github/repository.ts", "src/lib/github/client.ts"),
    edge("src/lib/github/repository.ts", "src/lib/github/archive.ts", 3),
    edge("src/lib/github/client.ts", "src/lib/env.ts"),
    edge("src/lib/github/archive.ts", "src/lib/github/types.ts"),
    edge("src/lib/github/client.ts", "src/lib/github/types.ts"),
    edge("src/lib/graph/build.ts", "src/lib/graph/types.ts"),
    edge("src/lib/graph/layout.ts", "src/lib/graph/types.ts"),
  ];
  return graphOf(nodes, edges);
}

// Several packages of different sizes, each with src and test directories.
function monorepo(count: number): RenderGraph {
  const packages = ["core", "react", "vue", "devtools", "eslint-plugin", "persist"];
  const weights = [8, 5, 3, 3, 2, 1];
  const total = weights.reduce((a, b) => a + b, 0);
  const nodes: RenderNode[] = [];
  const edges: RenderEdge[] = [];
  packages.forEach((name, p) => {
    const share = Math.max(2, Math.round((count * weights[p]) / total));
    for (let i = 0; i < share && nodes.length < count; i++) {
      const directory = i % 3 === 2 ? `packages/${name}/src/__tests__` : `packages/${name}/src`;
      nodes.push(node(`${directory}/m${i}.ts`, 400 + ((i * 104_729) % 30_000)));
    }
  });
  while (nodes.length < count) nodes.push(node(`scripts/s${nodes.length}.js`, 800));
  const byDirectory = new Map<string, string[]>();
  for (const n of nodes) byDirectory.set(n.directory, [...(byDirectory.get(n.directory) ?? []), n.id]);
  for (const ids of byDirectory.values()) {
    for (let i = 1; i < ids.length; i++) edges.push(edge(ids[i], ids[(i * 7) % i]));
  }
  // Every package's first file imports core's first file.
  const coreEntry = nodes.find((n) => n.directory === "packages/core/src")!.id;
  for (const name of packages.slice(1)) {
    const entry = nodes.find((n) => n.directory === `packages/${name}/src`);
    if (entry) edges.push(edge(entry.id, coreEntry));
  }
  return graphOf(nodes, edges);
}

describe("layoutConstellation", () => {
  describe("placement", () => {
    it("gives every node finite coordinates inside [-1, 1]", () => {
      const graph = nextApp();
      assertNormalized(layoutConstellation(graph), graph.nodes.length);
    });

    it("centres a single node", () => {
      const layout = layoutConstellation(graphOf([node("index.ts")]));

      assertNormalized(layout, 1);
      const { x, y } = layout.positions.get("index.ts")!;
      assert.ok(Math.abs(x) < 1e-9 && Math.abs(y) < 1e-9, `${x}, ${y}`);
    });

    it("separates two nodes and keeps them close", () => {
      const graph = graphOf([node("a.ts"), node("b.ts")], [edge("a.ts", "b.ts")]);
      const layout = layoutConstellation(graph);
      const radii = nodeSize(2_000, 1) * 2;
      const units = unitsBetween(layout, "a.ts", "b.ts");

      assert.ok(units > radii, `${units}`);
      assert.ok(units < radii * 4, `${units}`);
      // Symmetric around the centre.
      const a = layout.positions.get("a.ts")!;
      const b = layout.positions.get("b.ts")!;
      assert.ok(Math.abs(a.x + b.x) < 1e-9 && Math.abs(a.y + b.y) < 1e-9);
    });

    it("keeps files of the same directory together", () => {
      const graph = graphOf([...files("src/a", 12), ...files("src/b", 12), ...files("src/c", 12)]);
      const layout = layoutConstellation(graph);

      assert.equal(grouping(layout), 1);
      const { across, within } = separation(graph, layout);
      assert.ok(across > within * 1.5, `${across} vs ${within}`);
    });

    it("gives top-level directories distinct regions", () => {
      const graph = graphOf([...files("app", 15), ...files("lib", 20), ...files("components", 10), ...files("", 3)]);
      const layout = layoutConstellation(graph);

      assert.ok(grouping(layout) >= 0.95, `${grouping(layout)}`);
      const { across, within } = separation(graph, layout);
      assert.ok(across > within, `${across} vs ${within}`);
    });

    it("keeps nested directories near their parent's region", () => {
      const graph = nextApp();
      const layout = layoutConstellation(graph);
      // Top-level group under src: app, components or lib, including lib's
      // nested directories.
      const area = (id: string) => (id.startsWith("src/") ? id.split("/")[1] : "");

      assert.ok(grouping(layout, area) >= 0.9, `${grouping(layout, area)}`);

      const lib = centroid(
        [...layout.positions].filter(([id]) => id.startsWith("src/lib/")).map(([, p]) => p),
      );
      const app = centroid(pointsIn(layout, "src/app"));
      for (const nested of ["src/lib/github", "src/lib/graph"]) {
        const c = centroid(pointsIn(layout, nested));
        assert.ok(distance(c, lib) < distance(c, app), nested);
      }
    });

    it("gives larger directories more space", () => {
      const graph = graphOf([...files("big", 60), ...files("small", 5)]);
      const layout = layoutConstellation(graph);
      const spread = (directory: string) => {
        const points = pointsIn(layout, directory);
        const c = centroid(points);
        return Math.max(...points.map((p) => distance(p, c)));
      };

      assert.ok(spread("big") > spread("small") * 2.5, `${spread("big")} vs ${spread("small")}`);
    });

    it("leaves room around large stars", () => {
      const nodes = [
        ...Array.from({ length: 30 }, (_, i) => node(`src/small-${i}.ts`, 150)),
        ...Array.from({ length: 6 }, (_, i) => node(`src/large-${i}.ts`, 200_000)),
      ];
      const graph = graphOf(nodes);
      const layout = layoutConstellation(graph);
      assertNoOverlap(graph, layout);

      const nearest = (id: string) =>
        Math.min(...nodes.filter((n) => n.id !== id).map((n) => unitsBetween(layout, id, n.id)));
      const average = (ids: string[]) => ids.reduce((sum, id) => sum + nearest(id), 0) / ids.length;
      const large = average(nodes.filter((n) => n.id.includes("large")).map((n) => n.id));
      const small = average(nodes.filter((n) => n.id.includes("small")).map((n) => n.id));

      assert.ok(large > small, `${large} vs ${small}`);
    });

    it("places files that have no edges", () => {
      const graph = graphOf([...files("src", 8), ...files("scripts", 3), node("index.js")]);
      const layout = layoutConstellation(graph);

      assertNormalized(layout, 12);
      assertNoOverlap(graph, layout);
    });

    it("keeps a directory without edges inside the composition", () => {
      const base = nextApp();
      const graph = graphOf([...base.nodes, ...files("fixtures", 6)], base.edges);
      const layout = layoutConstellation(graph);
      const fixtures = pointsIn(layout, "fixtures");
      const others = [...layout.positions].filter(([id]) => !id.startsWith("fixtures/")).map(([, p]) => p);
      const nearestOther = Math.min(...fixtures.flatMap((f) => others.map((o) => distance(f, o))));

      assertNormalized(layout, graph.nodes.length);
      // Separated as a group, but no further than a few star spacings.
      assert.ok(nearestOther * layout.scale < 80, `${nearestOther * layout.scale}`);
    });

    it("counts directory groups after merging chains", () => {
      assert.equal(layoutConstellation(nextApp()).groups, 7);
      assert.equal(layoutConstellation(graphOf(files("a/b/c", 3))).groups, 1);
      assert.equal(layoutConstellation(graphOf([])).groups, 0);
    });
  });

  describe("determinism", () => {
    it("returns identical coordinates for the same graph", () => {
      assert.deepEqual(layoutConstellation(monorepo(120)), layoutConstellation(monorepo(120)));
    });

    it("does not depend on node order", () => {
      const graph = monorepo(120);
      const expected = layoutConstellation(graph);

      for (const seed of [1, 7, 42]) {
        const actual = layoutConstellation({ ...graph, nodes: shuffled(graph.nodes, seed) });
        assert.deepEqual(actual, expected);
      }
    });

    it("does not depend on edge order", () => {
      const graph = monorepo(120);
      const expected = layoutConstellation(graph);

      for (const seed of [3, 11]) {
        assert.deepEqual(layoutConstellation({ ...graph, edges: shuffled(graph.edges, seed) }), expected);
      }
    });

    it("ignores node fields and key order that the layout does not use", () => {
      const graph = nextApp();
      const reshaped: RenderGraph = {
        edges: graph.edges.map(({ kinds, weight, target, source, id }) => ({ kinds, weight, target, source, id })),
        nodes: graph.nodes.map((n) => ({ ...n, language: "javascript" as const, incoming: 99, outgoing: 99 })),
      };

      assert.deepEqual(layoutConstellation(reshaped), layoutConstellation(graph));
    });

    it("does not depend on locale-sensitive APIs", () => {
      const graph = graphOf(
        ["src/ä.ts", "src/Z.ts", "src/a.ts", "src/é/ß.tsx", "src/日本.js", "Ölfeld/x.ts"].map((p) => node(p)),
      );
      const expected = layoutConstellation(graph);

      const localeCompare = String.prototype.localeCompare;
      const toLocaleString = Number.prototype.toLocaleString;
      String.prototype.localeCompare = () => {
        throw new Error("localeCompare called");
      };
      Number.prototype.toLocaleString = () => {
        throw new Error("toLocaleString called");
      };
      try {
        assert.deepEqual(layoutConstellation(graph), expected);
      } finally {
        String.prototype.localeCompare = localeCompare;
        Number.prototype.toLocaleString = toLocaleString;
      }
    });

    it("does not use Math.random", () => {
      const random = Math.random;
      Math.random = () => {
        throw new Error("Math.random called");
      };
      try {
        layoutConstellation(monorepo(80));
      } finally {
        Math.random = random;
      }
    });
  });

  describe("dependencies", () => {
    it("does not pull directories apart when they import each other heavily", () => {
      const a = files("src/a", 10);
      const b = files("src/b", 10);
      const edges = a.flatMap((x) => b.map((y) => edge(x.id, y.id)));
      const layout = layoutConstellation(graphOf([...a, ...b], edges));

      assert.equal(grouping(layout), 1);
    });

    it("keeps a cross-directory edge between two groups", () => {
      const base = graphOf([...files("src/a", 8), ...files("src/b", 8)]);
      const graph = graphOf(base.nodes, [edge("src/a/file-000.ts", "src/b/file-000.ts")]);
      const layout = layoutConstellation(graph);
      const source = layout.positions.get("src/a/file-000.ts")!;
      const a = centroid(pointsIn(layout, "src/a"));
      const b = centroid(pointsIn(layout, "src/b"));

      assert.ok(distance(source, a) < distance(source, b));
      assert.equal(grouping(layout), 1);
    });

    it("moves connected files of one directory modestly closer", () => {
      const nodes = files("src", 16);
      const pair = [nodes[3].id, nodes[12].id] as const;
      const without = layoutConstellation(graphOf(nodes));
      const withEdge = layoutConstellation(graphOf(nodes, [edge(pair[0], pair[1])]));

      const before = unitsBetween(without, ...pair);
      const after = unitsBetween(withEdge, ...pair);
      assert.ok(after < before, `${after} vs ${before}`);
    });

    it("places cycles", () => {
      const nodes = [node("a/x.ts"), node("b/y.ts"), node("c/z.ts"), node("a/w.ts")];
      const edges = [edge("a/x.ts", "b/y.ts"), edge("b/y.ts", "c/z.ts"), edge("c/z.ts", "a/x.ts"), edge("a/w.ts", "a/x.ts"), edge("a/x.ts", "a/w.ts")];
      const graph = graphOf(nodes, edges);
      const layout = layoutConstellation(graph);

      assertNormalized(layout, 4);
      assertNoOverlap(graph, layout);
    });

    it("ignores edges to unknown nodes and self loops", () => {
      const nodes = files("src", 4);
      const expected = layoutConstellation(graphOf(nodes));
      const graph = graphOf(nodes, [edge(nodes[0].id, "missing.ts"), edge(nodes[1].id, nodes[1].id)]);

      assert.deepEqual(
        layoutConstellation({ ...graph, nodes: graph.nodes.map((n) => ({ ...n, degree: 0 })) }),
        expected,
      );
    });
  });

  describe("spacing", () => {
    it("never puts two nodes at the same point or overlapping", () => {
      const graph = monorepo(500);
      const layout = layoutConstellation(graph);
      const keys = new Set([...layout.positions.values()].map(({ x, y }) => `${x},${y}`));

      assert.equal(keys.size, 500);
      assertNoOverlap(graph, layout);
    });

    it("spreads a 100-file directory without collapsing or scattering it", () => {
      const graph = graphOf(files("src", 100));
      const layout = layoutConstellation(graph);
      assertNoOverlap(graph, layout);

      const ids = graph.nodes.map((n) => n.id);
      for (const id of ids) {
        const nearest = Math.min(...ids.filter((o) => o !== id).map((o) => unitsBetween(layout, id, o)));
        assert.ok(nearest < 40, `${id}: ${nearest}`);
      }
    });

    it("keeps every group within a bounded distance of another", () => {
      const graph = monorepo(300);
      const layout = layoutConstellation(graph);
      const directories = [...new Set(graph.nodes.map((n) => n.directory))];

      for (const directory of directories) {
        const own = pointsIn(layout, directory);
        const others = [...layout.positions]
          .filter(([id]) => directoryOf(id) !== directory)
          .map(([, p]) => p);
        const gap = Math.min(...own.flatMap((p) => others.map((o) => distance(p, o)))) * layout.scale;
        assert.ok(gap < 90, `${directory}: ${gap}`);
      }
    });
  });

  describe("normalization", () => {
    it("fits the layout into [-1, 1] and centres it", () => {
      for (const graph of [nextApp(), monorepo(300)]) {
        const layout = layoutConstellation(graph);
        assertNormalized(layout, graph.nodes.length);

        const points = [...layout.positions.values()];
        const c = centroid(points);
        assert.ok(Math.hypot(c.x, c.y) < 0.25, `${c.x}, ${c.y}`);
        const xs = points.map((p) => p.x);
        const ys = points.map((p) => p.y);
        assert.ok(Math.abs(Math.max(...xs) + Math.min(...xs)) < 0.1);
        assert.ok(Math.abs(Math.max(...ys) + Math.min(...ys)) < 0.1);
      }
    });

    it("fills the width for large layouts and lays them out wider than tall", () => {
      const layout = layoutConstellation(monorepo(400));
      const xs = [...layout.positions.values()].map((p) => p.x);
      const ys = [...layout.positions.values()].map((p) => p.y);
      const width = Math.max(...xs) - Math.min(...xs);
      const height = Math.max(...ys) - Math.min(...ys);

      assert.ok(width > 1.8, `${width}`);
      assert.ok(width >= height, `${width} vs ${height}`);
    });

    it("keeps small layouts small instead of stretching them", () => {
      const small = layoutConstellation(graphOf(files("src", 6)));
      const large = layoutConstellation(monorepo(300));
      const extent = (layout: ConstellationLayout) =>
        Math.max(...[...layout.positions.values()].map((p) => Math.hypot(p.x, p.y)));

      assert.ok(extent(small) < 0.6, `${extent(small)}`);
      assert.ok(extent(large) > 0.9, `${extent(large)}`);
      assert.equal(small.scale, large.scale > small.scale ? small.scale : NaN);
    });

    it("returns a frame that contains every star", () => {
      for (const graph of [graphOf([node("a.ts")]), nextApp(), monorepo(300)]) {
        const layout = layoutConstellation(graph);
        const { frame } = layout;

        assert.ok(frame.x[0] <= -1 && frame.x[1] >= 1);
        assert.ok(frame.y[0] < 0 && frame.y[1] > 0);
        for (const n of graph.nodes) {
          const { x, y } = layout.positions.get(n.id)!;
          const r = nodeSize(n.size, n.degree) / layout.scale;
          assert.ok(x - r >= frame.x[0] - 1e-9 && x + r <= frame.x[1] + 1e-9, n.id);
          assert.ok(y - r >= frame.y[0] - 1e-9 && y + r <= frame.y[1] + 1e-9, n.id);
        }
      }
    });

    it("keeps outlying groups close to the rest", () => {
      const graph = monorepo(300);
      const layout = layoutConstellation(graph);
      const points = [...layout.positions.values()];

      for (const p of points) {
        const nearest = Math.min(...points.filter((o) => o !== p).map((o) => distance(p, o)));
        assert.ok(nearest * layout.scale < 60, `${nearest * layout.scale}`);
      }
    });
  });

  describe("input", () => {
    it("does not modify the render graph", () => {
      const graph = deepFreeze(nextApp());
      const copy = structuredClone(graph);

      layoutConstellation(graph);
      assert.deepEqual(graph, copy);
    });

    it("handles a graph without nodes", () => {
      const layout = layoutConstellation({ nodes: [], edges: [] });

      assert.equal(layout.positions.size, 0);
      assert.ok(layout.frame.x[1] > layout.frame.x[0] && layout.frame.y[1] > layout.frame.y[0]);
    });
  });

  describe("sizes", () => {
    for (const count of [1, 10, 100, 500]) {
      it(`lays out ${count} nodes`, () => {
        const graph = monorepo(count);
        const started = performance.now();
        const layout = layoutConstellation(graph);
        const elapsed = performance.now() - started;

        assertNormalized(layout, graph.nodes.length);
        assertNoOverlap(graph, layout);
        // Generous, so slow machines do not fail; measured values are far lower.
        assert.ok(elapsed < 2_000, `${elapsed}ms`);
      });
    }
  });

  describe("repository shapes", () => {
    it("separates app, components and lib in a Next.js layout", () => {
      const graph = nextApp();
      const layout = layoutConstellation(graph);

      assertNoOverlap(graph, layout);
      assert.ok(grouping(layout) >= 0.9, `${grouping(layout)}`);
    });

    it("keeps barrel files with their modules", () => {
      const modules = ["parse", "format", "validate", "render", "cache"];
      const nodes = [node("src/index.ts", 400)];
      const edges: RenderEdge[] = [];
      for (const name of modules) {
        nodes.push(node(`src/${name}/index.ts`, 200));
        edges.push(edge("src/index.ts", `src/${name}/index.ts`));
        for (let i = 0; i < 5; i++) {
          nodes.push(node(`src/${name}/part-${i}.ts`, 3_000));
          edges.push(edge(`src/${name}/index.ts`, `src/${name}/part-${i}.ts`));
        }
      }
      const graph = graphOf(nodes, edges);
      const layout = layoutConstellation(graph);

      assertNoOverlap(graph, layout);
      assert.ok(grouping(layout) >= 0.95, `${grouping(layout)}`);
    });

    it("keeps submodules of a large src folder apart", () => {
      const graph = monorepo(450);
      const layout = layoutConstellation(graph);
      const packageOf = (id: string) => id.split("/").slice(0, 2).join("/");

      assert.ok(grouping(layout) >= 0.95, `${grouping(layout)}`);
      assert.ok(grouping(layout, packageOf) >= 0.98, `${grouping(layout, packageOf)}`);
    });

    it("places root config files next to src", () => {
      const graph = graphOf([
        node("next.config.ts", 300),
        node("tailwind.config.js", 900),
        node("postcss.config.js", 100),
        ...files("src", 20),
        ...files("src/lib", 12),
      ]);
      const layout = layoutConstellation(graph);
      const root = pointsIn(layout, "");
      const src = [...pointsIn(layout, "src"), ...pointsIn(layout, "src/lib")];
      const nearest = Math.min(...root.flatMap((r) => src.map((s) => distance(r, s)))) * layout.scale;

      assertNoOverlap(graph, layout);
      assert.ok(grouping(layout) >= 0.95, `${grouping(layout)}`);
      assert.ok(nearest < 60, `${nearest}`);
    });
  });
});
