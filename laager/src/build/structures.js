import * as THREE from "three";

export const SNAP_SIZE = 1.2; // grid cell size, matches the wall segment width

function mat(palette, key, extra = {}) {
  return new THREE.MeshStandardMaterial({ color: palette[key], flatShading: true, roughness: 0.9, ...extra });
}

export const STRUCTURES = {
  wallWood: {
    id: "wallWood",
    label: "Trävägg",
    icon: "🪵",
    cost: { wood: 3, stone: 0 },
    shadowRadius: 0.85,
    width: 1.15, // used to snap flush edge-to-edge against a neighboring structure
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
    build(palette) {
      const group = new THREE.Group();
      const stoneMat = mat(palette, "stoneBuilt");

      const panel = new THREE.Mesh(new THREE.BoxGeometry(1.15, 0.75, 0.26), stoneMat);
      panel.position.y = 0.375;
      group.add(panel);

      const bumpGeo = new THREE.IcosahedronGeometry(0.14, 0);
      [-0.35, 0.1, 0.4].forEach((x, i) => {
        const bump = new THREE.Mesh(bumpGeo, stoneMat);
        bump.position.set(x, 0.75 + (i % 2) * 0.05, (Math.random() - 0.5) * 0.08);
        bump.rotation.set(Math.random(), Math.random(), Math.random());
        group.add(bump);
      });
      return group;
    },
  },

  post: {
    id: "post",
    label: "Stolpe",
    icon: "🪵",
    cost: { wood: 1, stone: 0 },
    shadowRadius: 0.35,
    width: 0.2,
    build(palette) {
      const postMat = mat(palette, "fence");
      const mesh = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.1, 1.3, 6), postMat);
      mesh.position.y = 0.65;
      return mesh;
    },
  },
};
