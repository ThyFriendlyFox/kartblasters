import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
import { Terrain } from './terrain.js';

/**
 * Two special battle arenas:
 *  - Daytona: a scaled-down tri-oval superspeedway. The banking is part of
 *    the heightfield (31° turns, 18° dogleg, 3° back straight) inside a
 *    solid outer wall with a catch fence, with an infield of pit road,
 *    garages and a lake for cover.
 *  - Cube: a Rocket League style box whose edges are rounded, so karts can
 *    drive up the walls and across the ceiling (see Kart.simulateSurface).
 * Each returns the same world object buildArena does, plus optional hooks:
 * bound() keeps karts inside a non-square arena, blocked() tells projectiles
 * and cameras where the solid parts are, randomPoint() gives bots somewhere
 * to go, outline is drawn on the minimap and surface is the cube's shape.
 */

const smooth = (t) => t * t * (3 - 2 * t);
const clamp01 = (t) => Math.max(0, Math.min(1, t));

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

/** Light grain: tinted per vertex into asphalt, grass or concrete. */
function grain(repeat) {
  return canvasTex(256, (g, s) => {
    g.fillStyle = '#ffffff';
    g.fillRect(0, 0, s, s);
    for (let i = 0; i < 6000; i++) {
      const v = 190 + Math.random() * 65;
      g.fillStyle = `rgb(${v},${v},${v})`;
      g.fillRect(Math.random() * s, Math.random() * s, 2, 2);
    }
  }, repeat);
}

function baseWorld(map, half, destructible) {
  const world = {
    half, boxes: [], cyls: [], pads: [], spawns: [], items: [], map,
    destructible: !!destructible, terrain: null, pieces: [], padMeshes: [],
    groundAt: () => 0,
  };
  world.destroy = () => [];
  world.pieceAt = () => null;
  world.carve = (x, y, z, r) => {
    world.terrain?.carve(x, y, z, r);
    return [];
  };
  return world;
}

function addLights(scene, { sky, fog, shadow }) {
  scene.background = new THREE.Color(sky);
  scene.fog = new THREE.Fog(sky, ...fog);
  scene.add(new THREE.HemisphereLight('#dff1ff', '#4a6b3a', 1.4));
  const sun = new THREE.DirectionalLight('#fff4e0', 2.2);
  sun.position.set(90, 160, 60);
  sun.castShadow = true;
  sun.shadow.mapSize.setScalar(document.body.classList.contains('touch') ? 1024 : 2048);
  const sc = sun.shadow.camera;
  sc.left = sc.bottom = -shadow;
  sc.right = sc.top = shadow;
  sc.near = 10;
  sc.far = 500;
  sun.shadow.bias = -0.0005;
  scene.add(sun);
}

function addPads(scene, world, spots) {
  const padMat = new THREE.MeshBasicMaterial({ color: '#39ff14', transparent: true, opacity: 0.85 });
  const arrowMat = new THREE.MeshBasicMaterial({ color: '#eaffea' });
  for (const [x, z] of spots) {
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
}

function addItems(world, { rocket = [], health = [], boost = [], akimbo = [], weapon = [] }) {
  let id = 0;
  for (const [x, z] of rocket) world.items.push({ id: id++, type: 'rocket', x, z });
  for (const [x, z] of health) world.items.push({ id: id++, type: 'health', x, z });
  for (const [x, z] of boost) world.items.push({ id: id++, type: 'boost', x, z });
  for (const [w, x, z] of weapon) world.items.push({ id: id++, type: 'weapon', w, x, z });
  for (const [x, z] of akimbo) world.items.push({ id: id++, type: 'akimbo', x, z });
}

function staticBox(scene, world, cx, cz, w, d, h, mat) {
  const base = Math.min(world.groundAt(cx - w / 2, cz - d / 2), world.groundAt(cx + w / 2, cz + d / 2), world.groundAt(cx, cz)) - 0.3;
  const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
  m.position.set(cx, base + h / 2, cz);
  m.castShadow = m.receiveShadow = true;
  scene.add(m);
  world.boxes.push({ minX: cx - w / 2, maxX: cx + w / 2, minZ: cz - d / 2, maxZ: cz + d / 2, y0: base - 50, h: base + h });
}

function staticCyl(scene, world, x, z, r, h, mat) {
  const base = world.groundAt(x, z) - 0.2;
  const m = new THREE.Mesh(new THREE.CylinderGeometry(r, r, h, 20), mat);
  m.position.set(x, base + h / 2, z);
  m.castShadow = m.receiveShadow = true;
  scene.add(m);
  world.cyls.push({ x, z, r, h: base + h, y0: base - 50 });
}

// ------------------------------------------------------------------ Daytona

const DA = 105; // half the length of the straights
const DRI = 62; // inner edge of the racing surface (from the straights' axis)
const DW = 30; // track width
const DRO = DRI + DW; // outer wall
const BULGE = 16; // the tri-oval dogleg on the front stretch

/** Distance from the oval's spine, with the front stretch bowed outward. */
export function ovalDist(x, z) {
  const cx = Math.max(-DA, Math.min(DA, x));
  let d = Math.hypot(x - cx, z);
  if (z < 0 && Math.abs(x) < DA) d -= BULGE * Math.cos((Math.PI * x) / (2 * DA)) ** 2;
  return d;
}

/** Banking (as a slope): 31° in the turns, 18° on the tri-oval, 3° on the back straight. */
function bankSlope(x, z) {
  const t = smooth(clamp01((Math.abs(x) - (DA - 45)) / 45));
  const flat = z < 0 ? 18 : 3;
  return Math.tan(THREE.MathUtils.degToRad(flat + (31 - flat) * t));
}

const LAKE = { x: -40, z: 18, rx: 36, rz: 16 };

function daytonaHeight(x, z) {
  const u = ovalDist(x, z) - DRI;
  // Past the wall the ground slopes back down as a grassy embankment
  if (u > DW + 3) return DW * bankSlope(x, z) * (1 - smooth(clamp01((u - DW - 3) / 22)));
  if (u > 0) return Math.min(u, DW) * bankSlope(x, z);
  const e = Math.hypot((x - LAKE.x) / LAKE.rx, (z - LAKE.z) / LAKE.rz);
  return e < 1 ? -1.6 * smooth(1 - e) : 0;
}

/** A point on the oval `R` from the spine, s in [0, 1) going anticlockwise. */
export function ovalPoint(s, R, out = new THREE.Vector2()) {
  const Ls = 2 * DA, Lt = Math.PI * R, L = 2 * Ls + 2 * Lt;
  let d = (((s % 1) + 1) % 1) * L;
  if (d < Ls) return out.set(DA - d, R); // back straight, heading -x
  d -= Ls;
  if (d < Lt) {
    const a = Math.PI / 2 + d / R;
    return out.set(-DA + R * Math.cos(a), R * Math.sin(a));
  }
  d -= Lt;
  if (d < Ls) {
    const x = -DA + d;
    return out.set(x, -(R + BULGE * Math.cos((Math.PI * x) / (2 * DA)) ** 2));
  }
  d -= Ls;
  const a = -Math.PI / 2 + d / R;
  return out.set(DA + R * Math.cos(a), R * Math.sin(a));
}

/** Flat ribbon lying on the ground between offsets u0 and u1 from the inner edge. */
function ovalRibbon(u0, u1, mat, lift = 0.06, N = 480) {
  const pos = [];
  const a = new THREE.Vector2(), b = new THREE.Vector2(), c = new THREE.Vector2(), d = new THREE.Vector2();
  const P = (v) => [v.x, daytonaHeight(v.x, v.y) + lift, v.y];
  for (let i = 0; i < N; i++) {
    ovalPoint(i / N, DRI + u0, a);
    ovalPoint(i / N, DRI + u1, b);
    ovalPoint((i + 1) / N, DRI + u0, c);
    ovalPoint((i + 1) / N, DRI + u1, d);
    pos.push(...P(a), ...P(b), ...P(d), ...P(a), ...P(d), ...P(c));
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.computeVertexNormals();
  return new THREE.Mesh(g, mat);
}

export function buildDaytona(scene, { destructible = false } = {}) {
  const world = baseWorld('daytona', DA + DRO + 14, destructible);
  addLights(scene, { sky: '#8fc7ff', fog: [260, 760], shadow: 230 });

  // Grass and concrete out to the horizon
  const outer = new THREE.Mesh(new THREE.PlaneGeometry(1600, 1600), new THREE.MeshLambertMaterial({ color: '#5d9a45' }));
  outer.rotation.x = -Math.PI / 2;
  outer.position.y = -0.6;
  scene.add(outer);

  // The banked oval, infield and lake as one heightfield, coloured per vertex
  const size = world.half * 2 + 10;
  const mat = new THREE.MeshLambertMaterial({ map: grain(60) });
  world.terrain = new Terrain(scene, size, 220, daytonaHeight, mat);
  world.groundAt = (x, z) => world.terrain.heightAt(x, z);
  const col = world.terrain.geo.attributes.color, tp = world.terrain.geo.attributes.position;
  const c = new THREE.Color();
  for (let k = 0; k < col.count; k++) {
    const x = tp.getX(k), z = tp.getZ(k), u = ovalDist(x, z) - DRI;
    const lake = Math.hypot((x - LAKE.x) / LAKE.rx, (z - LAKE.z) / LAKE.rz) < 1.05;
    const pit = z < 0 && u > -24 && u < -8 && Math.abs(x) < 80;
    if (u > DW + 3) c.set('#5d9a45');
    else if (u > DW) c.set('#8d9096');
    else if (u > 0) c.set('#55585e');
    else if (u > -7 || pit) c.set('#6d7076');
    else if (lake) c.set('#3d6b56');
    else c.set(((Math.floor(x / 12) + Math.floor(z / 12)) & 1) ? '#5e9f47' : '#66a94e'); // mowed stripes
    col.setXYZ(k, c.r, c.g, c.b);
  }
  col.needsUpdate = true;

  // Lake Lloyd
  const water = new THREE.Mesh(new THREE.CircleGeometry(1, 48), new THREE.MeshStandardMaterial({ color: '#2e86c1', roughness: 0.1, metalness: 0.3, transparent: true, opacity: 0.85 }));
  water.rotation.x = -Math.PI / 2;
  water.scale.set(LAKE.rx * 0.95, LAKE.rz * 0.95, 1);
  water.position.set(LAKE.x, -0.45, LAKE.z);
  scene.add(water);

  // Painted lines: double yellow on the apron edge, white along the bottom of the banking
  scene.add(ovalRibbon(-2.4, -1.9, new THREE.MeshBasicMaterial({ color: '#ffd23f' })));
  scene.add(ovalRibbon(-1.4, -0.9, new THREE.MeshBasicMaterial({ color: '#ffd23f' })));
  scene.add(ovalRibbon(0.6, 1.1, new THREE.MeshBasicMaterial({ color: '#f5f5f5' })));
  scene.add(ovalRibbon(DW * 0.5 - 0.2, DW * 0.5 + 0.2, new THREE.MeshBasicMaterial({ color: '#dcdcdc', transparent: true, opacity: 0.5 })));

  // Start / finish line across the front stretch
  const chk = canvasTex(64, (g, s) => {
    for (let i = 0; i < 8; i++) for (let j = 0; j < 8; j++) {
      g.fillStyle = (i + j) & 1 ? '#111' : '#fff';
      g.fillRect((i * s) / 8, (j * s) / 8, s / 8, s / 8);
    }
  });
  {
    const pos = [], uv = [];
    const N = 12;
    for (let i = 0; i < N; i++) {
      const u0 = (i / N) * DW, u1 = ((i + 1) / N) * DW;
      const z0 = -(DRI + BULGE + u0), z1 = -(DRI + BULGE + u1);
      const y0 = daytonaHeight(0, z0) + 0.08, y1 = daytonaHeight(0, z1) + 0.08;
      pos.push(-2, y0, z0, 2, y0, z0, 2, y1, z1, -2, y0, z0, 2, y1, z1, -2, y1, z1);
      const v0 = (i / N) * 8, v1 = ((i + 1) / N) * 8;
      uv.push(0, v0, 1, v0, 1, v1, 0, v0, 1, v1, 0, v1);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
    scene.add(new THREE.Mesh(g, new THREE.MeshBasicMaterial({ map: chk, side: THREE.DoubleSide })));
  }

  // SAFER barrier and catch fence around the outside
  {
    const N = 360, wall = [], fence = [], wallUv = [];
    const p = new THREE.Vector2(), q = new THREE.Vector2();
    for (let i = 0; i < N; i++) {
      ovalPoint(i / N, DRO, p);
      ovalPoint((i + 1) / N, DRO, q);
      const hp = DW * bankSlope(p.x, p.y) - 0.5, hq = DW * bankSlope(q.x, q.y) - 0.5;
      const quad = (arr, y0p, y1p, y0q, y1q) => arr.push(p.x, y0p, p.y, q.x, y0q, q.y, q.x, y1q, q.y, p.x, y0p, p.y, q.x, y1q, q.y, p.x, y1p, p.y);
      quad(wall, hp, hp + 4, hq, hq + 4);
      wallUv.push(0, 0, 1, 0, 1, 1, 0, 0, 1, 1, 0, 1);
      quad(fence, hp + 4, hp + 12, hq + 4, hq + 12);
    }
    const wallTex = canvasTex(128, (g, s) => {
      g.fillStyle = '#f4f4f4';
      g.fillRect(0, 0, s, s);
      g.fillStyle = '#1d4ed8';
      g.fillRect(0, s * 0.72, s, s * 0.12);
      g.fillStyle = '#e11d48';
      g.fillRect(0, s * 0.86, s, s * 0.08);
    });
    const wg = new THREE.BufferGeometry();
    wg.setAttribute('position', new THREE.Float32BufferAttribute(wall, 3));
    wg.setAttribute('uv', new THREE.Float32BufferAttribute(wallUv, 2));
    wg.computeVertexNormals();
    const wm = new THREE.Mesh(wg, new THREE.MeshLambertMaterial({ map: wallTex, side: THREE.DoubleSide }));
    wm.receiveShadow = true;
    scene.add(wm);
    const fenceTex = canvasTex(64, (g, s) => {
      g.clearRect(0, 0, s, s);
      g.strokeStyle = 'rgba(210,215,225,0.9)';
      g.lineWidth = 2;
      for (let i = -s; i < s * 2; i += 12) {
        g.beginPath();
        g.moveTo(i, 0);
        g.lineTo(i + s, s);
        g.moveTo(i + s, 0);
        g.lineTo(i, s);
        g.stroke();
      }
    });
    const fg = new THREE.BufferGeometry();
    fg.setAttribute('position', new THREE.Float32BufferAttribute(fence, 3));
    fg.setAttribute('uv', new THREE.Float32BufferAttribute(wallUv.map((v, i) => (i % 2 ? v * 2 : v)), 2));
    scene.add(new THREE.Mesh(fg, new THREE.MeshBasicMaterial({ map: fenceTex, transparent: true, side: THREE.DoubleSide, depthWrite: false })));
    // Fence posts
    const postMat = new THREE.MeshLambertMaterial({ color: '#9aa1ab' });
    const postGeo = new THREE.CylinderGeometry(0.25, 0.25, 12, 6);
    const posts = new THREE.InstancedMesh(postGeo, postMat, 120);
    const m4 = new THREE.Matrix4();
    for (let i = 0; i < 120; i++) {
      ovalPoint(i / 120, DRO + 0.3, p);
      posts.setMatrixAt(i, m4.makeTranslation(p.x, DW * bankSlope(p.x, p.y) + 5.5, p.y));
    }
    scene.add(posts);
  }

  // Grandstands along the front stretch, stepped and packed with fans
  {
    const crowd = canvasTex(256, (g, s) => {
      g.fillStyle = '#3b4252';
      g.fillRect(0, 0, s, s);
      const cols = ['#e11d48', '#facc15', '#2563eb', '#f5f5f5', '#16a34a', '#f97316', '#111827'];
      for (let i = 0; i < 2200; i++) {
        g.fillStyle = cols[Math.floor(Math.random() * cols.length)];
        g.fillRect(Math.random() * s, Math.floor(Math.random() * 16) * (s / 16) + 3, 3, 5);
      }
    }, 1);
    crowd.repeat.set(4, 1);
    const seat = new THREE.MeshLambertMaterial({ map: crowd });
    const frame = new THREE.MeshLambertMaterial({ color: '#c9ced6' });
    const p = new THREE.Vector2(), q = new THREE.Vector2();
    for (let i = 0; i < 12; i++) {
      // The front stretch is the third piece of ovalPoint's path
      const R = DRO + 26, Ls = 2 * DA, Lt = Math.PI * R;
      const s0 = (Ls + Lt + Ls * ((i + 0.5) / 12)) / (2 * Ls + 2 * Lt);
      ovalPoint(s0, R, p);
      ovalPoint(s0 + 0.004, DRO + 26, q);
      const yaw = Math.atan2(q.x - p.x, q.y - p.y);
      const g = new THREE.Group();
      for (let k = 0; k < 6; k++) {
        const tier = new THREE.Mesh(new THREE.BoxGeometry(18.5, 5, 6), seat);
        tier.position.set(0, 2.5 + k * 4.5, -k * 4.2 + 8);
        g.add(tier);
      }
      const roof = new THREE.Mesh(new THREE.BoxGeometry(18.5, 0.8, 30), frame);
      roof.position.set(0, 31, -4);
      g.add(roof);
      for (const x of [-8.5, 8.5]) {
        const post = new THREE.Mesh(new THREE.BoxGeometry(0.8, 31, 0.8), frame);
        post.position.set(x, 15.5, -18);
        g.add(post);
      }
      g.position.set(p.x, 0, p.y);
      g.rotation.y = yaw - Math.PI / 2; // local +x along the track, tiers climbing away from it
      g.traverse((o) => (o.castShadow = true));
      scene.add(g);
    }
  }

  // Infield: pit wall, garages, barriers and tyre stacks for cover
  const concrete = new THREE.MeshLambertMaterial({ color: '#b8bcc4' });
  const garageMat = new THREE.MeshLambertMaterial({ color: '#e5e7eb' });
  const roofMat = new THREE.MeshLambertMaterial({ color: '#dc2626' });
  const tireMat = new THREE.MeshLambertMaterial({ color: '#1d1d1f' });
  for (let x = -76; x <= 76; x += 9) {
    if (Math.abs(x) < 6) continue; // gap at the start line
    const z = -(DRI - 7 + BULGE * Math.cos((Math.PI * x) / (2 * DA)) ** 2);
    staticBox(scene, world, x, z, 6.5, 1, 1.6, concrete);
  }
  for (const [x, z, w] of [[40, -26, 30], [40, -8, 30], [-10, -30, 20]]) {
    staticBox(scene, world, x, z, w, 7, 5, garageMat);
    const roof = new THREE.Mesh(new THREE.BoxGeometry(w + 1, 0.6, 8), roofMat);
    roof.position.set(x, world.groundAt(x, z) + 5, z);
    scene.add(roof);
  }
  for (const [x, z] of [[75, 20], [-85, -12], [10, 30], [-100, 20], [100, -20], [-5, 5]]) staticBox(scene, world, x, z, 8, 1.4, 1.4, concrete);
  for (const [x, z] of [[62, 35], [-62, -30], [20, 12], [-75, 38], [85, -38], [-20, -12]]) staticCyl(scene, world, x, z, 1.4, 1.8, tireMat);
  addPads(scene, world, [[0, -12], [70, 5], [-80, 5], [25, 38], [-25, 40]]);

  // Where the wall is: keep karts inside it, and block shots and cameras
  const wallTop = (x, z) => DW * bankSlope(x, z) + 11.5;
  world.bound = (pos, vel, r, resolve) => {
    const d = ovalDist(pos.x, pos.z), lim = DRO - r;
    if (d <= lim) return;
    const e = 0.5;
    let nx = ovalDist(pos.x + e, pos.z) - ovalDist(pos.x - e, pos.z), nz = ovalDist(pos.x, pos.z + e) - ovalDist(pos.x, pos.z - e);
    const l = Math.hypot(nx, nz) || 1;
    nx /= l;
    nz /= l;
    resolve(-nx, -nz, d - lim);
  };
  world.blocked = (x, y, z) => ovalDist(x, z) > DRO && y < wallTop(x, z);
  world.randomPoint = () => {
    for (;;) {
      const x = (Math.random() * 2 - 1) * (DA + DRO - 8), z = (Math.random() * 2 - 1) * (DRO + BULGE - 8);
      if (ovalDist(x, z) < DRO - 6) return { x, z };
    }
  };
  world.outline = [DRO, DRI - 2].map((R) => Array.from({ length: 97 }, (_, i) => ovalPoint(i / 96, R).toArray()));

  // Spawns spread around the track, facing along it (anticlockwise)
  for (let i = 0; i < 8; i++) {
    const s = (i + 0.3) / 8, a = ovalPoint(s, DRI + 12), b = ovalPoint(s + 0.002, DRI + 12);
    world.spawns.push({ x: a.x, z: a.y, yaw: Math.atan2(b.x - a.x, b.y - a.y) });
  }
  const on = (s, u) => ovalPoint(s, DRI + u).toArray();
  addItems(world, {
    rocket: [on(0.12, 10), on(0.37, 20), on(0.62, 10), on(0.87, 20)],
    health: [on(0.25, 15), on(0.75, 15), [60, 25], [-60, -20]],
    boost: [on(0.05, 22), on(0.3, 8), on(0.55, 22), on(0.8, 8)],
    akimbo: [[0, 20], on(0.5, 15)],
    weapon: [
      ['hail', ...on(0.18, 15)], ['bubble', ...on(0.43, 15)], ['grenade', ...on(0.68, 15)], ['electro', ...on(0.93, 15)],
      ['sniper', 95, 40], ['beam', -95, -30], ['minigun', 30, 0], ['shotgun', -30, -45], ['flame', 55, -45], ['needler', -60, 45],
    ],
  });
  return world;
}

// ------------------------------------------------------------------ Cube

export const CUBE = { hx: 86, hz: 62, h: 46, r: 17 }; // half length, half width, height, edge radius

/** Rounded-box shape of the cube's inside: signed distance (negative inside) and outward normal. */
export function cubeSurface() {
  const { hx, hz, h, r } = CUBE, cy = h / 2;
  const ex = hx - r, ey = cy - r, ez = hz - r;
  return {
    sdf(p) {
      const qx = Math.abs(p.x) - ex, qy = Math.abs(p.y - cy) - ey, qz = Math.abs(p.z) - ez;
      const out = Math.hypot(Math.max(qx, 0), Math.max(qy, 0), Math.max(qz, 0));
      return out + Math.min(Math.max(qx, qy, qz), 0) - r;
    },
    normal(p, n) {
      const qx = Math.abs(p.x) - ex, qy = Math.abs(p.y - cy) - ey, qz = Math.abs(p.z) - ez;
      if (qx > 0 || qy > 0 || qz > 0) {
        n.set(Math.sign(p.x) * Math.max(qx, 0), Math.sign(p.y - cy) * Math.max(qy, 0), Math.sign(p.z) * Math.max(qz, 0));
      } else if (qx >= qy && qx >= qz) n.set(Math.sign(p.x), 0, 0);
      else if (qy >= qz) n.set(0, Math.sign(p.y - cy), 0);
      else n.set(0, 0, Math.sign(p.z));
      return n.normalize();
    },
  };
}

export function buildCube(scene, { destructible = false } = {}) {
  const { hx, hz, h, r } = CUBE;
  const world = baseWorld('cube', hx + 4, destructible);
  world.surface = cubeSurface();
  addLights(scene, { sky: '#0e1630', fog: [260, 700], shadow: 110 });

  // The shell: turf where you drive, glowing panels up the walls, glass up top
  const geo = new RoundedBoxGeometry(hx * 2, h, hz * 2, 10, r);
  const pos = geo.attributes.position, colors = new Float32Array(pos.count * 4);
  const turf = new THREE.Color('#2f7d3a'), panel = new THREE.Color('#1e3a8a'), orange = new THREE.Color('#f97316'), blue = new THREE.Color('#2563eb'), c = new THREE.Color();
  for (let k = 0; k < pos.count; k++) {
    const x = pos.getX(k), y = pos.getY(k) + h / 2, z = pos.getZ(k);
    let a = 1;
    if (y < 0.5) c.copy(turf);
    else {
      // Team colours at each end, fading to see-through glass over the top
      c.copy(panel).lerp(x > 0 ? orange : blue, clamp01((Math.abs(x) - hx * 0.55) / (hx * 0.45)) * 0.7);
      a = y > h - 1 ? 0.18 : 0.55 - 0.35 * clamp01((y - r) / (h - r));
    }
    colors.set([c.r, c.g, c.b, a], k * 4);
  }
  geo.setAttribute('color', new THREE.Float32BufferAttribute(colors, 4));
  const shell = new THREE.Mesh(geo, new THREE.MeshLambertMaterial({ vertexColors: true, transparent: true, side: THREE.BackSide, depthWrite: false }));
  shell.position.y = h / 2;
  scene.add(shell);
  // Hexagon grid glowing on the walls and ceiling
  const hexTex = canvasTex(256, (g, s) => {
    g.clearRect(0, 0, s, s);
    g.strokeStyle = 'rgba(125,249,255,0.55)';
    g.lineWidth = 3;
    const R = s / 8;
    for (let row = -1; row < 9; row++) for (let col = -1; col < 6; col++) {
      const cx = col * R * 3 + (row % 2 ? R * 1.5 : 0), cy = row * R * 0.866;
      g.beginPath();
      for (let i = 0; i <= 6; i++) g.lineTo(cx + R * Math.cos((i * Math.PI) / 3), cy + R * Math.sin((i * Math.PI) / 3));
      g.stroke();
    }
  }, 1);
  hexTex.repeat.set(10, 4);
  const hex = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ map: hexTex, transparent: true, side: THREE.BackSide, depthWrite: false, blending: THREE.AdditiveBlending, opacity: 0.45 }));
  hex.position.y = h / 2 - 0.05;
  hex.scale.setScalar(0.999);
  scene.add(hex);

  // Pitch markings on the flat part of the floor
  const pitch = canvasTex(1024, (g, s) => {
    g.fillStyle = '#2f7d3a';
    g.fillRect(0, 0, s, s);
    for (let i = 0; i < 16; i++) {
      g.fillStyle = i % 2 ? 'rgba(255,255,255,0.04)' : 'rgba(0,0,0,0.05)';
      g.fillRect((i * s) / 16, 0, s / 16, s);
    }
    g.strokeStyle = 'rgba(255,255,255,0.75)';
    g.lineWidth = 8;
    g.strokeRect(12, 12, s - 24, s - 24);
    g.beginPath();
    g.moveTo(s / 2, 12);
    g.lineTo(s / 2, s - 12);
    g.stroke();
    g.beginPath();
    g.arc(s / 2, s / 2, s * 0.13, 0, Math.PI * 2);
    g.stroke();
    for (const [x, col] of [[12, '#2563eb'], [s - 12, '#f97316']]) {
      g.strokeStyle = col;
      g.strokeRect(x - (x < s / 2 ? 0 : s * 0.14), s * 0.3, s * 0.14, s * 0.4);
    }
  });
  const floor = new THREE.Mesh(new THREE.PlaneGeometry((hx - r) * 2, (hz - r) * 2), new THREE.MeshLambertMaterial({ map: pitch }));
  floor.rotation.x = -Math.PI / 2;
  floor.position.y = 0.03;
  floor.receiveShadow = true;
  scene.add(floor);

  // Goal frames painted on each end wall
  for (const s of [-1, 1]) {
    const col = s > 0 ? '#f97316' : '#2563eb';
    const g = new THREE.Group();
    const m = new THREE.MeshBasicMaterial({ color: col });
    const post = new THREE.BoxGeometry(1.2, 14, 1.2);
    for (const z of [-18, 18]) {
      const p = new THREE.Mesh(post, m);
      p.position.set(0, 7 + r * 0.2, z);
      g.add(p);
    }
    const bar = new THREE.Mesh(new THREE.BoxGeometry(1.2, 1.2, 37), m);
    bar.position.set(0, 14 + r * 0.2, 0);
    g.add(bar);
    const net = new THREE.Mesh(new THREE.PlaneGeometry(36, 14), new THREE.MeshBasicMaterial({ color: col, transparent: true, opacity: 0.25, side: THREE.DoubleSide }));
    net.rotation.y = Math.PI / 2;
    net.position.set(0.5 * s, 7 + r * 0.2, 0);
    g.add(net);
    g.position.set(s * (hx - 0.8), 0, 0);
    scene.add(g);
  }

  // Stadium outside the glass: stands, lights and a city glow
  const standMat = new THREE.MeshLambertMaterial({ color: '#1f2937' });
  const crowdMat = new THREE.MeshBasicMaterial({ color: '#374151' });
  for (let i = 0; i < 4; i++) {
    const along = i % 2 === 0, len = along ? hx * 2 + 60 : hz * 2 + 60;
    const off = along ? hz + 40 : hx + 40, sgn = i < 2 ? 1 : -1;
    for (let k = 0; k < 5; k++) {
      const tier = new THREE.Mesh(new THREE.BoxGeometry(along ? len : 8, 6, along ? 8 : len), k % 2 ? crowdMat : standMat);
      const o = off + k * 8;
      tier.position.set(along ? 0 : sgn * o, 3 + k * 6, along ? sgn * o : 0);
      scene.add(tier);
    }
  }
  const lampMat = new THREE.MeshBasicMaterial({ color: '#fff7d6' });
  for (const [x, z] of [[1, 1], [-1, 1], [1, -1], [-1, -1]]) {
    const pole = new THREE.Mesh(new THREE.CylinderGeometry(1, 1.4, 90, 8), standMat);
    pole.position.set(x * (hx + 80), 45, z * (hz + 80));
    scene.add(pole);
    const lamp = new THREE.Mesh(new THREE.BoxGeometry(14, 8, 3), lampMat);
    lamp.position.set(x * (hx + 80), 92, z * (hz + 80));
    lamp.lookAt(0, 0, 0);
    scene.add(lamp);
  }
  const glow = new THREE.Mesh(new THREE.PlaneGeometry(1400, 1400), new THREE.MeshBasicMaterial({ color: '#141c3a' }));
  glow.rotation.x = -Math.PI / 2;
  glow.position.y = -0.2;
  scene.add(glow);
  scene.add(new THREE.AmbientLight('#8fa6ff', 0.6));

  // Pads in the middle of each half and near the corners of the pitch
  addPads(scene, world, [[-40, 0], [40, 0], [0, 32], [0, -32]]);

  world.blocked = (x, y, z) => world.surface.sdf({ x, y, z }) > -0.05;
  world.bound = () => 0; // the kart's surface physics keeps it inside
  world.randomPoint = () => ({ x: (Math.random() * 2 - 1) * (hx - r - 8), z: (Math.random() * 2 - 1) * (hz - r - 8) });
  world.outline = [[[-hx, -hz], [hx, -hz], [hx, hz], [-hx, hz], [-hx, -hz]], [[-hx + r, -hz + r], [hx - r, -hz + r], [hx - r, hz - r], [-hx + r, hz - r], [-hx + r, -hz + r]]];

  for (const [x, z] of [[-65, -40], [-65, 40], [65, -40], [65, 40], [-30, 0], [30, 0], [0, -45], [0, 45]]) world.spawns.push({ x, z, yaw: Math.atan2(-x, -z) });
  addItems(world, {
    rocket: [[-55, 0], [55, 0]],
    health: [[0, 0], [-60, -30], [60, 30]],
    boost: [[-45, -40], [45, 40], [-45, 40], [45, -40]],
    akimbo: [[0, -20], [0, 20]],
    weapon: [
      ['hail', -20, 20], ['bubble', 20, -20], ['grenade', -20, -20], ['electro', 20, 20], ['sniper', -62, 0],
      ['beam', 62, 0], ['minigun', 0, 40], ['shotgun', 0, -40], ['flame', -35, 30], ['needler', 35, -30],
    ],
  });
  return world;
}
