import * as THREE from 'three';

const MIN_H = -7;
const SCORCH = new THREE.Color('#4a2f1c');
const WHITE = new THREE.Color('#ffffff');

/**
 * Deformable heightfield. Craters are carved with a sphere and only ever
 * lower the ground (h = min(h, sphereBottom)), so applying the same set of
 * craters in any order gives an identical result on every client.
 */
export class Terrain {
  constructor(scene, size, seg, heightFn, material) {
    this.size = size;
    this.seg = seg;
    this.n = seg + 1;
    this.step = size / seg;
    this.half = size / 2;
    const n = this.n;
    this.h = new Float32Array(n * n);
    for (let i = 0; i < n; i++) {
      for (let j = 0; j < n; j++) this.h[i * n + j] = heightFn(-this.half + j * this.step, -this.half + i * this.step);
    }
    this.h0 = this.h.slice();

    const geo = new THREE.PlaneGeometry(size, size, seg, seg);
    geo.rotateX(-Math.PI / 2);
    const pos = geo.attributes.position;
    const colors = new Float32Array(n * n * 3).fill(1);
    geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    for (let k = 0; k < n * n; k++) pos.setY(k, this.h[k]);
    geo.computeVertexNormals();
    material.vertexColors = true;
    this.mesh = new THREE.Mesh(geo, material);
    this.mesh.receiveShadow = true;
    scene.add(this.mesh);
    this.geo = geo;
  }

  heightAt(x, z) {
    const fx = (x + this.half) / this.step, fz = (z + this.half) / this.step;
    const j = Math.max(0, Math.min(this.seg - 1, Math.floor(fx)));
    const i = Math.max(0, Math.min(this.seg - 1, Math.floor(fz)));
    const tx = Math.max(0, Math.min(1, fx - j)), tz = Math.max(0, Math.min(1, fz - i));
    const n = this.n, h = this.h;
    const a = h[i * n + j], b = h[i * n + j + 1], c = h[(i + 1) * n + j], d = h[(i + 1) * n + j + 1];
    return (a * (1 - tx) + b * tx) * (1 - tz) + (c * (1 - tx) + d * tx) * tz;
  }

  /** Blast a spherical crater. Returns true if the ground changed. */
  carve(cx, cy, cz, r) {
    const n = this.n;
    const j0 = Math.max(0, Math.floor((cx - r + this.half) / this.step));
    const j1 = Math.min(this.seg, Math.ceil((cx + r + this.half) / this.step));
    const i0 = Math.max(0, Math.floor((cz - r + this.half) / this.step));
    const i1 = Math.min(this.seg, Math.ceil((cz + r + this.half) / this.step));
    const pos = this.geo.attributes.position;
    const col = this.geo.attributes.color;
    const c = new THREE.Color();
    let changed = false;
    for (let i = i0; i <= i1; i++) {
      for (let j = j0; j <= j1; j++) {
        const x = -this.half + j * this.step, z = -this.half + i * this.step;
        const d2 = (x - cx) ** 2 + (z - cz) ** 2;
        if (d2 >= r * r) continue;
        const k = i * n + j;
        const bottom = Math.max(MIN_H, cy - Math.sqrt(r * r - d2));
        if (this.h[k] > bottom) {
          this.h[k] = bottom;
          pos.setY(k, bottom);
          changed = true;
        }
        // Scorch marks fade out from the blast center
        const burn = Math.max(Math.min(1, (this.h0[k] - this.h[k]) / 2.5), 0.6 * (1 - Math.sqrt(d2) / r));
        c.copy(WHITE).lerp(SCORCH, burn);
        if (c.r < col.getX(k)) col.setXYZ(k, c.r, c.g, c.b);
      }
    }
    col.needsUpdate = true;
    if (changed) {
      pos.needsUpdate = true;
      this.geo.computeVertexNormals();
    }
    return changed;
  }
}

/** Small deterministic PRNG so every client generates the same map. */
export function seeded(seed) {
  return () => {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
