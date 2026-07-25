import { STRUCTURES, SNAP_SIZE } from "./structures.js";
import { createPlacementGhost } from "./placementGhost.js";
import { addShadowBlob } from "../core/shadowDecals.js";

const BUILD_RADIUS = 6.5; // how far from camp you can place structures
const DOOR_OPEN_ANGLE = -Math.PI / 2; // swung flush against the wall it's hinged to
const NEIGHBOR_SEARCH_RADIUS = 2.2; // how close a tap must be to an existing edge to snap onto it
const TOP_SEARCH_RADIUS = 1.6; // how close a tap must be to snap a roof/platform onto a top
const LADDER_SEARCH_RADIUS = 2.0; // how close a tap must be to a platform to attach a ladder

function snap(v) {
  return Math.round(v / SNAP_SIZE) * SNAP_SIZE;
}

// Structures default to facing tangent to the camp center, so placing one
// with no neighbors nearby still leans toward curving into a palisade ring.
function tangentRotation(x, z) {
  return Math.atan2(x, z) + Math.PI / 2;
}

function clampToBuildRadius(point) {
  const len = Math.hypot(point.x, point.z);
  if (len <= BUILD_RADIUS) return { x: point.x, z: point.z };
  const s = BUILD_RADIUS / len;
  return { x: point.x * s, z: point.z * s };
}

export function forward(rotY) {
  return { x: Math.cos(rotY), z: -Math.sin(rotY) };
}

// The two open ends of a placed structure, in world space, each carrying
// the structure's own facing and base height as the "continue straight
// from here" default.
function endPoints(p) {
  const dir = forward(p.rotY);
  const half = p.structure.width / 2;
  return [
    { x: p.x + dir.x * half, z: p.z + dir.z * half, y: p.y, rotY: p.rotY },
    { x: p.x - dir.x * half, z: p.z - dir.z * half, y: p.y, rotY: p.rotY },
  ];
}

// Local-to-world for a point in a placed structure's own (rotated) frame
// — the exact inverse of the world-to-local step in platformSurfaceAt(),
// so a corner/edge computed here always lands where the footprint test
// (and the actual rendered mesh) agrees it should.
function localToWorld(p, lx, lz) {
  const cos = Math.cos(p.rotY), sin = Math.sin(p.rotY);
  return { x: p.x + lx * cos + lz * sin, z: p.z - lx * sin + lz * cos };
}

// A platform's 4 corners, at its own walkable height — lets a wall snap
// onto a platform's perimeter (to trace a house's outline on top of it)
// the same way walls snap onto each other's ends. Each corner's default
// rotY faces along the edge toward the *next* corner (not just copied
// from the platform's own rotY) — with a square footprint, "local +X"
// is only ever the correct tangent for two of the four corners, so
// copying the platform's rotY blindly sent the other two corners' walls
// straight off the platform's far side and down to ground height.
function platformCorners(p) {
  const half = p.structure.width / 2;
  const y = p.y + p.structure.height;
  const local = [[half, half], [half, -half], [-half, -half], [-half, half]]; // cyclic order around the perimeter
  const world = local.map(([lx, lz]) => localToWorld(p, lx, lz));
  return world.map((c, i) => {
    const next = world[(i + 1) % world.length];
    const tx = next.x - c.x, tz = next.z - c.z;
    const len = Math.hypot(tx, tz) || 1;
    const rotY = Math.atan2(-tz / len, tx / len); // forward(rotY) === this tangent
    return { x: c.x, z: c.z, y, rotY };
  });
}

// Nearest open end of a placed wall, or nearest corner of a placed
// platform, to the tap point — close enough to count as "aiming at that
// corner" rather than free placement. Posts/roofs/ladders have a "width"
// field for unrelated reasons (snapping things onto their top), not a
// wall-style open end, so they're excluded here.
function findNearestCorner(point, placed) {
  let best = null, bestDist = Infinity;
  for (const p of placed) {
    let ends;
    if (p.structure.snapMode === "edge") ends = endPoints(p);
    else if (p.structure.id === "platform") ends = platformCorners(p);
    else continue;
    for (const end of ends) {
      const d = Math.hypot(end.x - point.x, end.z - point.z);
      if (d < NEIGHBOR_SEARCH_RADIUS && d < bestDist) {
        bestDist = d;
        best = end;
      }
    }
  }
  return best;
}

const PLATFORM_EDGE_SEARCH_RADIUS = 1.0; // how close a tap must be to an empty tile-slot next to a platform to snap a new one flush against it

// The 4 empty tile-slots directly adjacent to a placed platform's edges.
// Snapping here (instead of onto the world grid) keeps a floor of tiles
// perfectly seamless regardless of what odd angle the supporting posts
// happen to sit at.
function findNearestPlatformNeighbor(point, placed) {
  let best = null, bestDist = Infinity;
  for (const p of placed) {
    if (p.structure.id !== "platform") continue;
    const w = p.structure.width;
    for (const [lx, lz] of [[w, 0], [-w, 0], [0, w], [0, -w]]) {
      const { x, z } = localToWorld(p, lx, lz);
      if (placed.some((q) => q.structure.id === "platform" && Math.hypot(q.x - x, q.z - z) < 0.3)) continue; // slot already filled
      const d = Math.hypot(x - point.x, z - point.z);
      if (d < PLATFORM_EDGE_SEARCH_RADIUS && d < bestDist) {
        bestDist = d;
        best = { x, z, y: p.y, rotY: p.rotY };
      }
    }
  }
  return best;
}

// Nearest placed structure's *top* (its own footprint, at its own height)
// to the tap point — this is how roofs/platforms rest on top of a wall or
// post instead of snapping to its side edge.
function findNearestTop(point, placed, filterFn) {
  let best = null, bestDist = Infinity;
  for (const p of placed) {
    if (p.structure.height == null) continue;
    if (filterFn && !filterFn(p)) continue;
    const d = Math.hypot(p.x - point.x, p.z - point.z);
    if (d < TOP_SEARCH_RADIUS && d < bestDist) {
      bestDist = d;
      best = { x: p.x, z: p.z, y: p.y + p.structure.height, rotY: p.rotY };
    }
  }
  return best;
}

const ROOF_SPAN_MIN = 0.6; // shorter than this and a partner is basically on top of the anchor already
const ROOF_SPAN_MAX = 6.0; // generous — covers a multi-tile room (e.g. a 3-wide house), not just one platform tile
const ROOF_SPAN_COS_TOL = Math.cos(0.5); // partner must be within ~28° of straight ahead
const ROOF_SPAN_PARALLEL_TOL = 0.35; // ~20° — a wall run's *own* rotY, not just its position

// Smallest angle between two wall orientations, treating rotY and
// rotY+π as identical (a wall's "forward" is arbitrary — which end was
// built first — so only the line it lies along matters here).
function angleBetweenLines(a, b) {
  let d = (a - b) % Math.PI;
  if (d > Math.PI / 2) d -= Math.PI;
  else if (d < -Math.PI / 2) d += Math.PI;
  return Math.abs(d);
}

// A second nearby *wall*, roughly where the roof's slope is currently
// facing, for the eave to rest on exactly instead of hanging in open
// air — this is what turns the roof from a one-sided overhang into a
// proper span between two walls (e.g. opposite sides of a house). Search
// direction follows the roof's *current* rotation, so turning it with
// the rotate button re-aims the search instead of just spinning in place.
// Only walls count as a partner — a post/platform in the middle of the
// house is often the *nearest* candidate but isn't what the eave should
// rest on, so including them here used to snap the roof down onto the
// support post instead of across to the far wall.
//
// The true opposite wall of a room always runs *parallel* to the anchor
// wall (same rotY, since both close off the same span) — a gable/end
// wall is perpendicular. Without that check, a gable-wall segment a
// couple tiles further along (not the one right at the corner, but the
// next one down) can land close enough and just barely inside the angle
// cone to out-compete the true, much-farther-away opposite wall on raw
// distance — which is exactly what made end-of-room roof segments (the
// ones with a gable wall nearby) refuse to span while the middle one,
// with no gable wall close enough to confuse it, worked fine.
function findRoofSpanPartner(anchor, rotY, placed) {
  const dir = { x: Math.sin(rotY), z: Math.cos(rotY) }; // world dir of the roof's local +Z (slope)
  let best = null, bestDist = Infinity;
  for (const p of placed) {
    if (p.structure.snapMode !== "edge") continue; // walls only
    if (p.x === anchor.x && p.z === anchor.z) continue; // that's the anchor itself
    if (angleBetweenLines(p.rotY, rotY) > ROOF_SPAN_PARALLEL_TOL) continue; // must run parallel to the anchor
    const dx = p.x - anchor.x, dz = p.z - anchor.z;
    const dist = Math.hypot(dx, dz);
    if (dist < ROOF_SPAN_MIN || dist > ROOF_SPAN_MAX) continue;
    if ((dx * dir.x + dz * dir.z) / dist < ROOF_SPAN_COS_TOL) continue;
    if (dist < bestDist) {
      bestDist = dist;
      best = { x: p.x, z: p.z, y: p.y + p.structure.height };
    }
  }
  return best;
}

// If (x,z) is over a placed platform, the height of its walkable surface —
// so a wall/post built there sits on the platform instead of at ground
// level, and the player standing on it doesn't sink to the ground. Tests
// against the platform's actual (rotated) square footprint rather than an
// approximated circle, so a wall snapped right at the platform's edge is
// judged correctly instead of by a fuzzy distance guess.
export function platformSurfaceAt(x, z, placed) {
  let best = null;
  for (const p of placed) {
    if (p.structure.id !== "platform") continue;
    const dx = x - p.x, dz = z - p.z;
    // NB: this must use +p.rotY, not -p.rotY — it has to be the exact
    // inverse of localToWorld() below (which itself matches how three.js
    // actually renders mesh.rotation.y), or a rotated platform's tested
    // footprint stops matching its visible one and only the dead center
    // (where rotation doesn't matter) still resolves as "on the platform".
    const cos = Math.cos(p.rotY), sin = Math.sin(p.rotY);
    const lx = dx * cos - dz * sin;
    const lz = dx * sin + dz * cos;
    // +2cm margin: a wall built flush along the platform's rim (exactly
    // the intended use, see findNearestCorner) puts its center right at
    // this boundary, where float rounding alone can push it a hair past
    // a strict <= — the margin absorbs that instead of the wall dropping
    // to ground height for no visible reason.
    const half = p.structure.width / 2 + 0.02;
    if (Math.abs(lx) <= half && Math.abs(lz) <= half) {
      const y = p.y + p.structure.height;
      if (best === null || y > best) best = y;
    }
  }
  return best;
}

// Nearest point on a nearby platform's (approximated circular) edge,
// facing outward — where a ladder plants its feet on the ground.
function findLadderAnchor(point, placed) {
  let best = null, bestDist = Infinity;
  for (const p of placed) {
    if (p.structure.id !== "platform") continue;
    const d = Math.hypot(p.x - point.x, p.z - point.z);
    if (d > LADDER_SEARCH_RADIUS) continue;
    const away = { x: point.x - p.x, z: point.z - p.z };
    const len = Math.hypot(away.x, away.z) || 1;
    const nx = away.x / len, nz = away.z / len;
    const half = p.structure.width / 2;
    const anchorX = p.x + nx * half;
    const anchorZ = p.z + nz * half;
    const dd = Math.hypot(anchorX - point.x, anchorZ - point.z);
    if (dd < bestDist) {
      bestDist = dd;
      best = { x: anchorX, z: anchorZ, rotY: Math.atan2(nx, nz) };
    }
  }
  return best;
}

export function createBuildMode({ scene, palette, shadowMat, resources, terrainHeight }) {
  const ghost = createPlacementGhost(scene, palette);
  const placed = []; // {x, y, z, rotY, structure, mesh, shadowMesh}
  let active = false;
  let demolish = false;
  let selected = null;
  let pending = null; // {x, y, z, rotY, structure, affordable}

  // How the current placement is anchored:
  // - "edge" + pivot set: locked onto a neighbor's corner — rotating swings
  //   the piece around that point (lets you turn a 90° corner).
  // - "edge" + no pivot: free grid cell — rotating spins the piece in place.
  // - "free"/"top"/"topPost"/"ladder": resting at a fixed anchor point
  //   (ground, or on top of/against something) — rotating spins in place.
  let mode = "edge";
  let pivot = null;
  let freeCenter = null;
  let anchorY = 0;
  let currentRotY = 0;

  function clearPending() {
    pending = null;
    ghost.hide();
  }

  function commitGhost() {
    let x, z, y;
    if (mode === "edge" && pivot) {
      const dir = forward(currentRotY);
      x = pivot.x + dir.x * (selected.width / 2);
      z = pivot.z + dir.z * (selected.width / 2);
      // Re-derive height from what's actually under the new spot rather
      // than blindly inheriting the neighbor's — otherwise chaining walls
      // off the edge of a platform leaves them floating at platform height
      // instead of dropping back down to the ground.
      y = platformSurfaceAt(x, z, placed) ?? terrainHeight(x, z);
    } else {
      x = freeCenter.x; z = freeCenter.z; y = anchorY;
    }

    let buildArgs;
    if (selected.spansToOpposite) {
      const partner = findRoofSpanPartner({ x, z, y }, currentRotY, placed);
      if (!partner && selected.requiresSpan) {
        // e.g. a ridge roof needs a wall on both sides — refuse rather
        // than build a lopsided peak with nothing under one half of it
        pending = null;
        ghost.hide();
        return;
      }
      buildArgs = partner
        ? { span: Math.hypot(partner.x - x, partner.z - z), drop: y - partner.y }
        : undefined;
      ghost.setShape(selected, buildArgs); // re-shape: span/drop can change every tap or rotate
    }

    ghost.moveTo(x, y, z, currentRotY);
    const affordable = resources.canAfford(selected.cost);
    ghost.setValid(affordable);
    pending = { x, y, z, rotY: currentRotY, structure: selected, affordable, buildArgs };
  }

  return {
    get active() { return active; },
    get demolishActive() { return demolish; },
    get selectedId() { return selected ? selected.id : null; },
    get canConfirm() { return !!(pending && pending.affordable); },
    get placed() { return placed; },

    toggle(force) {
      active = force !== undefined ? force : !active;
      if (active) demolish = false;
      if (!active) {
        selected = null;
        pending = null;
        pivot = null;
        ghost.clear();
      }
      return active;
    },

    toggleDemolish(force) {
      demolish = force !== undefined ? force : !demolish;
      if (demolish) this.toggle(false);
      return demolish;
    },

    selectStructure(id) {
      selected = STRUCTURES[id] || null;
      pending = null;
      pivot = null;
      if (selected) ghost.setShape(selected);
      else ghost.clear();
    },

    handleTap(point) {
      if (!active || !selected) return;
      const clamped = clampToBuildRadius(point);
      mode = selected.snapMode;

      if (mode === "edge") {
        const corner = findNearestCorner(clamped, placed);
        if (corner) {
          pivot = { x: corner.x, z: corner.z, y: corner.y };
          currentRotY = corner.rotY; // default: continue straight from this end
        } else {
          pivot = null;
          const gx = snap(clamped.x), gz = snap(clamped.z);
          freeCenter = { x: gx, z: gz };
          anchorY = platformSurfaceAt(gx, gz, placed) ?? terrainHeight(gx, gz);
          currentRotY = tangentRotation(gx, gz);
        }
        commitGhost();
        return;
      }

      if (mode === "free") {
        pivot = null;
        const gx = snap(clamped.x), gz = snap(clamped.z);
        freeCenter = { x: gx, z: gz };
        anchorY = platformSurfaceAt(gx, gz, placed) ?? terrainHeight(gx, gz);
        currentRotY = tangentRotation(gx, gz);
        commitGhost();
        return;
      }

      if (mode === "topPost") {
        // Prefer snapping flush against an existing platform tile (for a
        // seamless floor) over resting fresh on a post's top.
        const neighbor = findNearestPlatformNeighbor(clamped, placed);
        const anchor = neighbor || findNearestTop(clamped, placed, (p) => p.structure.id === "post");
        if (!anchor) { clearPending(); return; } // nothing to rest on — refuse rather than float
        pivot = null;
        freeCenter = { x: anchor.x, z: anchor.z };
        anchorY = anchor.y;
        currentRotY = anchor.rotY;
        commitGhost();
        return;
      }

      if (mode === "top") {
        const filter = selected.topFilter === "wall" ? (p) => p.structure.snapMode === "edge" : null;
        const anchor = findNearestTop(clamped, placed, filter);
        if (!anchor) { clearPending(); return; } // nothing to rest on — refuse rather than float
        pivot = null;
        freeCenter = { x: anchor.x, z: anchor.z };
        anchorY = anchor.y;
        currentRotY = anchor.rotY;
        // A roof's default facing is a coin flip between "toward the
        // house interior" and "out over open air" — if the default comes
        // up empty but flipping 180° finds a wall to span to, take that
        // instead, so tapping a wall just works without a manual rotate.
        if (selected.spansToOpposite
          && !findRoofSpanPartner(anchor, currentRotY, placed)
          && findRoofSpanPartner(anchor, currentRotY + Math.PI, placed)) {
          currentRotY += Math.PI;
        }
        commitGhost();
        return;
      }

      if (mode === "ladder") {
        const anchor = findLadderAnchor(clamped, placed);
        if (!anchor) { clearPending(); return; } // no platform nearby to lean against
        pivot = null;
        freeCenter = { x: anchor.x, z: anchor.z };
        anchorY = terrainHeight(anchor.x, anchor.z);
        currentRotY = anchor.rotY;
        commitGhost();
        return;
      }
    },

    // Nudges the pending piece's angle. With an edge-pivot locked (built
    // onto an existing corner) this swings around that corner — e.g. one
    // 90° turn to close a square instead of only ever extending in a
    // straight line. Otherwise it just spins the piece in place.
    rotate(stepRad) {
      if (!pending) return;
      currentRotY += stepRad;
      commitGhost();
    },

    confirm() {
      if (!pending || !pending.affordable) return false;
      resources.spend(pending.structure.cost);
      const mesh = pending.structure.build(palette, pending.buildArgs);
      mesh.position.set(pending.x, pending.y, pending.z);
      mesh.rotation.y = pending.rotY;
      scene.add(mesh);
      const shadowMesh = addShadowBlob(scene, shadowMat, pending.x, pending.z, pending.structure.shadowRadius);
      const entry = { x: pending.x, y: pending.y, z: pending.z, rotY: pending.rotY, structure: pending.structure, mesh, shadowMesh };
      if (pending.structure.id === "door") entry.open = false;
      placed.push(entry);
      pending = null;
      pivot = null;
      ghost.hide();
      return true;
    },

    // Swings a placed door open/closed — the leaf's own visual hinge
    // rotation lives on mesh.userData.leaf (see structures.buildDoor);
    // collision just checks the .open flag directly, ignoring the swing
    // angle, since a "half-open" door is still fully walkable in this
    // stylized game. Prefers the exact door a raycast hit (hitObject),
    // same reasoning as tryDemolish, falling back to nearest-by-distance.
    tryToggleDoor(point, hitObject) {
      let door = null;
      if (hitObject) {
        let obj = hitObject;
        while (obj && !door) {
          door = placed.find((p) => p.structure.id === "door" && p.mesh === obj) || null;
          obj = obj.parent;
        }
      }
      if (!door) {
        door = placed.find((p) => p.structure.id === "door" && Math.hypot(p.x - point.x, p.z - point.z) <= p.structure.shadowRadius + 0.3) || null;
      }
      if (!door) return false;
      door.open = !door.open;
      const leaf = door.mesh.userData.leaf;
      if (leaf) leaf.rotation.y = door.open ? DOOR_OPEN_ANGLE : 0;
      return true;
    },

    // Removes the tapped structure and refunds its full cost. `hitObject`
    // (the actual mesh a raycast landed on, if any) lets this remove
    // exactly what was tapped — important once a structure sits up on a
    // platform, where its (x,z) can be a fair distance from the point a
    // ground-projected tap infers. Falls back to nearest-by-distance
    // (e.g. a demolished-mid-air miss, or a thin structure the ray missed)
    // when there's no direct hit.
    tryDemolish(point, hitObject) {
      if (!demolish) return false;
      let best = null, bestIndex = -1;
      if (hitObject) {
        let obj = hitObject;
        while (obj && best === null) {
          const i = placed.findIndex((p) => p.mesh === obj);
          if (i !== -1) { best = placed[i]; bestIndex = i; }
          obj = obj.parent;
        }
      }
      if (!best) {
        let bestDist = Infinity;
        placed.forEach((p, i) => {
          const d = Math.hypot(p.x - point.x, p.z - point.z);
          if (d < p.structure.shadowRadius + 0.3 && d < bestDist) {
            bestDist = d; best = p; bestIndex = i;
          }
        });
      }
      if (!best) return false;
      scene.remove(best.mesh);
      scene.remove(best.shadowMesh);
      resources.refund(best.structure.cost);
      placed.splice(bestIndex, 1);
      return true;
    },
  };
}
