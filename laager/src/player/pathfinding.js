// Grid-based A* used to route the player around obstacles (walls, big
// rocks/trees) it can't just slide past. A straight line to a tapped
// point isn't guaranteed to be walkable, and collision.js's per-frame
// sliding only handles brushing past something at a shallow angle — walk
// straight at the middle of a wall and sliding alone just pins you
// against it forever instead of finding the way around its end (or
// through an open door).

const DEFAULT_CELL_SIZE = 0.35; // finer than a wall's own clearance (~0.44m) so the grid doesn't miss it entirely
const PADDING = 3; // extra grid margin around the straight line start->target, enough room to route around something just off to the side
const MAX_GRID_SPAN = 130; // cap on cells per axis — bounds A*'s worst case for a very long walk across the whole map
const LINE_OF_SIGHT_STEP = 0.2;

function buildGrid(start, target) {
  let cellSize = DEFAULT_CELL_SIZE;
  const minX = Math.min(start.x, target.x) - PADDING;
  const maxX = Math.max(start.x, target.x) + PADDING;
  const minZ = Math.min(start.z, target.z) - PADDING;
  const maxZ = Math.max(start.z, target.z) + PADDING;
  let cols = Math.ceil((maxX - minX) / cellSize);
  let rows = Math.ceil((maxZ - minZ) / cellSize);
  const span = Math.max(cols, rows);
  if (span > MAX_GRID_SPAN) {
    cellSize *= span / MAX_GRID_SPAN;
    cols = Math.ceil((maxX - minX) / cellSize);
    rows = Math.ceil((maxZ - minZ) / cellSize);
  }
  return { minX, minZ, cellSize, cols, rows };
}

function cellToWorld(grid, ix, iz) {
  return { x: grid.minX + ix * grid.cellSize, z: grid.minZ + iz * grid.cellSize };
}

function worldToCell(grid, x, z) {
  return {
    ix: Math.round((x - grid.minX) / grid.cellSize),
    iz: Math.round((z - grid.minZ) / grid.cellSize),
  };
}

function inBounds(grid, ix, iz) {
  return ix >= 0 && iz >= 0 && ix < grid.cols && iz < grid.rows;
}

// Nearest free cell to (ix,iz) — used when the start or target itself
// lands in a cell the grid considers blocked (e.g. the player standing
// right up against a wall, within its own clearance radius), so a search
// doesn't fail before it even begins.
function nearestFreeCell(grid, ix, iz, cellBlocked) {
  if (inBounds(grid, ix, iz) && !cellBlocked(ix, iz)) return { ix, iz };
  for (let r = 1; r <= 6; r++) {
    for (let dx = -r; dx <= r; dx++) {
      for (let dz = -r; dz <= r; dz++) {
        if (Math.max(Math.abs(dx), Math.abs(dz)) !== r) continue;
        const nx = ix + dx, nz = iz + dz;
        if (!inBounds(grid, nx, nz) || cellBlocked(nx, nz)) continue;
        return { ix: nx, iz: nz };
      }
    }
  }
  return { ix, iz }; // nothing free nearby — let the caller's normal blocked-movement handling take over
}

const NEIGHBORS = [
  [1, 0, 1], [-1, 0, 1], [0, 1, 1], [0, -1, 1],
  [1, 1, Math.SQRT2], [1, -1, Math.SQRT2], [-1, 1, Math.SQRT2], [-1, -1, Math.SQRT2],
];

// Binary min-heap keyed by fScore — the grid can be a few thousand cells
// for a long walk, so scanning the whole open set for its minimum on
// every iteration (the "simple" way) would cost too much to run on tap.
class MinHeap {
  constructor() { this.items = []; }
  get size() { return this.items.length; }
  push(item, priority) {
    this.items.push({ item, priority });
    let i = this.items.length - 1;
    while (i > 0) {
      const parent = (i - 1) >> 1;
      if (this.items[parent].priority <= this.items[i].priority) break;
      [this.items[parent], this.items[i]] = [this.items[i], this.items[parent]];
      i = parent;
    }
  }
  pop() {
    const top = this.items[0];
    const last = this.items.pop();
    if (this.items.length) {
      this.items[0] = last;
      let i = 0;
      for (;;) {
        const l = i * 2 + 1, r = i * 2 + 2;
        let smallest = i;
        if (l < this.items.length && this.items[l].priority < this.items[smallest].priority) smallest = l;
        if (r < this.items.length && this.items[r].priority < this.items[smallest].priority) smallest = r;
        if (smallest === i) break;
        [this.items[smallest], this.items[i]] = [this.items[i], this.items[smallest]];
        i = smallest;
      }
    }
    return top?.item;
  }
}

// String-pulling: collapses the raw one-point-per-cell grid path down to
// only the corners actually needed, by keeping a point only once the
// straight line from the last kept point would cross an obstacle if
// extended past it.
function simplify(points, isBlockedWorld) {
  if (points.length <= 2) return points;
  const result = [points[0]];
  let anchor = 0;
  for (let i = 1; i < points.length - 1; i++) {
    if (!hasLineOfSight(points[anchor], points[i + 1], isBlockedWorld)) {
      result.push(points[i]);
      anchor = i;
    }
  }
  result.push(points[points.length - 1]);
  return result;
}

function hasLineOfSight(a, b, isBlockedWorld) {
  const dist = Math.hypot(b.x - a.x, b.z - a.z);
  const steps = Math.max(1, Math.ceil(dist / LINE_OF_SIGHT_STEP));
  for (let i = 1; i < steps; i++) {
    const t = i / steps;
    if (isBlockedWorld(a.x + (b.x - a.x) * t, a.z + (b.z - a.z) * t)) return false;
  }
  return true;
}

// isBlockedWorld(x, z) -> boolean — the caller already knows which
// obstacles/floor apply (see collision.js's `blocked`), pathfinding just
// needs a yes/no per point. Returns a list of {x,z} waypoints from just
// after `start` up to and including `target` (never empty when a route
// exists), or null if no route exists at all (e.g. target is inside a
// fully sealed room) — the caller should fall back to its old
// straight-line behavior in that case.
export function findPath(start, target, isBlockedWorld) {
  // Common case: nothing at all in the way — skip A* entirely.
  if (hasLineOfSight(start, target, isBlockedWorld)) return [target];

  const grid = buildGrid(start, target);
  const cellBlocked = (ix, iz) => {
    const { x, z } = cellToWorld(grid, ix, iz);
    return isBlockedWorld(x, z);
  };

  const startRaw = worldToCell(grid, start.x, start.z);
  const goalRaw = worldToCell(grid, target.x, target.z);
  const startCell = nearestFreeCell(grid, startRaw.ix, startRaw.iz, cellBlocked);
  const goalCell = nearestFreeCell(
    grid,
    Math.max(0, Math.min(grid.cols - 1, goalRaw.ix)),
    Math.max(0, Math.min(grid.rows - 1, goalRaw.iz)),
    cellBlocked
  );

  const key = (ix, iz) => iz * grid.cols + ix;
  if (startCell.ix === goalCell.ix && startCell.iz === goalCell.iz) return [target];

  const gScore = new Map([[key(startCell.ix, startCell.iz), 0]]);
  const cameFrom = new Map();
  const closed = new Set();
  const h = (ix, iz) => Math.hypot(ix - goalCell.ix, iz - goalCell.iz);
  const open = new MinHeap();
  open.push(startCell, h(startCell.ix, startCell.iz));

  const MAX_ITER = grid.cols * grid.rows; // every cell is settled at most once anyway; this just bounds pathological cases
  let iter = 0;
  let found = null;

  while (open.size && iter++ < MAX_ITER) {
    const current = open.pop();
    const ckey = key(current.ix, current.iz);
    if (closed.has(ckey)) continue;
    closed.add(ckey);
    if (current.ix === goalCell.ix && current.iz === goalCell.iz) { found = current; break; }

    for (const [dx, dz, cost] of NEIGHBORS) {
      const nx = current.ix + dx, nz = current.iz + dz;
      if (!inBounds(grid, nx, nz) || cellBlocked(nx, nz)) continue;
      // Disallow cutting diagonally through the corner formed by two
      // orthogonally-blocked cells — otherwise a diagonal step can clip
      // straight through a wall corner a real, non-zero-radius player
      // couldn't actually fit past.
      if (dx !== 0 && dz !== 0 && (cellBlocked(current.ix + dx, current.iz) || cellBlocked(current.ix, current.iz + dz))) continue;
      const nkey = key(nx, nz);
      if (closed.has(nkey)) continue;
      const tentativeG = gScore.get(ckey) + cost;
      if (tentativeG < (gScore.get(nkey) ?? Infinity)) {
        gScore.set(nkey, tentativeG);
        cameFrom.set(nkey, current);
        open.push({ ix: nx, iz: nz }, tentativeG + h(nx, nz));
      }
    }
  }

  if (!found) return null;

  // Reconstruct the cell chain from goal back to start, then reverse it.
  const cellPath = [found];
  let curKey = key(found.ix, found.iz);
  while (cameFrom.has(curKey)) {
    const prev = cameFrom.get(curKey);
    cellPath.push(prev);
    curKey = key(prev.ix, prev.iz);
  }
  cellPath.reverse(); // [startCell, ..., goalCell]

  // Swap in the *actual* start/target points instead of their snapped
  // cell centers, so the player ends up exactly where they tapped rather
  // than at a grid-rounded position next to it.
  const worldPoints = [start, ...cellPath.slice(1).map((c) => cellToWorld(grid, c.ix, c.iz)), target];

  return simplify(worldPoints, isBlockedWorld).slice(1); // drop `start` — callers want waypoints after it
}
