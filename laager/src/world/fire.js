import * as THREE from "three";
import { addShadowBlob } from "../core/shadowDecals.js";

export function buildFire(scene, palette, shadowMat) {
  const logGeo = new THREE.CylinderGeometry(0.09, 0.11, 1.5, 5);
  const logMat = new THREE.MeshStandardMaterial({ color: palette.logs, flatShading: true, roughness: 1 });
  const n = 5;
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2;
    const log = new THREE.Mesh(logGeo, logMat);
    log.position.set(Math.cos(a) * 0.12, 0.35, Math.sin(a) * 0.12);
    log.rotation.z = Math.PI / 2.35;
    log.rotation.y = a;
    scene.add(log);
  }
  const ring = new THREE.Mesh(
    new THREE.TorusGeometry(0.55, 0.08, 5, 10),
    new THREE.MeshStandardMaterial({ color: palette.rock, flatShading: true, roughness: 1 })
  );
  ring.rotation.x = Math.PI / 2;
  ring.position.y = 0.05;
  scene.add(ring);
  addShadowBlob(scene, shadowMat, 0, 0, 1.6);
}

// custom-shader particles (additive, cheap): a handful of glowing embers
export function buildEmbers(scene) {
  const count = 70;
  const positions = new Float32Array(count * 3);
  const sizes = new Float32Array(count);
  const alphas = new Float32Array(count);
  const state = [];
  for (let i = 0; i < count; i++) {
    state.push({
      life: Math.random(), maxLife: 0.9 + Math.random() * 1.1,
      speed: 0.7 + Math.random() * 0.9,
      x0: (Math.random() - 0.5) * 0.5, z0: (Math.random() - 0.5) * 0.5,
      drift: (Math.random() - 0.5) * 0.4,
    });
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.BufferAttribute(positions, 3));
  geo.setAttribute("aSize", new THREE.BufferAttribute(sizes, 1));
  geo.setAttribute("aAlpha", new THREE.BufferAttribute(alphas, 1));

  const dotTex = (() => {
    const c = document.createElement("canvas");
    c.width = c.height = 32;
    const ctx = c.getContext("2d");
    const g = ctx.createRadialGradient(16, 16, 0, 16, 16, 16);
    g.addColorStop(0, "rgba(255,255,255,1)");
    g.addColorStop(1, "rgba(255,255,255,0)");
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, 32, 32);
    return new THREE.CanvasTexture(c);
  })();

  const mat = new THREE.ShaderMaterial({
    uniforms: { uMap: { value: dotTex }, uColor: { value: new THREE.Color(0xff9a3c) } },
    vertexShader: `
      attribute float aSize;
      attribute float aAlpha;
      varying float vAlpha;
      void main() {
        vAlpha = aAlpha;
        vec4 mv = modelViewMatrix * vec4(position, 1.0);
        gl_PointSize = aSize * (150.0 / -mv.z);
        gl_Position = projectionMatrix * mv;
      }
    `,
    fragmentShader: `
      uniform sampler2D uMap;
      uniform vec3 uColor;
      varying float vAlpha;
      void main() {
        vec4 tex = texture2D(uMap, gl_PointCoord);
        gl_FragColor = vec4(uColor, tex.a * vAlpha);
      }
    `,
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, fog: false,
  });

  const points = new THREE.Points(geo, mat);
  scene.add(points);

  return {
    update(dt) {
      const posAttr = geo.attributes.position, sizeAttr = geo.attributes.aSize, alphaAttr = geo.attributes.aAlpha;
      for (let i = 0; i < count; i++) {
        const s = state[i];
        s.life += dt;
        const t = s.life / s.maxLife;
        if (t >= 1) {
          s.life = 0; s.x0 = (Math.random() - 0.5) * 0.5; s.z0 = (Math.random() - 0.5) * 0.5;
          s.speed = 0.7 + Math.random() * 0.9; s.maxLife = 0.9 + Math.random() * 1.1;
          s.drift = (Math.random() - 0.5) * 0.4;
        }
        const tt = s.life / s.maxLife;
        posAttr.setXYZ(i, s.x0 + Math.sin(tt * 6 + i) * 0.12 + s.drift * tt, 0.5 + tt * s.speed * 1.6, s.z0 + Math.cos(tt * 6 + i) * 0.12);
        sizeAttr.setX(i, THREE.MathUtils.lerp(5.5, 1, tt));
        alphaAttr.setX(i, Math.sin(tt * Math.PI) * 0.75);
      }
      posAttr.needsUpdate = true; sizeAttr.needsUpdate = true; alphaAttr.needsUpdate = true;
    },
  };
}
