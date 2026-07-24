import * as THREE from "three";

export const SNAP_SIZE = 1.2; // grid cell size, matches the wall segment width
export const DEFAULT_PLATFORM_HEIGHT = 1.3; // used when a platform isn't snapped onto a post

function mat(palette, key, extra = {}) {
  return new THREE.MeshStandardMaterial({ color: palette[key], flatShading: true, roughness: 0.9, ...extra });
}

// A dry-stone wall built from staggered courses of irregular blocks
// (instanced, so it's still ~1 draw call) instead of one smooth slab —
// varied block size/depth/rotation and a jagged top course read as
// hand-stacked stone rather than poured concrete.
function buildStoneWall(palette) {
  const W = 1.15, D = 0.26;
  const rows = [
    { y0: 0, h: 0.24, count: 3 },
    { y0: 0.24, h: 0.24, count: 4 },
    { y0: 0.48, h: 0.3, count: 3 },
  ];
  const stoneMat = mat(palette, "stoneBuilt");
  const total = rows.reduce((s, r) => s + r.count, 0);
  const mesh = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1), stoneMat, total);

  const m = new THREE.Matrix4(), q = new THREE.Quaternion(), color = new THREE.Color();
  let i = 0;
  rows.forEach((row, rowIndex) => {
    const cellW = W / row.count;
    const stagger = rowIndex % 2 === 1 ? cellW * 0.4 : 0;
    for (let c = 0; c < row.count; c++) {
      const cx = -W / 2 + cellW * (c + 0.5) + stagger + (Math.random() - 0.5) * cellW * 0.15;
      const stoneW = cellW * (1.05 + Math.random() * 0.15); // slight overlap: no see-through mortar gaps
      const stoneH = row.h * (0.8 + Math.random() * 0.35);
      const stoneD = D * (0.7 + Math.random() * 0.55);
      const cy = row.y0 + stoneH / 2 + (Math.random() - 0.5) * 0.02;
      const cz = (Math.random() - 0.5) * 0.03;
      q.setFromEuler(new THREE.Euler((Math.random() - 0.5) * 0.1, (Math.random() - 0.5) * 0.14, (Math.random() - 0.5) * 0.08));
      m.compose(new THREE.Vector3(cx, cy, cz), q, new THREE.Vector3(stoneW, stoneH, stoneD));
      mesh.setMatrixAt(i, m);
      color.set(palette.stoneBuilt).multiplyScalar(0.8 + Math.random() * 0.35);
      mesh.setColorAt(i, color);
      i++;
    }
  });
  return mesh;
}

// A sloped lean-to roof panel: wood rafters + ridge beam under a grass
// thatch layer. Its local origin is the ridge (the edge that sits on a
// wall's/post's top), sloping outward and down toward the eave.
function buildRoof(palette) {
  const group = new THREE.Group();
  const W = 1.15, RIDGE_Y = 1.0, EAVE_DROP = 0.35, DEPTH = 0.95;
  const woodMat = mat(palette, "trunk");
  const grassMat = mat(palette, "grass");

  const slopeVec = new THREE.Vector3(0, -EAVE_DROP, DEPTH);
  const slopeLen = slopeVec.length();
  const slopeDir = slopeVec.clone().normalize();
  const mid = slopeVec.clone().multiplyScalar(0.5).add(new THREE.Vector3(0, RIDGE_Y, 0));

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
  ridge.position.set(0, RIDGE_Y, 0);
  group.add(ridge);

  const thatchQuat = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 0, 1), slopeDir);
  const thatch = new THREE.Mesh(new THREE.BoxGeometry(W, 0.06, slopeLen), grassMat);
  thatch.position.set(0, mid.y + 0.05, mid.z);
  thatch.quaternion.copy(thatchQuat);
  group.add(thatch);

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

export const STRUCTURES = {
  wallWood: {
    id: "wallWood",
    label: "Trävägg",
    icon: "🪵",
    cost: { wood: 3, stone: 0 },
    shadowRadius: 0.85,
    width: 1.15, // used to snap flush edge-to-edge against a neighboring structure
    height: 1.0, // where its top sits, for roofs/platforms snapping onto it
    snapMode: "edge",
    build(palette) {
      const group = new THREE.Group();
      const plankMat = mat(palette, "plank");
      const braceMat = mat(palette, "trunk");

      const panel = new THREE.Mesh(new THREE.BoxGeometry(1.15, 1.0, 0.12), plankMat);
      panel.position.y = 0.5;
      group.add(panel);

      [0.28, 0.72].forEach((h) => {
        const brace = new THREE.Mesh(new THREE.BoxGeometry(1.2, 0.08, 0.15), braceMat);
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
    width: 1.15,
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
    snapMode: "edge",
    build(palette) {
      const postMat = mat(palette, "fence");
      const mesh = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.1, 1.3, 6), postMat);
      mesh.position.y = 0.65;
      return mesh;
    },
  },

  roof: {
    id: "roof",
    label: "Tak",
    icon: "🌾",
    cost: { wood: 2, stone: 0, grass: 3 },
    shadowRadius: 0.9,
    width: 1.15,
    snapMode: "top", // snaps onto the top of any nearby wall/post
    build(palette) {
      return buildRoof(palette);
    },
  },

  platform: {
    id: "platform",
    label: "Plattform",
    icon: "🪜",
    cost: { wood: 4, stone: 0, grass: 0 },
    shadowRadius: 1.0,
    width: 1.3,
    snapMode: "topPost", // snaps onto the top of a post specifically
    build(palette) {
      return buildPlatform(palette);
    },
  },
};
