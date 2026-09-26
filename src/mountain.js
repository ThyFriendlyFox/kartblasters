import * as THREE from 'three';

/**
 * A mountain grown from the road that climbs it: every road sample in the
 * mountain stretch raises the ground to just under itself, falling away at
 * `slope` (rise per unit) beyond the road's edge. Where any road passes, the
 * ground is cut back below it, so no road is ever buried. Returns a height
 * lookup the physics uses for crashes, and adds the mesh (grass, rock, snow)
 * plus pines to the scene.
 */
export function buildMountain(scene, track, { s0, s1, slope = 1, cell = 4, shoulder = 0, palette = 'alpine' }) {
  const hw = track.hw;
  const src = [];
  const v = new THREE.Vector3();
  const span = ((s1 - s0) % track.L + track.L) % track.L;
  for (let d = 0; d <= span; d += 3) {
    const i = track.idx(s0 + d);
    if (track.gap[i]) continue;
    v.fromArray(track.P, i * 3);
    if (v.y > 2) src.push([v.x, v.y, v.z]);
  }
  let maxY = 0, x0 = Infinity, x1 = -Infinity, z0 = Infinity, z1 = -Infinity;
  for (const [x, y, z] of src) {
    const r = hw + 2 + shoulder + y / slope;
    x0 = Math.min(x0, x - r);
    x1 = Math.max(x1, x + r);
    z0 = Math.min(z0, z - r);
    z1 = Math.max(z1, z + r);
    maxY = Math.max(maxY, y);
  }
  const nx = Math.ceil((x1 - x0) / cell) + 1, nz = Math.ceil((z1 - z0) / cell) + 1;
  const H = new Float32Array(nx * nz).fill(-2);
  const near = new Float32Array(nx * nz).fill(1e9); // distance to the nearest mountain road
  const splat = (x, z, r, fn) => {
    const i0 = Math.max(0, Math.floor((x - r - x0) / cell)), i1 = Math.min(nx - 1, Math.ceil((x + r - x0) / cell));
    const k0 = Math.max(0, Math.floor((z - r - z0) / cell)), k1 = Math.min(nz - 1, Math.ceil((z + r - z0) / cell));
    for (let k = k0; k <= k1; k++) {
      const gz = z0 + k * cell;
      for (let i = i0; i <= i1; i++) {
        const gx = x0 + i * cell, d = Math.hypot(gx - x, gz - z);
        if (d <= r) fn(k * nx + i, d);
      }
    }
  };
  for (const [x, y, z] of src) {
    const top = y - 0.5;
    splat(x, z, hw + 2 + shoulder + top / slope, (j, d) => {
      const h = top - slope * Math.max(0, d - hw - 1.5 - shoulder);
      if (h > H[j]) H[j] = h;
      if (d < near[j]) near[j] = d;
    });
  }
  // Rocky bumps away from the road
  for (let j = 0; j < H.length; j++) {
    if (H[j] <= 0) continue;
    const gx = x0 + (j % nx) * cell, gz = z0 + Math.floor(j / nx) * cell;
    const away = THREE.MathUtils.clamp((near[j] - hw - 6) / 25, 0, 1);
    H[j] += away * (Math.sin(gx * 0.07) * Math.cos(gz * 0.06) * 3 + Math.sin(gx * 0.19 + gz * 0.13) * 1.5);
  }
  // Never bury a road: cut the ground back under every road on the track
  for (const p of [track, ...track.branches.map((b) => b.path)]) {
    for (let i = 0; i < p.n; i += 2) {
      v.fromArray(p.P, i * 3);
      if (v.x < x0 - 20 || v.x > x1 + 20 || v.z < z0 - 20 || v.z > z1 + 20) continue;
      splat(v.x, v.z, hw + 2.5, (j, d) => {
        const cap = v.y - 0.8 - Math.max(0, d - hw - 1) * 0.6;
        if (H[j] > cap) H[j] = cap;
      });
    }
  }

  // Mesh with height/slope colouring
  const pos = new Float32Array(nx * nz * 3), col = new Float32Array(nx * nz * 3), idx = [];
  const desert = palette === 'desert';
  const grass = new THREE.Color(desert ? '#d9a066' : '#5f9e4a'), rock = new THREE.Color(desert ? '#b5653a' : '#7d7f86'), snow = new THREE.Color('#f4f7fb'), c = new THREE.Color();
  const bands = [new THREE.Color('#c2623a'), new THREE.Color('#d98a54'), new THREE.Color('#a94f2e'), new THREE.Color('#e0a370')];
  for (let k = 0; k < nz; k++) {
    for (let i = 0; i < nx; i++) {
      const j = k * nx + i;
      pos.set([x0 + i * cell, H[j], z0 + k * cell], j * 3);
    }
  }
  for (let k = 0; k < nz; k++) {
    for (let i = 0; i < nx; i++) {
      const j = k * nx + i, h = H[j];
      const dx = H[k * nx + Math.min(nx - 1, i + 1)] - H[k * nx + Math.max(0, i - 1)];
      const dz = H[Math.min(nz - 1, k + 1) * nx + i] - H[Math.max(0, k - 1) * nx + i];
      const steep = THREE.MathUtils.clamp(Math.hypot(dx, dz) / (4 * cell), 0, 1);
      const snowLine = maxY * 0.62 + Math.sin(i * 0.3) * Math.cos(k * 0.27) * 6;
      if (desert) {
        // Layered sandstone on the cliffs, sand on the flats
        c.copy(bands[Math.floor(Math.max(0, h) / 7) % bands.length]).lerp(grass, 1 - THREE.MathUtils.smoothstep(steep, 0.2, 0.5));
      } else {
        c.copy(grass).lerp(rock, THREE.MathUtils.smoothstep(steep, 0.25, 0.6));
        if (h > snowLine) c.lerp(snow, THREE.MathUtils.clamp((h - snowLine) / 12, 0, 1) * (1 - steep * 0.6));
      }
      col.set([c.r, c.g, c.b], j * 3);
      if (i < nx - 1 && k < nz - 1) {
        // Skip cells entirely below the ground plane
        if (Math.max(h, H[j + 1], H[j + nx], H[j + nx + 1]) > -0.5) idx.push(j, j + nx, j + 1, j + 1, j + nx, j + nx + 1);
      }
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setAttribute('color', new THREE.BufferAttribute(col, 3));
  g.setIndex(idx);
  g.computeVertexNormals();
  const mesh = new THREE.Mesh(g, new THREE.MeshLambertMaterial({ vertexColors: true }));
  mesh.receiveShadow = true;
  mesh.castShadow = true;
  scene.add(mesh);

  const groundY = (x, z) => {
    const fx = (x - x0) / cell, fz = (z - z0) / cell;
    if (fx < 0 || fz < 0 || fx >= nx - 1 || fz >= nz - 1) return 0;
    const i = Math.floor(fx), k = Math.floor(fz), tx = fx - i, tz = fz - k, j = k * nx + i;
    const h = (H[j] * (1 - tx) + H[j + 1] * tx) * (1 - tz) + (H[j + nx] * (1 - tx) + H[j + nx + 1] * tx) * tz;
    return Math.max(0, h);
  };

  // Pines on the lower slopes, away from the road (instanced: two draw calls)
  const spots = [];
  for (let tries = 0; tries < 4000 && spots.length < (desert ? 0 : 140); tries++) {
    const j = Math.floor(Math.random() * H.length), h = H[j];
    if (h < 3 || h > maxY * 0.55 || near[j] < hw + 9) continue;
    const x = x0 + (j % nx) * cell + (Math.random() - 0.5) * cell, z = z0 + Math.floor(j / nx) * cell + (Math.random() - 0.5) * cell;
    spots.push([x, groundY(x, z), z, 3 + Math.random() * 3]);
  }
  if (spots.length) {
    const leaves = new THREE.InstancedMesh(new THREE.ConeGeometry(1, 3, 7), new THREE.MeshLambertMaterial({ color: '#2b6b3a' }), spots.length);
    const trunks = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.5, 0.7, 2.5), new THREE.MeshLambertMaterial({ color: '#5b3e26' }), spots.length);
    const m = new THREE.Matrix4(), q = new THREE.Quaternion(), sc = new THREE.Vector3(), p = new THREE.Vector3();
    spots.forEach(([x, y, z, s], i) => {
      leaves.setMatrixAt(i, m.compose(p.set(x, y + 1.5 * s + 1.5, z), q, sc.set(s, s, s)));
      trunks.setMatrixAt(i, m.compose(p.set(x, y + 1.2, z), q, sc.set(1, 1, 1)));
    });
    leaves.castShadow = true;
    scene.add(leaves, trunks);
  }
  return { groundY, bounds: [x0, z0, x1, z1], maxY };
}
