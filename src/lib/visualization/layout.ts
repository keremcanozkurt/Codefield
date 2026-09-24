import { compareStrings } from "../analysis/paths.ts";
import { buildDirectoryTree, flattenGroups, type DirectoryGroup } from "./hierarchy.ts";
import { nodeSize } from "./mapping.ts";
import type { RenderGraph } from "./types.ts";

export type Position = { x: number; y: number };

// The area the initial camera should show, in layout coordinates. Same shape
// as Sigma's custom bounding box.
export type Frame = { x: [number, number]; y: [number, number] };

export type ConstellationLayout = {
  // Coordinates are within [-1, 1] on both axes.
  positions: Map<string, Position>;
  frame: Frame;
  // The area the stars actually cover, including their radii.
  bounds: Frame;
  // Node-size units per coordinate unit. Stars are spaced as if a node of
  // size s had a radius of s / scale in these coordinates.
  scale: number;
  // Number of directory groups after single-child chains are merged.
  groups: number;
};

// Until normalization, distances are in node-size units, which Sigma draws as
// screen pixels at the default zoom. That lets spacing follow star radii.
export const LAYOUT = {
  // Clear space between the edges of two stars in the same directory.
  starGap: 8,
  // Share of the disc area the stars of one directory fill.
  fileDensity: 0.72,
  // Clear space between sibling groups: a base plus a share of the smaller
  // group's radius, capped by a maximum that shrinks with depth, so small and
  // nested directories stay close to their parent's region.
  groupGapBase: 12,
  groupGapRatio: 0.3,
  groupGapMax: [64, 48, 36, 28],
  // Weight of dependency links against compactness when placing a group.
  linkPreference: 0.6,
  placementAngles: 24,
  relaxIterations: 60,
  anchorPull: 0.12,
  edgePull: 0.05,
  // Edges between files of different directories pull with this share of the
  // strength of edges inside one directory.
  crossDirectoryPull: 0.4,
  // How far dependency pulls may move a star from its directory position.
  maxDrift: 18,
  // Smallest half-width of the normalized space. Smaller layouts keep their
  // spacing instead of being scaled up to fill the viewport.
  minHalfExtent: 100,
  // Smallest half-height of the frame. Its half-width is always 1.
  minFrameHeight: 0.6,
} as const;

const GOLDEN_ANGLE = Math.PI * (3 - Math.sqrt(5));

type Context = {
  ids: string[];
  paths: string[];
  radius: Float64Array;
  x: Float64Array;
  y: Float64Array;
  indexByPath: Map<string, number>;
  // Index of each star's directory, for the clearance kept between directories.
  directory: Int32Array;
  links: Map<string, number>;
};

type Cluster = { members: number[]; radius: number };

// Places files by directory first and by dependency second, with a finite
// number of steps and no randomness:
//
// 1. Files are grouped by directory, with single-child directory chains merged.
// 2. Each directory's files are laid out on a jittered sunflower spiral,
//    largest stars first, sized by the renderer's star radius.
// 3. Sibling groups, including a directory's own files, are packed around each
//    other from the largest down. Each is put at the free spot that balances
//    staying compact with sitting near the siblings it has dependencies with.
// 4. A short relaxation pulls dependent files towards each other within a
//    bounded distance of their directory position and separates overlaps.
// 5. The result is rotated so its long axis is horizontal, centred, and scaled
//    into [-1, 1].
//
// Jitter, rotations and tie-breaks come from hashes of paths, and everything
// is iterated in code-unit order, so the output depends only on the graph's
// content.
export function layoutConstellation(graph: RenderGraph): ConstellationLayout {
  const nodes = [...graph.nodes].sort((a, b) => compareStrings(a.id, b.id));
  const count = nodes.length;
  const context: Context = {
    ids: nodes.map((node) => node.id),
    paths: nodes.map((node) => node.path),
    radius: Float64Array.from(nodes, (node) => nodeSize(node.size, node.degree)),
    x: new Float64Array(count),
    y: new Float64Array(count),
    indexByPath: new Map(nodes.map((node, i) => [node.path, i])),
    directory: new Int32Array(count),
    links: new Map(),
  };

  const tree = buildDirectoryTree(context.paths);
  const groups = count > 0 ? flattenGroups(tree) : [];
  groups.forEach((group, index) => {
    for (const path of group.files) context.directory[context.indexByPath.get(path)!] = index;
  });
  const chains = itemChains(tree, context);
  const edges = collectEdges(graph, context, chains);

  if (count > 0) layoutGroup(tree, 0, context);
  relax(context, edges);

  return { ...normalize(context), groups: groups.length };
}

// For each file, the placement item that contains it at every level of the
// tree: child groups by path, and a directory's own files by filesKey.
function itemChains(tree: DirectoryGroup, context: Context): string[][] {
  const chains: string[][] = new Array(context.ids.length);
  const visit = (group: DirectoryGroup, prefix: string[]) => {
    for (const path of group.files) {
      chains[context.indexByPath.get(path)!] = [...prefix, filesKey(group.path)];
    }
    for (const child of group.children) visit(child, [...prefix, child.path]);
  };
  visit(tree, []);
  return chains;
}

type LayoutEdge = {
  source: number;
  target: number;
  strength: number;
  // Share of the pull each end takes. Files with many edges move less, so a
  // hub is not dragged towards everything it imports.
  sourceShare: number;
  targetShare: number;
};

function collectEdges(graph: RenderGraph, context: Context, chains: string[][]): LayoutEdge[] {
  const indexById = new Map(context.ids.map((id, i) => [id, i]));
  const sorted = [...graph.edges].sort((a, b) => compareStrings(a.id, b.id));
  const edges: LayoutEdge[] = [];

  for (const edge of sorted) {
    const source = indexById.get(edge.source);
    const target = indexById.get(edge.target);
    if (source === undefined || target === undefined || source === target) continue;

    const a = chains[source];
    const b = chains[target];
    let level = 0;
    while (level < a.length && level < b.length && a[level] === b[level]) level++;
    const sameDirectory = level === a.length && level === b.length;

    if (!sameDirectory) {
      // The first differing items are siblings inside the deepest common group.
      const key = pairKey(a[level], b[level]);
      context.links.set(key, (context.links.get(key) ?? 0) + 1);
    }
    edges.push({
      source,
      target,
      strength: sameDirectory ? 1 : LAYOUT.crossDirectoryPull,
      sourceShare: 0,
      targetShare: 0,
    });
  }

  const degree = new Float64Array(context.ids.length);
  for (const { source, target } of edges) {
    degree[source]++;
    degree[target]++;
  }
  for (const edge of edges) {
    edge.sourceShare = 1 / Math.sqrt(degree[edge.source]);
    edge.targetShare = 1 / Math.sqrt(degree[edge.target]);
  }
  return edges;
}

function layoutGroup(group: DirectoryGroup, depth: number, context: Context): Cluster {
  const items = group.children.map((child) => ({
    key: child.path,
    cluster: layoutGroup(child, depth + 1, context),
  }));
  if (group.files.length > 0) {
    items.push({ key: filesKey(group.path), cluster: placeFiles(group, context) });
  }
  if (items.length === 1) return items[0].cluster;
  return packItems(items, group.path, depth, context);
}

function placeFiles(group: DirectoryGroup, context: Context): Cluster {
  const { radius, x, y } = context;
  const members = group.files
    .map((path) => context.indexByPath.get(path)!)
    .sort((a, b) => radius[b] - radius[a] || a - b);

  const seed = hash(group.path);
  const turn = unit(seed, 1) * 2 * Math.PI;
  // A stretch along a hashed axis keeps larger directories from all reading as
  // the same round disc. Small ones stay compact.
  const stretch = 1 + 0.6 * unit(seed, 2) * Math.min(1, Math.max(0, members.length - 4) / 12);
  const axis = unit(seed, 3) * Math.PI;
  const cos = Math.cos(axis);
  const sin = Math.sin(axis);

  let area = 0;
  members.forEach((i, k) => {
    const extent = radius[i] + LAYOUT.starGap / 2;
    const own = hash(context.paths[i]);
    const distance =
      Math.sqrt((area + (extent * extent) / 2) / LAYOUT.fileDensity) *
      (1 + (unit(own, 1) - 0.5) * 0.24);
    area += extent * extent;
    const angle = turn + k * GOLDEN_ANGLE + (unit(own, 2) - 0.5) * 0.5;

    const u = distance * Math.cos(angle - axis) * stretch;
    const v = distance * Math.sin(angle - axis);
    x[i] = u * cos - v * sin;
    y[i] = u * sin + v * cos;
  });

  return recentre(members, context);
}

type Item = { key: string; cluster: Cluster };
type Placed = { key: string; x: number; y: number; radius: number };
// A placed star, with the radius of the item it belongs to, which sets the gap
// it needs.
type Obstacle = { x: number; y: number; r: number; item: number };

function packItems(items: Item[], path: string, depth: number, context: Context): Cluster {
  const { radius, x, y } = context;
  const sorted = [...items].sort(
    (a, b) => b.cluster.radius - a.cluster.radius || compareStrings(a.key, b.key),
  );
  const seed = hash(`${path}\0pack`);
  const offset = unit(seed, 1) * 2 * Math.PI;
  // Growth is cheaper along a hashed axis, so groups of siblings form loose,
  // slightly elongated regions rather than round heaps.
  const elongation = 0.72 + 0.2 * unit(seed, 2);
  const axis = unit(seed, 3) * Math.PI;
  const maxGap = LAYOUT.groupGapMax[Math.min(depth, LAYOUT.groupGapMax.length - 1)];
  const gapBetween = (a: number, b: number) =>
    Math.min(maxGap, LAYOUT.groupGapBase + LAYOUT.groupGapRatio * Math.min(a, b));

  const step = (2 * Math.PI) / LAYOUT.placementAngles;
  const placed: Placed[] = [];
  const obstacles: Obstacle[] = [];

  for (const { key, cluster } of sorted) {
    const r = cluster.radius;
    let best = { x: 0, y: 0, cost: Infinity, angle: 0 };

    if (placed.length === 0) {
      best = { x: 0, y: 0, cost: 0, angle: 0 };
    } else {
      let weight = 0;
      let cx = 0;
      let cy = 0;
      for (const p of placed) {
        const w = p.radius * p.radius;
        cx += p.x * w;
        cy += p.y * w;
        weight += w;
      }
      cx /= weight;
      cy /= weight;

      const linked = placed
        .map((p) => ({ p, w: context.links.get(pairKey(key, p.key)) ?? 0 }))
        .filter(({ w }) => w > 0);
      const linkTotal = linked.reduce((sum, { w }) => sum + w, 0);

      const consider = (angle: number, dx: number, dy: number, t: number) => {
        const px = cx + dx * t;
        const py = cy + dy * t;
        const along = t * Math.cos(angle - axis);
        const across = (t * Math.sin(angle - axis)) / elongation;
        let cost = Math.hypot(along, across);
        if (linkTotal > 0) {
          let pull = 0;
          for (const { p, w } of linked) {
            pull += w * Math.max(0, Math.hypot(px - p.x, py - p.y) - p.radius - r);
          }
          cost += (LAYOUT.linkPreference * pull) / linkTotal;
        }
        if (cost < best.cost - 1e-9) best = { x: px, y: py, cost, angle };
      };
      const evaluate = (angle: number) => {
        const dx = Math.cos(angle);
        const dy = Math.sin(angle);
        const t = freeDistance(cx, cy, dx, dy, cluster, r, obstacles, gapBetween, context, best.cost);
        if (t !== Infinity) consider(angle, dx, dy, t);
      };

      // Clearing the enclosing circles of the placed items is always valid,
      // so the best such spot is a cheap starting bound for the search below.
      for (let a = 0; a < LAYOUT.placementAngles; a++) {
        const angle = offset + a * step;
        const dx = Math.cos(angle);
        const dy = Math.sin(angle);
        consider(angle, dx, dy, circleDistance(cx, cy, dx, dy, r, placed, gapBetween));
      }

      // A coarse sweep, then two halvings around the best direction. Since a
      // candidate's cost is never less than its distance, directions that
      // cannot beat the best so far stop early inside freeDistance.
      for (let a = 0; a < LAYOUT.placementAngles; a++) evaluate(offset + a * step);
      for (const fraction of [0.5, 0.25]) {
        const around = best.angle;
        evaluate(around - step * fraction);
        evaluate(around + step * fraction);
      }
    }

    for (const i of cluster.members) {
      x[i] += best.x;
      y[i] += best.y;
      obstacles.push({ x: x[i], y: y[i], r: radius[i], item: r });
    }
    placed.push({ key, x: best.x, y: best.y, radius: r });
  }

  return recentre(sorted.flatMap(({ cluster }) => cluster.members), context);
}

// How far from (cx, cy) along (dx, dy) the cluster has to be centred to keep
// the required gap between each of its stars and every star already placed,
// approaching from outside: it ends up against the outline of what is placed
// rather than in a hole between groups. Returns Infinity if that distance is
// not below `limit`. Testing stars rather than enclosing circles lets groups
// fit against each other's irregular outlines instead of leaving empty
// crescents between them.
function freeDistance(
  cx: number,
  cy: number,
  dx: number,
  dy: number,
  cluster: Cluster,
  clusterRadius: number,
  obstacles: Obstacle[],
  gapBetween: (a: number, b: number) => number,
  context: Context,
  limit: number,
): number {
  const { radius, x, y } = context;
  const count = cluster.members.length;
  // Each star's offset across and along the direction of travel, sorted by
  // the offset across, so an obstacle only checks the stars in its band.
  const across = new Float64Array(count);
  const along = new Float64Array(count);
  const size = new Float64Array(count);
  const order = Array.from({ length: count }, (_, k) => k);
  let largest = 0;
  cluster.members.forEach((i, k) => {
    across[k] = x[i] * dy - y[i] * dx;
    along[k] = x[i] * dx + y[i] * dy;
    size[k] = radius[i];
    largest = Math.max(largest, radius[i]);
  });
  order.sort((a, b) => across[a] - across[b] || a - b);
  const sortedAcross = Float64Array.from(order, (k) => across[k]);

  let t = 0;
  for (const o of obstacles) {
    const gap = gapBetween(o.item, clusterRadius);
    const side = (cx - o.x) * dy - (cy - o.y) * dx;
    const ahead = (cx - o.x) * dx + (cy - o.y) * dy;
    const band = o.r + largest + gap;
    if (side >= clusterRadius + band || side <= -clusterRadius - band) continue;

    let k = lowerBound(sortedAcross, -side - band);
    for (; k < count && sortedAcross[k] < -side + band; k++) {
      const m = order[k];
      const reach = o.r + size[m] + gap;
      const offset = side + across[m];
      if (offset >= reach || offset <= -reach) continue;
      const b = ahead + along[m];
      const root = Math.sqrt(reach * reach - offset * offset);
      if (-b + root > t) {
        t = -b + root;
        if (t >= limit) return Infinity;
      }
    }
  }
  return t;
}

// Like freeDistance, with each placed item and the cluster reduced to their
// enclosing circles.
function circleDistance(
  cx: number,
  cy: number,
  dx: number,
  dy: number,
  r: number,
  placed: Placed[],
  gapBetween: (a: number, b: number) => number,
): number {
  let t = 0;
  for (const p of placed) {
    const reach = p.radius + r + gapBetween(p.radius, r);
    const side = (cx - p.x) * dy - (cy - p.y) * dx;
    if (side >= reach || side <= -reach) continue;
    const b = (cx - p.x) * dx + (cy - p.y) * dy;
    const root = Math.sqrt(reach * reach - side * side);
    t = Math.max(t, -b + root);
  }
  return t;
}

function lowerBound(values: Float64Array, target: number): number {
  let low = 0;
  let high = values.length;
  while (low < high) {
    const middle = (low + high) >> 1;
    if (values[middle] < target) low = middle + 1;
    else high = middle;
  }
  return low;
}

function recentre(members: number[], context: Context): Cluster {
  const { radius, x, y } = context;
  let minX = Infinity;
  let maxX = -Infinity;
  let minY = Infinity;
  let maxY = -Infinity;
  for (const i of members) {
    minX = Math.min(minX, x[i] - radius[i]);
    maxX = Math.max(maxX, x[i] + radius[i]);
    minY = Math.min(minY, y[i] - radius[i]);
    maxY = Math.max(maxY, y[i] + radius[i]);
  }
  const cx = (minX + maxX) / 2;
  const cy = (minY + maxY) / 2;

  let extent = 0;
  for (const i of members) {
    x[i] -= cx;
    y[i] -= cy;
    extent = Math.max(extent, Math.hypot(x[i], y[i]) + radius[i]);
  }
  return { members, radius: extent };
}

// A fixed number of position-based steps rather than a force simulation that
// runs until it settles: the result is ready before the first frame, never
// moves afterwards, and is the same on every run.
function relax(context: Context, edges: LayoutEdge[]): void {
  const { radius, x, y } = context;
  const anchorX = Float64Array.from(x);
  const anchorY = Float64Array.from(y);

  for (let step = 0; step < LAYOUT.relaxIterations; step++) {
    for (const { source, target, strength, sourceShare, targetShare } of edges) {
      const dx = x[target] - x[source];
      const dy = y[target] - y[source];
      const distance = Math.hypot(dx, dy);
      const rest = radius[source] + radius[target] + LAYOUT.starGap;
      if (distance <= rest) continue;
      const k = (LAYOUT.edgePull * strength * (distance - rest)) / distance / 2;
      x[source] += dx * k * sourceShare;
      y[source] += dy * k * sourceShare;
      x[target] -= dx * k * targetShare;
      y[target] -= dy * k * targetShare;
    }

    for (let i = 0; i < x.length; i++) {
      let dx = x[i] - anchorX[i];
      let dy = y[i] - anchorY[i];
      dx -= dx * LAYOUT.anchorPull;
      dy -= dy * LAYOUT.anchorPull;
      const drift = Math.hypot(dx, dy);
      if (drift > LAYOUT.maxDrift) {
        dx *= LAYOUT.maxDrift / drift;
        dy *= LAYOUT.maxDrift / drift;
      }
      x[i] = anchorX[i] + dx;
      y[i] = anchorY[i] + dy;
    }

    separate(context);
  }

  for (let pass = 0; pass < 4; pass++) separate(context);
}

// Pushes apart stars that are closer than their radii plus a clearance: a
// little less than the packing gap within a directory, and the smallest group
// gap between directories, so dependency pulls cannot merge two groups.
function separate(context: Context): void {
  const { directory, ids, radius, x, y } = context;
  const count = x.length;
  const within = LAYOUT.starGap * 0.8;
  const between = LAYOUT.groupGapBase;
  let largest = 0;
  for (const r of radius) largest = Math.max(largest, r);
  const cell = 2 * largest + Math.max(within, between);

  // Stars are bucketed into cells as wide as the largest possible overlap
  // distance, so only neighbouring cells are compared. Buckets hold indices in
  // ascending order, which keeps the order of pushes deterministic.
  const buckets = new Map<number, number[]>();
  const cellX = new Int32Array(count);
  const cellY = new Int32Array(count);
  for (let i = 0; i < count; i++) {
    cellX[i] = Math.floor(x[i] / cell);
    cellY[i] = Math.floor(y[i] / cell);
    const key = cellKey(cellX[i], cellY[i]);
    const bucket = buckets.get(key);
    if (bucket === undefined) buckets.set(key, [i]);
    else bucket.push(i);
  }

  for (let i = 0; i < count; i++) {
    for (let ox = -1; ox <= 1; ox++) {
      for (let oy = -1; oy <= 1; oy++) {
        const bucket = buckets.get(cellKey(cellX[i] + ox, cellY[i] + oy));
        if (bucket === undefined) continue;
        for (const j of bucket) {
          if (j <= i) continue;
          const dx = x[j] - x[i];
          const dy = y[j] - y[i];
          const min = radius[i] + radius[j] + (directory[i] === directory[j] ? within : between);
          const squared = dx * dx + dy * dy;
          if (squared >= min * min) continue;

          let distance = Math.sqrt(squared);
          let ux: number;
          let uy: number;
          if (distance < 1e-9) {
            const angle = unit(hash(`${ids[i]}\0${ids[j]}`), 1) * 2 * Math.PI;
            ux = Math.cos(angle);
            uy = Math.sin(angle);
            distance = 0;
          } else {
            ux = dx / distance;
            uy = dy / distance;
          }
          const push = (min - distance) / 2;
          x[i] -= ux * push;
          y[i] -= uy * push;
          x[j] += ux * push;
          y[j] += uy * push;
        }
      }
    }
  }
}

function cellKey(x: number, y: number): number {
  return x * 0x100000 + y;
}

function normalize(context: Context): Omit<ConstellationLayout, "groups"> {
  const { ids, radius, x, y } = context;
  const count = ids.length;
  const positions = new Map<string, Position>();
  if (count === 0) {
    return {
      positions,
      frame: { x: [-1, 1], y: [-LAYOUT.minFrameHeight, LAYOUT.minFrameHeight] },
      bounds: { x: [0, 0], y: [0, 0] },
      scale: LAYOUT.minHalfExtent,
    };
  }

  // Rotate the principal axis onto the x axis, since viewports and exported
  // images are wider than they are tall.
  let meanX = 0;
  let meanY = 0;
  for (let i = 0; i < count; i++) {
    meanX += x[i] / count;
    meanY += y[i] / count;
  }
  let xx = 0;
  let yy = 0;
  let xy = 0;
  for (let i = 0; i < count; i++) {
    const dx = x[i] - meanX;
    const dy = y[i] - meanY;
    xx += dx * dx;
    yy += dy * dy;
    xy += dx * dy;
  }
  const angle = count > 1 ? 0.5 * Math.atan2(2 * xy, xx - yy) : 0;
  const cos = Math.cos(-angle);
  const sin = Math.sin(-angle);
  for (let i = 0; i < count; i++) {
    const dx = x[i] - meanX;
    const dy = y[i] - meanY;
    x[i] = dx * cos - dy * sin;
    y[i] = dx * sin + dy * cos;
  }

  let minX = Infinity;
  let maxX = -Infinity;
  let minY = Infinity;
  let maxY = -Infinity;
  for (let i = 0; i < count; i++) {
    minX = Math.min(minX, x[i] - radius[i]);
    maxX = Math.max(maxX, x[i] + radius[i]);
    minY = Math.min(minY, y[i] - radius[i]);
    maxY = Math.max(maxY, y[i] + radius[i]);
  }
  const cx = (minX + maxX) / 2;
  const cy = (minY + maxY) / 2;
  const halfWidth = (maxX - minX) / 2;
  const halfHeight = (maxY - minY) / 2;
  const scale = Math.max(halfWidth, halfHeight, LAYOUT.minHalfExtent);

  for (let i = 0; i < count; i++) {
    positions.set(ids[i], { x: (x[i] - cx) / scale, y: (y[i] - cy) / scale });
  }
  const frameHeight = Math.max(halfHeight / scale, LAYOUT.minFrameHeight);
  return {
    positions,
    frame: { x: [-1, 1], y: [-frameHeight, frameHeight] },
    bounds: {
      x: [-halfWidth / scale, halfWidth / scale],
      y: [-halfHeight / scale, halfHeight / scale],
    },
    scale,
  };
}

// A key for a directory's own files. Paths cannot contain NUL, so it never
// equals a directory path.
function filesKey(path: string): string {
  return `${path}\0`;
}

function pairKey(a: string, b: string): string {
  return JSON.stringify(a < b ? [a, b] : [b, a]);
}

// FNV-1a over UTF-16 code units.
function hash(value: string): number {
  let result = 0x811c9dc5;
  for (let i = 0; i < value.length; i++) {
    result ^= value.charCodeAt(i);
    result = Math.imul(result, 0x01000193);
  }
  return result >>> 0;
}

// A value in [0, 1) derived from a hash and a stream number. The MurmurHash3
// finalizer spreads similar paths, whose FNV-1a hashes are close, apart.
function unit(seed: number, stream: number): number {
  let value = (seed ^ Math.imul(stream, 0x9e3779b9)) >>> 0;
  value ^= value >>> 16;
  value = Math.imul(value, 0x85ebca6b);
  value ^= value >>> 13;
  value = Math.imul(value, 0xc2b2ae35);
  value ^= value >>> 16;
  return (value >>> 0) / 0x1_0000_0000;
}
