import * as THREE from "three";

// A wall's full span, edge-to-edge — deliberately equal to a platform's
// own width (see structures.platform below) so a single wall segment
// exactly closes one platform edge corner-to-corner, with no leftover
// gap and no overlap.
export const WALL_SPAN = 1.3;

// Grid cell size for free/unanchored placement (posts, and a wall/door
// with no neighbor to snap onto) — kept equal to WALL_SPAN so a post
// dropped straight onto the grid always ends up exactly one wall-span
// from its neighbors, the same spacing chained walls/platforms already
// use. When these two didn't match, four independently-placed posts in a
// square wouldn't actually be a clean square in platform-width terms —
// platforms built on top of them would overlap or gap instead of tiling
// seamlessly.
export const SNAP_SIZE = WALL_SPAN;

// How high a ridge roof's peak sits above the wall tops it spans between
// — shared with the gable-end wall so its triangle exactly fills the gap
// under a ridge roof at that height.
export const ROOF_RISE = 0.5;

// transparent:true (at opacity 1, visually identical to opaque) so the
// cutaway system can fade walls/roofs in place without ever recompiling
// the material — only cheap while there are just a handful of structures.
function mat(palette, key, extra = {}) {
  return new THREE.MeshStandardMaterial({ color: palette[key], flatShading: true, roughness: 0.9, transparent: true, ...extra });
}

// A dry-stone wall built from staggered courses of irregular boulders —
// the same low-poly icosahedron primitive as the scattered natural rocks
// elsewhere in the scene, so a built wall reads as piled fieldstone
// instead of cut/poured blocks. Still just two draw calls (backing +
// one InstancedMesh for every boulder).
function buildStoneWall(palette) {
  const W = WALL_SPAN, D = 0.28;
  const rows = [
    { y0: 0, h: 0.26, count: 4 },
    { y0: 0.24, h: 0.26, count: 5 },
    { y0: 0.48, h: 0.3, count: 4 },
  ];
  const totalHeight = rows[rows.length - 1].y0 + rows[rows.length - 1].h;
  const group = new THREE.Group();

  // The boulders themselves are round and irregularly sized/spaced (that's
  // what sells "piled fieldstone" over "cut blocks"), which necessarily
  // leaves real gaps between them — with nothing behind those gaps, the
  // wall reads as see-through rather than solid. A slab in a dark
  // shadow/mortar tone, sized just inside the boulders' own footprint so
  // it never pokes out past them from a normal viewing angle, closes that
  // without flattening the bumpy silhouette that makes it look natural.
  const backingMat = mat(palette, "stoneBuilt", { color: new THREE.Color(palette.stoneBuilt).multiplyScalar(0.35) });
  const backing = new THREE.Mesh(new THREE.BoxGeometry(W - 0.15, totalHeight - 0.04, D * 0.5), backingMat);
  backing.position.set(0, totalHeight / 2, 0);
  group.add(backing);

  const stoneMat = mat(palette, "stoneBuilt");
  const total = rows.reduce((s, r) => s + r.count, 0);
  const mesh = new THREE.InstancedMesh(new THREE.IcosahedronGeometry(0.5, 0), stoneMat, total);

  const m = new THREE.Matrix4(), q = new THREE.Quaternion(), color = new THREE.Color();
  let i = 0;
  rows.forEach((row, rowIndex) => {
    const cellW = W / row.count;
    const stagger = rowIndex % 2 === 1 ? cellW * 0.4 : 0;
    for (let c = 0; c < row.count; c++) {
      const cx = -W / 2 + cellW * (c + 0.5) + stagger + (Math.random() - 0.5) * cellW * 0.15;
      const sx = cellW * (0.55 + Math.random() * 0.2);
      const sy = row.h * (0.5 + Math.random() * 0.35);
      const sz = D * (0.45 + Math.random() * 0.3);
      const cy = row.y0 + sy * 0.55;
      const cz = (Math.random() - 0.5) * 0.04;
      q.setFromEuler(new THREE.Euler(Math.random() * Math.PI, Math.random() * Math.PI, Math.random() * Math.PI));
      m.compose(new THREE.Vector3(cx, cy, cz), q, new THREE.Vector3(sx, sy, sz));
      mesh.setMatrixAt(i, m);
      color.set(palette.stoneBuilt).multiplyScalar(0.8 + Math.random() * 0.35);
      mesh.setColorAt(i, color);
      i++;
    }
  });
  group.add(mesh);
  return group;
}

// A sloped roof panel: wood rafters + ridge beam under a grass thatch
// layer. Its local origin is the ridge (the edge that sits on a
// wall's/post's top), sloping down toward the eave.
//
// span/drop default to a fixed overhang (a one-sided lean-to, for a
// roof built against a single wall with nothing opposite it) but
// buildMode passes exact values whenever it finds a second wall/post
// roughly where the eave would land — then the eave sits exactly on
// that support instead of hanging unattached in open air.
function buildRoof(palette, span = 0.95, drop = 0.35) {
  const group = new THREE.Group();
  const W = WALL_SPAN;
  const woodMat = mat(palette, "trunk");
  const grassMat = mat(palette, "grass");

  const slopeVec = new THREE.Vector3(0, -drop, span);
  const slopeLen = slopeVec.length();
  const slopeDir = slopeVec.clone().normalize();
  const mid = slopeVec.clone().multiplyScalar(0.5); // origin (0,0,0) IS the ridge

  const rafterQuat = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), slopeDir);
  const rafterGeo = new THREE.CylinderGeometry(0.045, 0.05, slopeLen, 5);
  [-W / 2 + 0.12, 0, W / 2 - 0.12].forEach((x) => {
    const rafter = new THREE.Mesh(rafterGeo, woodMat);
    rafter.position.set(x, mid.y, mid.z);
    rafter.quaternion.copy(rafterQuat);
    group.add(rafter);
  });

  const ridge = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.06, W, 6), woodMat);
  ridge.rotation.z = Math.PI / 2;
  group.add(ridge);

  const thatchQuat = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 0, 1), slopeDir);
  const thatch = new THREE.Mesh(new THREE.BoxGeometry(W, 0.06, slopeLen), grassMat);
  thatch.position.set(0, mid.y + 0.05, mid.z);
  thatch.quaternion.copy(thatchQuat);
  group.add(thatch);

  return group;
}

// A symmetric ridge (gable/"ryggås") roof: two sloped halves meeting at a
// central peak, instead of one panel hanging off a single wall. Local
// origin is still the near eave (the anchor wall's top, same convention
// as buildRoof), climbing to the peak at the span's midpoint then back
// down to the far eave — so it reads as a proper house roof rather than
// a lean-to, and (like buildRoof) buildMode sizes span/drop to the exact
// gap to whatever wall it finds across the room.
function buildRidgeRoof(palette, span = 1.3, drop = 0, rise = ROOF_RISE) {
  const group = new THREE.Group();
  const W = WALL_SPAN;
  const woodMat = mat(palette, "trunk");
  const grassMat = mat(palette, "grass");

  const near = new THREE.Vector3(0, 0, 0);
  const peak = new THREE.Vector3(0, rise, span / 2);
  const far = new THREE.Vector3(0, -drop, span);

  function addSlope(from, to) {
    const vec = to.clone().sub(from);
    const len = vec.length();
    const dir = vec.clone().normalize();
    const mid = from.clone().add(to).multiplyScalar(0.5);

    const rafterQuat = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir);
    const rafterGeo = new THREE.CylinderGeometry(0.04, 0.045, len, 5);
    [-W / 2 + 0.12, 0, W / 2 - 0.12].forEach((x) => {
      const rafter = new THREE.Mesh(rafterGeo, woodMat);
      rafter.position.set(x, mid.y, mid.z);
      rafter.quaternion.copy(rafterQuat);
      group.add(rafter);
    });

    const thatchQuat = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 0, 1), dir);
    const thatch = new THREE.Mesh(new THREE.BoxGeometry(W, 0.06, len), grassMat);
    thatch.position.set(0, mid.y + 0.05, mid.z);
    thatch.quaternion.copy(thatchQuat);
    group.add(thatch);
  }

  addSlope(near, peak);
  addSlope(peak, far);

  const ridge = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.06, W, 6), woodMat);
  ridge.rotation.z = Math.PI / 2;
  ridge.position.copy(peak);
  group.add(ridge);

  return group;
}

// A triangular infill panel for a ridge roof's gable end — sits on top
// of a wall (like a roof) and fills the gap between the wall's flat top
// and the sloped underside of a ridge roof at ROOF_RISE height, closing
// off what would otherwise be an open triangular gap under the peak.
// span defaults to one WALL_SPAN-wide wall segment, but buildMode passes
// the *whole* connected wall run's actual length (see findWallRunSpan in
// buildMode.js) so a multi-segment gable end gets one properly-sized
// triangle reaching the real ridge peak, instead of several small
// mismatched ones that don't line up with it.
function buildGableWall(palette, span = WALL_SPAN) {
  const plankMat = mat(palette, "plank");
  const shape = new THREE.Shape();
  shape.moveTo(-span / 2, 0);
  shape.lineTo(span / 2, 0);
  shape.lineTo(0, ROOF_RISE);
  shape.closePath();
  const geo = new THREE.ExtrudeGeometry(shape, { depth: 0.1, bevelEnabled: false });
  geo.translate(0, 0, -0.05);
  return new THREE.Mesh(geo, plankMat);
}

const DOOR_LEAF_WIDTH = WALL_SPAN - 0.16; // narrower than the opening so it clears the frame posts when it swings
const DOOR_HEIGHT = 1.0; // matches wallWood's height

// A door: a static frame (two posts + a lintel) around an opening the
// same size as a wall segment, plus a swinging leaf hinged at the left
// edge. The leaf lives in its own group (userData.leaf) so buildMode can
// rotate just that part open/closed without touching the frame.
function buildDoor(palette) {
  const group = new THREE.Group();
  const frameMat = mat(palette, "trunk");
  const leafMat = mat(palette, "plank");

  const postGeo = new THREE.BoxGeometry(0.08, DOOR_HEIGHT, 0.14);
  [-WALL_SPAN / 2 + 0.04, WALL_SPAN / 2 - 0.04].forEach((x) => {
    const post = new THREE.Mesh(postGeo, frameMat);
    post.position.set(x, DOOR_HEIGHT / 2, 0);
    group.add(post);
  });
  const lintel = new THREE.Mesh(new THREE.BoxGeometry(WALL_SPAN, 0.1, 0.16), frameMat);
  lintel.position.set(0, DOOR_HEIGHT - 0.05, 0);
  group.add(lintel);

  const leaf = new THREE.Group();
  leaf.position.set(-WALL_SPAN / 2 + 0.06, 0, 0); // hinge point, at the left post
  const panel = new THREE.Mesh(new THREE.BoxGeometry(DOOR_LEAF_WIDTH, DOOR_HEIGHT - 0.12, 0.06), leafMat);
  panel.position.set(DOOR_LEAF_WIDTH / 2 + 0.02, DOOR_HEIGHT / 2, 0);
  leaf.add(panel);
  group.add(leaf);

  group.userData.leaf = leaf;
  return group;
}

const DOOR_STONE_HEIGHT = 0.78; // matches wallStone's own height, so it sits flush in a stone wall run

// A door built to sit in a stone wall run instead of a wood one: squat
// rough-cut stone jambs/lintel (thicker than the wood door's slender
// frame, to read as stone rather than timber) at wallStone's own height,
// with the same swinging plank leaf as buildDoor.
function buildDoorStone(palette) {
  const group = new THREE.Group();
  const jambMat = mat(palette, "stoneBuilt");
  const leafMat = mat(palette, "plank");

  const jambGeo = new THREE.BoxGeometry(0.16, DOOR_STONE_HEIGHT, 0.26);
  [-WALL_SPAN / 2 + 0.08, WALL_SPAN / 2 - 0.08].forEach((x) => {
    const jamb = new THREE.Mesh(jambGeo, jambMat);
    jamb.position.set(x, DOOR_STONE_HEIGHT / 2, 0);
    group.add(jamb);
  });
  const lintel = new THREE.Mesh(new THREE.BoxGeometry(WALL_SPAN, 0.16, 0.28), jambMat);
  lintel.position.set(0, DOOR_STONE_HEIGHT - 0.08, 0);
  group.add(lintel);

  const leafHeight = DOOR_STONE_HEIGHT - 0.16;
  const leafWidth = WALL_SPAN - 0.24;
  const leaf = new THREE.Group();
  leaf.position.set(-WALL_SPAN / 2 + 0.1, 0, 0); // hinge point, at the left jamb
  const panel = new THREE.Mesh(new THREE.BoxGeometry(leafWidth, leafHeight, 0.06), leafMat);
  panel.position.set(leafWidth / 2 + 0.02, leafHeight / 2, 0);
  leaf.add(panel);
  group.add(leaf);

  group.userData.leaf = leaf;
  return group;
}

// A flat plank platform (its local origin is its underside, so it snaps
// flush onto whatever it's resting on) with two support beams showing
// underneath.
function buildPlatform(palette) {
  const group = new THREE.Group();
  const S = 1.3, T = 0.1;
  const plankMat = mat(palette, "plank");
  const beamMat = mat(palette, "trunk");

  const floor = new THREE.Mesh(new THREE.BoxGeometry(S, T, S), plankMat);
  floor.position.y = T / 2;
  group.add(floor);

  const beamGeo = new THREE.BoxGeometry(S - 0.1, 0.08, 0.1);
  [-0.45, 0.45].forEach((z) => {
    const beam = new THREE.Mesh(beamGeo, beamMat);
    beam.position.set(0, -0.02, z);
    group.add(beam);
  });

  return group;
}

// A fixed-height ladder (roughly a post's height, since that's the usual
// platform clearance) leaning against a platform's edge.
function buildLadder(palette) {
  const group = new THREE.Group();
  const woodMat = mat(palette, "trunk");
  const H = 1.35, W = 0.46;

  const railGeo = new THREE.CylinderGeometry(0.035, 0.035, H, 5);
  [-W / 2, W / 2].forEach((x) => {
    const rail = new THREE.Mesh(railGeo, woodMat);
    rail.position.set(x, H / 2, 0);
    group.add(rail);
  });

  const rungGeo = new THREE.CylinderGeometry(0.03, 0.03, W, 5);
  for (let i = 0; i < 5; i++) {
    const rung = new THREE.Mesh(rungGeo, woodMat);
    rung.rotation.z = Math.PI / 2;
    rung.position.set(0, 0.15 + i * ((H - 0.3) / 4), 0);
    group.add(rung);
  }
  return group;
}

export const STRUCTURES = {
  wallWood: {
    id: "wallWood",
    label: "Trävägg",
    icon: "🪵",
    cost: { wood: 3, stone: 0 },
    shadowRadius: 0.85,
    width: WALL_SPAN, // used to snap flush edge-to-edge against a neighboring structure
    height: 1.0, // where its top sits, for roofs/platforms snapping onto it
    snapMode: "edge",
    build(palette) {
      const group = new THREE.Group();
      const plankMat = mat(palette, "plank");
      const braceMat = mat(palette, "trunk");

      const panel = new THREE.Mesh(new THREE.BoxGeometry(WALL_SPAN, 1.0, 0.12), plankMat);
      panel.position.y = 0.5;
      group.add(panel);

      [0.28, 0.72].forEach((h) => {
        const brace = new THREE.Mesh(new THREE.BoxGeometry(WALL_SPAN + 0.05, 0.08, 0.15), braceMat);
        brace.position.y = h;
        group.add(brace);
      });
      return group;
    },
  },

  wallStone: {
    id: "wallStone",
    label: "Stenmur",
    icon: "🪨",
    cost: { wood: 0, stone: 3 },
    shadowRadius: 0.9,
    width: WALL_SPAN,
    height: 0.78,
    snapMode: "edge",
    build(palette) {
      return buildStoneWall(palette);
    },
  },

  post: {
    id: "post",
    label: "Stolpe",
    icon: "🪵",
    cost: { wood: 1, stone: 0 },
    shadowRadius: 0.35,
    width: 0.2,
    height: 1.3,
    snapMode: "free", // plain grid placement — posts don't chain end-to-end like walls
    build(palette) {
      // wrapped in a group (like every other structure) so confirm()'s
      // group.position.set(...) positions the *base*, not the geometry's
      // own centered origin — a bare mesh here previously got its internal
      // position.y=0.65 clobbered, burying the post half underground and
      // throwing off anything snapping onto its "top".
      const group = new THREE.Group();
      const postMat = mat(palette, "fence");
      const mesh = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.1, 1.3, 6), postMat);
      mesh.position.y = 0.65;
      group.add(mesh);
      return group;
    },
  },

  roof: {
    id: "roof",
    label: "Tak",
    icon: "🌾",
    cost: { wood: 2, stone: 0, grass: 3 },
    shadowRadius: 0.9,
    width: WALL_SPAN,
    snapMode: "top", // snaps onto the top of a nearby wall/post — never floats
    spansToOpposite: true, // buildMode sizes it to reach a wall found across the room, if any
    build(palette, opts) {
      const { span, drop } = opts || {};
      return buildRoof(palette, span, drop);
    },
  },

  ridgeRoof: {
    id: "ridgeRoof",
    label: "Ryggåstak",
    icon: "⛺",
    cost: { wood: 3, stone: 0, grass: 5 },
    shadowRadius: 0.95,
    width: WALL_SPAN,
    snapMode: "top", // snaps onto the top of a nearby wall — never floats
    spansToOpposite: true, // sized to the exact gap to the wall it finds across the room
    requiresSpan: true, // a peaked roof needs a wall on both sides — refuse rather than build half a peak
    build(palette, opts) {
      const { span, drop } = opts || {};
      return buildRidgeRoof(palette, span, drop);
    },
  },

  gableWall: {
    id: "gableWall",
    label: "Gavelvägg",
    icon: "🔺",
    cost: { wood: 2, stone: 0 },
    shadowRadius: 0.6,
    width: WALL_SPAN,
    snapMode: "top", // sits on top of a wall segment
    topFilter: "wall", // never rests on a post/platform — only a wall's top makes sense here
    spansOwnRun: true, // sized to the whole connected wall run, not just the tapped segment
    build(palette, opts) {
      const { span } = opts || {};
      return buildGableWall(palette, span);
    },
  },

  door: {
    id: "door",
    label: "Dörr",
    icon: "🚪",
    cost: { wood: 3, stone: 0 },
    shadowRadius: 0.85,
    width: WALL_SPAN, // chains into a wall run exactly like a wallWood segment
    height: 1.0,
    snapMode: "edge",
    isDoor: true, // openable — see tryToggleDoor/collision, which key off this rather than a hardcoded id
    build(palette) {
      return buildDoor(palette);
    },
  },

  doorStone: {
    id: "doorStone",
    label: "Stendörr",
    icon: "🚪",
    cost: { wood: 1, stone: 3 },
    shadowRadius: 0.85,
    width: WALL_SPAN, // chains into a wall run exactly like a wallStone segment
    height: DOOR_STONE_HEIGHT,
    snapMode: "edge",
    isDoor: true,
    build(palette) {
      return buildDoorStone(palette);
    },
  },

  platform: {
    id: "platform",
    label: "Plattform",
    icon: "🪵",
    cost: { wood: 4, stone: 0, grass: 0 },
    shadowRadius: 1.0,
    width: 1.3,
    height: 0.1, // its walkable surface, for a wall/roof/ladder resting on it
    snapMode: "topPost", // snaps onto the top of a post — never floats unsupported
    build(palette) {
      return buildPlatform(palette);
    },
  },

  ladder: {
    id: "ladder",
    label: "Stege",
    icon: "🪜",
    cost: { wood: 2, stone: 0 },
    shadowRadius: 0.4,
    width: 0.46,
    snapMode: "ladder", // snaps to the ground at the edge of a nearby platform
    build(palette) {
      return buildLadder(palette);
    },
  },
};
