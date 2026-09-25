import * as THREE from 'three';

export const HALF = 90; // arena half-size (inner edge of perimeter walls)

function canvasTex(size, draw, repeat = 1) {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  draw(c.getContext('2d'), size);
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(repeat, repeat);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 8;
  return t;
}

function asphaltTexture() {
  return canvasTex(512, (g, s) => {
    g.fillStyle = '#3b3f46';
    g.fillRect(0, 0, s, s);
    for (let i = 0; i < 9000; i++) {
      const v = 45 + Math.random() * 40;
      g.fillStyle = `rgba(${v},${v + 3},${v + 8},0.5)`;
      g.fillRect(Math.random() * s, Math.random() * s, 2, 2);
    }
    g.strokeStyle = 'rgba(255,255,255,0.08)';
    g.lineWidth = 3;
    g.strokeRect(0, 0, s, s);
  }, 18);
}

function stripeTexture(a, b) {
  return canvasTex(128, (g, s) => {
    for (let i = 0; i < 4; i++) {
      g.fillStyle = i % 2 ? a : b;
      g.fillRect((i * s) / 4, 0, s / 4, s);
    }
  });
}

function crateTexture() {
  return canvasTex(128, (g, s) => {
    g.fillStyle = '#b07a3c';
    g.fillRect(0, 0, s, s);
    g.strokeStyle = '#6b4520';
    g.lineWidth = 10;
    g.strokeRect(5, 5, s - 10, s - 10);
    g.beginPath();
    g.moveTo(5, 5); g.lineTo(s - 5, s - 5);
    g.moveTo(s - 5, 5); g.lineTo(5, s - 5);
    g.stroke();
  });
}

/**
 * Builds the arena meshes and returns collision data shared by physics, bots and projectiles.
 * All boxes are axis-aligned so collision stays cheap.
 */
export function buildArena(scene) {
  const world = { half: HALF, boxes: [], cyls: [], pads: [], spawns: [], items: [] };

  scene.background = new THREE.Color('#8fc7ff');
  scene.fog = new THREE.Fog('#8fc7ff', 140, 320);

  const hemi = new THREE.HemisphereLight('#dff1ff', '#4a6b3a', 1.4);
  scene.add(hemi);
  const sun = new THREE.DirectionalLight('#fff4e0', 2.2);
  sun.position.set(60, 110, 40);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  const sc = sun.shadow.camera;
  sc.left = sc.bottom = -110;
  sc.right = sc.top = 110;
  sc.near = 10;
  sc.far = 300;
  sun.shadow.bias = -0.0005;
  scene.add(sun);

  // Grass beyond the arena
  const grass = new THREE.Mesh(
    new THREE.PlaneGeometry(800, 800),
    new THREE.MeshLambertMaterial({ color: '#5d9a45' }),
  );
  grass.rotation.x = -Math.PI / 2;
  grass.position.y = -0.05;
  grass.receiveShadow = true;
  scene.add(grass);

  // Asphalt floor
  const floor = new THREE.Mesh(
    new THREE.PlaneGeometry(HALF * 2, HALF * 2),
    new THREE.MeshLambertMaterial({ map: asphaltTexture() }),
  );
  floor.rotation.x = -Math.PI / 2;
  floor.receiveShadow = true;
  scene.add(floor);

  // Painted rings / lines on the floor
  const paint = new THREE.MeshBasicMaterial({ color: '#f2f2f2', transparent: true, opacity: 0.55 });
  for (const r of [14, 30]) {
    const ring = new THREE.Mesh(new THREE.RingGeometry(r - 0.4, r, 96), paint);
    ring.rotation.x = -Math.PI / 2;
    ring.position.y = 0.02;
    scene.add(ring);
  }
  const yellow = new THREE.MeshBasicMaterial({ color: '#ffd23f', transparent: true, opacity: 0.7 });
  for (const [w, d] of [[HALF * 2 - 8, 0.6], [0.6, HALF * 2 - 8]]) {
    const line = new THREE.Mesh(new THREE.PlaneGeometry(w, d), yellow);
    line.rotation.x = -Math.PI / 2;
    line.position.y = 0.015;
    scene.add(line);
  }

  const wallTex = stripeTexture('#e63946', '#f1f1f1');
  const crateMat = new THREE.MeshLambertMaterial({ map: crateTexture() });
  const concreteMat = new THREE.MeshLambertMaterial({ color: '#9aa3ad' });

  function addBox(cx, cz, w, d, h, mat) {
    const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
    m.position.set(cx, h / 2, cz);
    m.castShadow = m.receiveShadow = true;
    scene.add(m);
    world.boxes.push({ minX: cx - w / 2, maxX: cx + w / 2, minZ: cz - d / 2, maxZ: cz + d / 2, h });
  }

  function addCyl(x, z, r, h, mat) {
    const m = new THREE.Mesh(new THREE.CylinderGeometry(r, r, h, 24), mat);
    m.position.set(x, h / 2, z);
    m.castShadow = m.receiveShadow = true;
    scene.add(m);
    world.cyls.push({ x, z, r, h });
    return m;
  }

  // Perimeter walls
  const T = 2, WH = 3;
  const wallMat = (len) => {
    const t = wallTex.clone();
    t.needsUpdate = true;
    t.repeat.set(len / 4, 1);
    return new THREE.MeshLambertMaterial({ map: t });
  };
  const L = HALF * 2 + T * 2;
  addBox(0, HALF + T / 2, L, T, WH, wallMat(L));
  addBox(0, -HALF - T / 2, L, T, WH, wallMat(L));
  addBox(HALF + T / 2, 0, T, L, WH, wallMat(L));
  addBox(-HALF - T / 2, 0, T, L, WH, wallMat(L));

  // Central tower
  addCyl(0, 0, 6, 5, concreteMat);
  const ring = new THREE.Mesh(
    new THREE.TorusGeometry(6.1, 0.25, 8, 48),
    new THREE.MeshBasicMaterial({ color: '#00e5ff' }),
  );
  ring.rotation.x = Math.PI / 2;
  ring.position.y = 4.2;
  scene.add(ring);
  const top = new THREE.Mesh(
    new THREE.ConeGeometry(4, 5, 6),
    new THREE.MeshLambertMaterial({ color: '#ff9f1c' }),
  );
  top.position.y = 7.5;
  top.castShadow = true;
  scene.add(top);

  // L-shaped cover in each quadrant
  const coverMat = new THREE.MeshLambertMaterial({ color: '#457b9d' });
  for (const sx of [-1, 1]) {
    for (const sz of [-1, 1]) {
      addBox(sx * 46, sz * 37, 18, 2, 2.6, coverMat);
      addBox(sx * 37, sz * 46, 2, 18, 2.6, coverMat);
    }
  }

  // Crates near the middle
  for (const [x, z] of [[24, 0], [-24, 0], [0, 24], [0, -24]]) addBox(x, z, 4, 4, 3, crateMat);
  for (const [x, z] of [[27, 4.5], [-27, -4.5], [-4.5, 27], [4.5, -27]]) addBox(x, z, 3, 3, 2.2, crateMat);

  // Long barriers on the axes
  const barrierMat = new THREE.MeshLambertMaterial({ color: '#2a9d8f' });
  addBox(65, 0, 2, 16, 2.4, barrierMat);
  addBox(-65, 0, 2, 16, 2.4, barrierMat);
  addBox(0, 65, 16, 2, 2.4, barrierMat);
  addBox(0, -65, 16, 2, 2.4, barrierMat);

  // Tire stacks
  const tireMat = new THREE.MeshLambertMaterial({ color: '#1d1d1f' });
  for (const [x, z] of [
    [14, 34], [-14, 34], [14, -34], [-14, -34], [34, 14], [34, -14], [-34, 14], [-34, -14],
    [72, 72], [-72, 72], [72, -72], [-72, -72], [58, 26], [-58, -26], [26, -58], [-26, 58],
  ]) {
    addCyl(x, z, 1.4, 1.8, tireMat);
  }

  // Jump pads
  const padMat = new THREE.MeshBasicMaterial({ color: '#39ff14', transparent: true, opacity: 0.85 });
  const arrowMat = new THREE.MeshBasicMaterial({ color: '#eaffea' });
  world.padMeshes = [];
  for (const [x, z] of [[46, 0], [-46, 0], [0, 46], [0, -46], [70, 40], [-70, -40], [40, -70], [-40, 70]]) {
    const pad = new THREE.Mesh(new THREE.CylinderGeometry(3, 3.3, 0.25, 32), padMat);
    pad.position.set(x, 0.12, z);
    scene.add(pad);
    const chev = new THREE.Mesh(new THREE.ConeGeometry(1.2, 1.2, 4), arrowMat);
    chev.position.set(x, 0.9, z);
    scene.add(chev);
    world.padMeshes.push(chev);
    world.pads.push({ x, z, r: 3 });
  }

  // Decorative trees / hills outside
  const treeMat = new THREE.MeshLambertMaterial({ color: '#2f6b2f' });
  const trunkMat = new THREE.MeshLambertMaterial({ color: '#6b4a2b' });
  for (let i = 0; i < 70; i++) {
    const a = Math.random() * Math.PI * 2;
    const r = 110 + Math.random() * 90;
    const x = Math.cos(a) * r, z = Math.sin(a) * r;
    const s = 3 + Math.random() * 4;
    const tree = new THREE.Mesh(new THREE.ConeGeometry(s, s * 3, 7), treeMat);
    tree.position.set(x, s * 1.5 + 2, z);
    scene.add(tree);
    const trunk = new THREE.Mesh(new THREE.CylinderGeometry(0.6, 0.8, 2.5), trunkMat);
    trunk.position.set(x, 1.25, z);
    scene.add(trunk);
  }

  // Spawn points around the edge, facing the middle
  for (const [x, z] of [[80, 80], [-80, 80], [80, -80], [-80, -80], [80, 20], [-80, -20], [20, -80], [-20, 80]]) {
    world.spawns.push({ x, z, yaw: Math.atan2(-x, -z) });
  }

  // Pickups (state is owned by the host)
  let id = 0;
  for (const [x, z] of [[47, 47], [-47, 47], [47, -47], [-47, -47]]) world.items.push({ id: id++, type: 'rocket', x, z });
  for (const [x, z] of [[74, 0], [-74, 0], [0, 74], [0, -74]]) world.items.push({ id: id++, type: 'health', x, z });
  for (const [x, z] of [[18, 18], [-18, -18], [18, -18], [-18, 18]]) world.items.push({ id: id++, type: 'boost', x, z });

  return world;
}

/** True if the point is inside a solid obstacle (used by projectiles and bot line-of-sight). */
export function pointBlocked(world, x, y, z, pad = 0) {
  if (y < 0) return true;
  if (Math.abs(x) > world.half + 2 || Math.abs(z) > world.half + 2) return true;
  for (const b of world.boxes) {
    if (y < b.h && x > b.minX - pad && x < b.maxX + pad && z > b.minZ - pad && z < b.maxZ + pad) return true;
  }
  for (const c of world.cyls) {
    const dx = x - c.x, dz = z - c.z, r = c.r + pad;
    if (y < c.h && dx * dx + dz * dz < r * r) return true;
  }
  return false;
}

/** Push a circle (kart) out of all obstacles. Returns the strongest impact speed. */
export function collideWorld(world, pos, vel, r) {
  let impact = 0;
  const resolve = (nx, nz, push) => {
    pos.x += nx * push;
    pos.z += nz * push;
    const vn = vel.x * nx + vel.z * nz;
    if (vn < 0) {
      vel.x -= nx * vn * 1.35;
      vel.z -= nz * vn * 1.35;
      impact = Math.max(impact, -vn);
    }
  };
  for (const b of world.boxes) {
    if (pos.y > b.h) continue;
    const cx = Math.max(b.minX, Math.min(pos.x, b.maxX));
    const cz = Math.max(b.minZ, Math.min(pos.z, b.maxZ));
    const dx = pos.x - cx, dz = pos.z - cz;
    const d2 = dx * dx + dz * dz;
    if (d2 >= r * r) continue;
    if (d2 > 1e-8) {
      const d = Math.sqrt(d2);
      resolve(dx / d, dz / d, r - d);
    } else {
      // Center is inside the box: push out along the shallowest axis
      const opts = [
        [pos.x - b.minX, -1, 0], [b.maxX - pos.x, 1, 0],
        [pos.z - b.minZ, 0, -1], [b.maxZ - pos.z, 0, 1],
      ].sort((a, c) => a[0] - c[0]);
      resolve(opts[0][1], opts[0][2], opts[0][0] + r);
    }
  }
  for (const c of world.cyls) {
    if (pos.y > c.h) continue;
    const dx = pos.x - c.x, dz = pos.z - c.z;
    const rr = c.r + r;
    const d2 = dx * dx + dz * dz;
    if (d2 >= rr * rr) continue;
    const d = Math.sqrt(d2) || 0.001;
    resolve(dx / d, dz / d, rr - d);
  }
  // Hard clamp in case something tunnels
  const lim = world.half - r;
  if (pos.x > lim) resolve(-1, 0, pos.x - lim);
  if (pos.x < -lim) resolve(1, 0, -lim - pos.x);
  if (pos.z > lim) resolve(0, -1, pos.z - lim);
  if (pos.z < -lim) resolve(0, 1, -lim - pos.z);
  return impact;
}
