import * as THREE from 'three';
import { Terrain, seeded } from './terrain.js';

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

function grassTexture() {
  return canvasTex(256, (g, s) => {
    g.fillStyle = '#6aa84f';
    g.fillRect(0, 0, s, s);
    for (let i = 0; i < 5000; i++) {
      const v = Math.random();
      g.fillStyle = v < 0.33 ? '#5e9a45' : v < 0.66 ? '#78b85a' : '#86a060';
      g.fillRect(Math.random() * s, Math.random() * s, 2, 3);
    }
  }, 30);
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
export function buildArena(scene, { map = 'stadium', destructible = false } = {}) {
  const craters = map === 'craters';
  const world = {
    half: HALF, boxes: [], cyls: [], pads: [], spawns: [], items: [],
    map: craters ? 'craters' : 'stadium',
    destructible: !!destructible,
    terrain: null,
    pieces: [], // destructible boxes and cylinders, indexed by id
    groundAt: () => 0,
  };

  scene.background = new THREE.Color(craters ? '#a9d8ff' : '#8fc7ff');
  scene.fog = new THREE.Fog(craters ? '#b9e0ff' : '#8fc7ff', 140, 320);

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

  // Grass beyond the arena (with a hole in the middle so craters don't show it)
  const outer = new THREE.Shape([[-400, -400], [400, -400], [400, 400], [-400, 400]].map(([x, y]) => new THREE.Vector2(x, y)));
  const E = HALF + 2;
  outer.holes.push(new THREE.Path([[-E, -E], [-E, E], [E, E], [E, -E]].map(([x, y]) => new THREE.Vector2(x, y))));
  const grass = new THREE.Mesh(new THREE.ShapeGeometry(outer), new THREE.MeshLambertMaterial({ color: '#5d9a45' }));
  grass.rotation.x = -Math.PI / 2;
  grass.position.y = -0.05;
  grass.receiveShadow = true;
  scene.add(grass);

  if (craters || destructible) {
    // Deformable ground: rockets dig craters into it
    const rnd = seeded(1337);
    const hills = [];
    if (craters) {
      hills.push([0, 0, 6, 16]);
      for (let i = 0; i < 16; i++) hills.push([(rnd() * 2 - 1) * 72, (rnd() * 2 - 1) * 72, 2 + rnd() * 6, 8 + rnd() * 14]);
    }
    const edge = (v) => Math.min(1, Math.max(0, (HALF - 6 - Math.abs(v)) / 14));
    const heightFn = (x, z) => {
      let h = 0;
      for (const [hx, hz, a, sg] of hills) h += a * Math.exp(-((x - hx) ** 2 + (z - hz) ** 2) / (2 * sg * sg));
      if (craters) h += Math.sin(x * 0.11) * Math.cos(z * 0.09) * 0.8;
      return Math.max(0, h) * edge(x) * edge(z);
    };
    const mat = new THREE.MeshLambertMaterial({ map: craters ? grassTexture() : asphaltTexture() });
    world.terrain = new Terrain(scene, HALF * 2 + 4, 124, heightFn, mat);
    world.groundAt = (x, z) => world.terrain.heightAt(x, z);
  } else {
    // Asphalt floor
    const floor = new THREE.Mesh(
      new THREE.PlaneGeometry(HALF * 2, HALF * 2),
      new THREE.MeshLambertMaterial({ map: asphaltTexture() }),
    );
    floor.rotation.x = -Math.PI / 2;
    floor.receiveShadow = true;
    scene.add(floor);
  }

  // Painted rings / lines on the floor
  const paint = new THREE.MeshBasicMaterial({ color: '#f2f2f2', transparent: true, opacity: 0.55 });
  for (const r of world.terrain ? [] : [14, 30]) {
    const ring = new THREE.Mesh(new THREE.RingGeometry(r - 0.4, r, 96), paint);
    ring.rotation.x = -Math.PI / 2;
    ring.position.y = 0.02;
    scene.add(ring);
  }
  const yellow = new THREE.MeshBasicMaterial({ color: '#ffd23f', transparent: true, opacity: 0.7 });
  for (const [w, d] of world.terrain ? [] : [[HALF * 2 - 8, 0.6], [0.6, HALF * 2 - 8]]) {
    const line = new THREE.Mesh(new THREE.PlaneGeometry(w, d), yellow);
    line.rotation.x = -Math.PI / 2;
    line.position.y = 0.015;
    scene.add(line);
  }

  const wallTex = stripeTexture('#e63946', '#f1f1f1');
  const crateMat = new THREE.MeshLambertMaterial({ map: crateTexture() });
  const concreteMat = new THREE.MeshLambertMaterial({ color: '#9aa3ad' });

  // Destructible boxes are split into blocks, drawn with one InstancedMesh per material
  const blockSets = new Map();
  function addBox(cx, cz, w, d, h, mat, breakable = false) {
    const base = breakable || craters ? Math.max(0, world.groundAt(cx, cz) - 0.4) : 0;
    if (!(breakable && world.destructible)) {
      const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
      m.position.set(cx, base + h / 2, cz);
      m.castShadow = m.receiveShadow = true;
      scene.add(m);
      world.boxes.push({ minX: cx - w / 2, maxX: cx + w / 2, minZ: cz - d / 2, maxZ: cz + d / 2, y0: base - 50, h: base + h });
      return;
    }
    const nx = Math.ceil(w / 2.2), nz = Math.ceil(d / 2.2), ny = Math.ceil(h / 1.5);
    const bw = w / nx, bd = d / nz, bh = h / ny;
    if (!blockSets.has(mat)) blockSets.set(mat, []);
    for (let ix = 0; ix < nx; ix++) for (let iz = 0; iz < nz; iz++) {
      const column = [];
      for (let iy = 0; iy < ny; iy++) {
      const x0 = cx - w / 2 + ix * bw, z0 = cz - d / 2 + iz * bd, y0 = base + iy * bh;
      const b = {
        minX: x0, maxX: x0 + bw, minZ: z0, maxZ: z0 + bd, y0: iy === 0 ? y0 - 50 : y0, h: y0 + bh,
        id: world.pieces.length, dead: false, hp: 4, cx: x0 + bw / 2, cy: y0 + bh / 2, cz: z0 + bd / 2,
        size: [bw * 0.97, bh * 0.97, bd * 0.97], color: mat.color, column, iy,
      };
      column.push(b);
      world.pieces.push(b);
      world.boxes.push(b);
      blockSets.get(mat).push(b);
      }
    }
  }

  function addCyl(x, z, r, h, mat, breakable = false) {
    const base = craters ? Math.max(0, world.groundAt(x, z) - 0.3) : 0;
    const m = new THREE.Mesh(new THREE.CylinderGeometry(r, r, h, 24), mat);
    m.position.set(x, base + h / 2, z);
    m.castShadow = m.receiveShadow = true;
    scene.add(m);
    const c = { x, z, r, h: base + h, y0: base - 50 };
    if (breakable && world.destructible) {
      Object.assign(c, { id: world.pieces.length, dead: false, hp: 4, cx: x, cy: base + h / 2, cz: z, mesh: m, color: mat.color });
      world.pieces.push(c);
    }
    world.cyls.push(c);
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

  if (craters) {
    // Crater Field: block forts on rolling hills
    const stoneMat = new THREE.MeshLambertMaterial({ color: '#9c8f7d' });
    const brickMat = new THREE.MeshLambertMaterial({ color: '#b5543c' });
    const tireMat = new THREE.MeshLambertMaterial({ color: '#1d1d1f' });
    for (const sx of [-1, 1]) {
      for (const sz of [-1, 1]) {
        // U-shaped fort opening toward the middle
        addBox(sx * 47, sz * 56, 16, 2, 3.2, brickMat, true);
        addBox(sx * 56, sz * 47, 2, 16, 3.2, brickMat, true);
        addBox(sx * 39, sz * 50, 2, 8, 3.2, brickMat, true);
      }
    }
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * Math.PI * 2 + Math.PI / 8;
      addBox(Math.cos(a) * 15, Math.sin(a) * 15, 2.2, 2.2, 4.5, stoneMat, true);
    }
    for (const [x, z] of [[62, 0], [-62, 0], [0, 62], [0, -62]]) {
      addBox(x, z, Math.abs(x) ? 2 : 14, Math.abs(x) ? 14 : 2, 2.6, stoneMat, true);
    }
    for (const [x, z] of [[26, 8], [-26, -8], [8, -26], [-8, 26]]) addBox(x, z, 4, 4, 3, crateMat, true);
    for (const [x, z] of [[72, 72], [-72, 72], [72, -72], [-72, -72], [30, 40], [-30, -40], [40, -30], [-40, 30]]) {
      addCyl(x, z, 1.4, 1.8, tireMat, true);
    }
  } else {
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
        addBox(sx * 46, sz * 37, 18, 2, 2.6, coverMat, true);
        addBox(sx * 37, sz * 46, 2, 18, 2.6, coverMat, true);
      }
    }

    // Crates near the middle
    for (const [x, z] of [[24, 0], [-24, 0], [0, 24], [0, -24]]) addBox(x, z, 4, 4, 3, crateMat, true);
    for (const [x, z] of [[27, 4.5], [-27, -4.5], [-4.5, 27], [4.5, -27]]) addBox(x, z, 3, 3, 2.2, crateMat, true);

    // Long barriers on the axes
    const barrierMat = new THREE.MeshLambertMaterial({ color: '#2a9d8f' });
    addBox(65, 0, 2, 16, 2.4, barrierMat, true);
    addBox(-65, 0, 2, 16, 2.4, barrierMat, true);
    addBox(0, 65, 16, 2, 2.4, barrierMat, true);
    addBox(0, -65, 16, 2, 2.4, barrierMat, true);

    // Tire stacks
    const tireMat = new THREE.MeshLambertMaterial({ color: '#1d1d1f' });
    for (const [x, z] of [
      [14, 34], [-14, 34], [14, -34], [-14, -34], [34, 14], [34, -14], [-34, 14], [-34, -14],
      [72, 72], [-72, 72], [72, -72], [-72, -72], [58, 26], [-58, -26], [26, -58], [-26, 58],
    ]) {
      addCyl(x, z, 1.4, 1.8, tireMat, true);
    }
  }

  // Jump pads
  const padMat = new THREE.MeshBasicMaterial({ color: '#39ff14', transparent: true, opacity: 0.85 });
  const arrowMat = new THREE.MeshBasicMaterial({ color: '#eaffea' });
  world.padMeshes = [];
  for (const [x, z] of [[46, 0], [-46, 0], [0, 46], [0, -46], [70, 40], [-70, -40], [40, -70], [-40, 70]]) {
    const gy = world.groundAt(x, z);
    const pad = new THREE.Mesh(new THREE.CylinderGeometry(3, 3.3, 0.25, 32), padMat);
    pad.position.set(x, gy + 0.12, z);
    scene.add(pad);
    const chev = new THREE.Mesh(new THREE.ConeGeometry(1.2, 1.2, 4), arrowMat);
    chev.position.set(x, gy + 0.9, z);
    chev.userData.base = gy;
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
  // Weapon crates (keys 2-0)
  for (const [w, x, z] of [
    ['hail', 30, 30], ['bubble', -30, -30], ['grenade', 30, -30], ['electro', -30, 30], ['sniper', 0, 82],
    ['beam', 0, -82], ['minigun', 82, -30], ['shotgun', -82, 30], ['flame', 0, 12],
  ]) {
    world.items.push({ id: id++, type: 'weapon', w, x, z });
  }

  // Instanced blocks
  const unit = new THREE.BoxGeometry(1, 1, 1);
  const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), p = new THREE.Vector3(), sv = new THREE.Vector3();
  for (const [mat, list] of blockSets) {
    const inst = new THREE.InstancedMesh(unit, mat, list.length);
    inst.castShadow = inst.receiveShadow = true;
    list.forEach((b, i) => {
      inst.setMatrixAt(i, m4.compose(p.set(b.cx, b.cy, b.cz), q, sv.set(...b.size)));
      b.inst = inst;
      b.ii = i;
    });
    scene.add(inst);
  }
  const zero = new THREE.Matrix4().makeScale(0, 0, 0);

  /** Knock out a piece; blocks stacked above it collapse too. Returns everything removed. */
  world.destroy = (id) => {
    const b = world.pieces[id];
    if (!b || b.dead) return [];
    const out = [];
    for (const x of b.column ? b.column.filter((c) => c.iy >= b.iy) : [b]) {
      if (x.dead) continue;
      x.dead = true;
      if (x.inst) {
        x.inst.setMatrixAt(x.ii, zero);
        x.inst.instanceMatrix.needsUpdate = true;
      }
      if (x.mesh) x.mesh.visible = false;
      out.push(x);
    }
    return out;
  };
  world.pieceAt = (x, y, z) => {
    for (const b of world.pieces) {
      if (b.dead) continue;
      if (b.r) {
        if (y < b.h && (x - b.x) ** 2 + (z - b.z) ** 2 < (b.r + 0.3) ** 2) return b;
      } else if (x > b.minX - 0.3 && x < b.maxX + 0.3 && z > b.minZ - 0.3 && z < b.maxZ + 0.3 && y < b.h + 0.3 && y > b.y0 - 0.3) {
        return b;
      }
    }
    return null;
  };
  /** Rocket blast: dig the ground and knock out nearby blocks. Returns destroyed pieces. */
  world.carve = (x, y, z, r) => {
    world.terrain?.carve(x, y, z, r);
    const gone = [];
    for (const b of world.pieces) {
      if (!b.dead && Math.hypot(b.cx - x, b.cy - y, b.cz - z) < r + 0.6) gone.push(...world.destroy(b.id));
    }
    return gone;
  };

  return world;
}

/** True if the point is inside a solid obstacle (used by projectiles and bot line-of-sight). */
export function pointBlocked(world, x, y, z, pad = 0) {
  if (y < world.groundAt(x, z)) return true;
  if (Math.abs(x) > world.half + 2 || Math.abs(z) > world.half + 2) return true;
  for (const b of world.boxes) {
    if (b.dead || y < b.y0) continue;
    if (y < b.h && x > b.minX - pad && x < b.maxX + pad && z > b.minZ - pad && z < b.maxZ + pad) return true;
  }
  for (const c of world.cyls) {
    if (c.dead) continue;
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
    if (b.dead || pos.y > b.h || pos.y + 1.8 < b.y0) continue;
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
    if (c.dead || pos.y > c.h) continue;
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
