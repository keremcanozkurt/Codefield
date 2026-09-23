export type Position = { x: number; y: number };

// Each node is placed in the unit disk from a hash of its ID alone. The same
// repository renders the same way on every load, input order has no effect,
// and a file keeps its position when other files are added or removed. The
// renderer rescales coordinates to the viewport, so the unit disk is enough.
export function layoutNodes(ids: Iterable<string>): Map<string, Position> {
  const positions = new Map<string, Position>();

  for (const id of ids) {
    const hash = fnv1a(id);
    const angle = unit(mix(hash)) * 2 * Math.PI;
    // The square root spreads points evenly over the area instead of
    // crowding them around the centre.
    const radius = Math.sqrt(unit(mix(hash ^ 0x9e3779b9)));
    positions.set(id, { x: radius * Math.cos(angle), y: radius * Math.sin(angle) });
  }

  return positions;
}

// FNV-1a over UTF-16 code units.
function fnv1a(value: string): number {
  let hash = 0x811c9dc5;
  for (let i = 0; i < value.length; i++) {
    hash ^= value.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}

// MurmurHash3 finalizer. FNV-1a alone leaves similar paths with similar
// hashes, which would place neighbouring files on the same arc.
function mix(value: number): number {
  let hash = value >>> 0;
  hash ^= hash >>> 16;
  hash = Math.imul(hash, 0x85ebca6b);
  hash ^= hash >>> 13;
  hash = Math.imul(hash, 0xc2b2ae35);
  hash ^= hash >>> 16;
  return hash >>> 0;
}

function unit(value: number): number {
  return value / 0x1_0000_0000;
}
