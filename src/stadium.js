import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

/**
 * "Stadium" look, cartoon style: a bright blue sky with puffy clouds, flat
 * toon shading, a striped pitch ringed by candy-coloured grandstands, flags
 * and floodlights, and, for sphere courses, the lattice ball the road hangs
 * inside. Everything static is merged into a few meshes to keep it fast.
 */

// Matches the offset Track.followShadow keeps the sun at
const SUN_DIR = new THREE.Vector3(120, 220, 80).normalize();

function canvas(w, h, draw) {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  draw(c.getContext('2d'), w, h);
  return c;
}

function tex(c, repeat = 1) {
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(repeat, repeat);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 8;
  return t;
}

/** Flat cartoon shading: three hard light bands. */
let toonRamp = null;
export function toon(color, o = {}) {
  if (!toonRamp) {
    toonRamp = new THREE.DataTexture(new Uint8Array([110, 110, 110, 255, 185, 185, 185, 255, 255, 255, 255, 255]), 3, 1);
    toonRamp.minFilter = toonRamp.magFilter = THREE.NearestFilter;
    toonRamp.needsUpdate = true;
  }
  return new THREE.MeshToonMaterial({ color, gradientMap: toonRamp, ...o });
}

/** Bright cartoon sky: a clean blue gradient, a warm horizon and puffy clouds. */
function cartoonSky() {
  const c = canvas(1024, 512, (g, w, h) => {
    const grad = g.createLinearGradient(0, 0, 0, h);
    grad.addColorStop(0, '#1f7cff');
    grad.addColorStop(0.3, '#52a8ff');
    grad.addColorStop(0.46, '#aee0ff');
    grad.addColorStop(0.5, '#ffe7b8');
    grad.addColorStop(0.52, '#8fd06a');
    grad.addColorStop(1, '#4e9a3a');
    g.fillStyle = grad;
    g.fillRect(0, 0, w, h);
    const az = Math.atan2(SUN_DIR.x, -SUN_DIR.z);
    const sx = ((az / (Math.PI * 2) + 0.5) % 1) * w;
    const sy = (0.5 - Math.asin(SUN_DIR.y) / Math.PI) * h;
    g.fillStyle = 'rgba(255,240,170,0.35)';
    g.beginPath();
    g.arc(sx, sy, 34, 0, Math.PI * 2);
    g.fill();
    g.fillStyle = '#fff6c9';
    g.beginPath();
    g.arc(sx, sy, 20, 0, Math.PI * 2);
    g.fill();
    // Puffy clouds: clusters of circles with a flat shadow underneath
    let seed = 11;
    const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
    for (let i = 0; i < 16; i++) {
      const x = rnd() * w, y = h * (0.14 + rnd() * 0.24), sc = 0.6 + rnd() * 0.9;
      for (const [fill, dy] of [['#cfe3f7', 4], ['#ffffff', 0]]) {
        g.fillStyle = fill;
        for (let k = 0; k < 6; k++) {
          g.beginPath();
          g.arc(x + (k - 2.5) * 13 * sc, y + dy - Math.sin((k / 5) * Math.PI) * 9 * sc, (10 + Math.sin(k * 2.1) * 3) * sc, 0, Math.PI * 2);
          g.fill();
        }
      }
    }
  });
  const t = new THREE.CanvasTexture(c);
  t.mapping = THREE.EquirectangularReflectionMapping;
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

/** Merge a list of [geometry, color] into one vertex-coloured geometry. */
function merged(parts) {
  const geos = parts.map(([g, color]) => {
    const ng = g.index ? g.toNonIndexed() : g;
    const c = new THREE.Color(color), n = ng.attributes.position.count;
    const cols = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) cols.set([c.r, c.g, c.b], i * 3);
    ng.setAttribute('color', new THREE.BufferAttribute(cols, 3));
    for (const k of Object.keys(ng.attributes)) if (!['position', 'normal', 'color'].includes(k)) ng.deleteAttribute(k);
    return ng;
  });
  return mergeGeometries(geos);
}
const placed = (g, pos, quat) => g.applyMatrix4(new THREE.Matrix4().compose(pos, quat || new THREE.Quaternion(), new THREE.Vector3(1, 1, 1)));

export function buildStadium(scene, track) {
  scene.background = cartoonSky();
  scene.environment = null;
  scene.fog = new THREE.Fog('#bfe3ff', 1500, 4200);

  scene.add(new THREE.HemisphereLight('#ffffff', '#8aa0bf', 1.7));
  const sun = new THREE.DirectionalLight('#fff3dc', 1.7);
  const c = track.sphere?.center || new THREE.Vector3();
  sun.position.copy(c).addScaledVector(SUN_DIR, 400);
  sun.target.position.copy(c);
  // Only the cars cast shadows; the box follows the player (followShadow)
  sun.castShadow = true;
  sun.shadow.mapSize.setScalar(1024);
  const sc = sun.shadow.camera;
  sc.left = sc.bottom = -70;
  sc.right = sc.top = 70;
  sc.near = 10;
  sc.far = 600;
  sun.shadow.bias = -0.001;
  scene.add(sun, sun.target);
  track.sun = sun;
  track.sunDir = SUN_DIR.clone();

  const up = new THREE.Vector3(0, 1, 0);
  const yaw = (a) => new THREE.Quaternion().setFromAxisAngle(up, a);

  // Pitch: bold mown stripes and a sandy running track round it
  const grass = tex(
    canvas(64, 64, (g, w, h) => {
      g.fillStyle = '#5cc44a';
      g.fillRect(0, 0, w, h);
      g.fillStyle = '#4fb33f';
      g.fillRect(0, 0, w, h / 2);
    }),
    60,
  );
  const ground = new THREE.Mesh(new THREE.CircleGeometry(1800, 48), new THREE.MeshLambertMaterial({ map: grass }));
  ground.rotation.x = -Math.PI / 2;
  ground.position.set(c.x, 0, c.z);
  ground.receiveShadow = true;
  scene.add(ground);
  const apron = new THREE.Mesh(new THREE.RingGeometry(470, 560, 72), new THREE.MeshLambertMaterial({ color: '#ff9f59' }));
  apron.rotation.x = -Math.PI / 2;
  apron.position.set(c.x, 0.05, c.z);
  scene.add(apron);

  // Grandstands, flags and floodlights: one merged mesh
  const parts = [];
  const tiers = ['#ff4d6d', '#ffd23f', '#3bceac', '#4d96ff', '#ff8fab'];
  const blocks = 18;
  const sunA = Math.atan2(SUN_DIR.z, SUN_DIR.x);
  for (let i = 0; i < blocks; i++) {
    const a = (i / blocks) * Math.PI * 2;
    if (Math.abs(Math.atan2(Math.sin(a - sunA), Math.cos(a - sunA))) < 0.4) continue; // leave the sun side open
    const q = yaw(-a - Math.PI / 2);
    const w = (2 * Math.PI * 600) / blocks - 10;
    const at = (r, y) => new THREE.Vector3(c.x + Math.cos(a) * r, y, c.z + Math.sin(a) * r);
    for (let k = 0; k < 5; k++) parts.push([placed(new THREE.BoxGeometry(w, 12, 20), at(600 + k * 18, 6 + k * 12), q), tiers[(i + k) % tiers.length]]);
    parts.push([placed(new THREE.BoxGeometry(w, 84, 8), at(600 + 5 * 18 + 6, 42), q), '#f4f1ea']);
    parts.push([placed(new THREE.BoxGeometry(w + 4, 4, 60), at(600 + 60, 90), q), i % 2 ? '#ff4d6d' : '#ffffff']);
  }
  const flagCols = ['#ff4d6d', '#ffd23f', '#3bceac', '#4d96ff', '#ffffff'];
  for (let i = 0; i < 24; i++) {
    const a = (i / 24) * Math.PI * 2;
    const x = c.x + Math.cos(a) * 700, z = c.z + Math.sin(a) * 700;
    parts.push([placed(new THREE.CylinderGeometry(0.6, 0.6, 40, 5), new THREE.Vector3(x, 112, z)), '#f4f1ea']);
    const f = new THREE.BoxGeometry(16, 9, 0.4);
    parts.push([placed(f, new THREE.Vector3(x + 8 * Math.cos(a + 1.2), 126, z + 8 * Math.sin(a + 1.2)), yaw(-(a + 1.2))), flagCols[i % flagCols.length]]);
  }
  const heads = [];
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * Math.PI * 2 + 0.3;
    const x = c.x + Math.cos(a) * 520, z = c.z + Math.sin(a) * 520, H = 280;
    parts.push([placed(new THREE.CylinderGeometry(3, 5, H, 8), new THREE.Vector3(x, H / 2, z)), '#f4f1ea']);
    const q = new THREE.Quaternion().setFromRotationMatrix(new THREE.Matrix4().lookAt(new THREE.Vector3(x, H + 8, z), new THREE.Vector3(c.x, H * 0.3, c.z), up));
    parts.push([placed(new THREE.BoxGeometry(36, 24, 4), new THREE.Vector3(x, H + 8, z), q), '#3d4a66']);
    heads.push([placed(new THREE.PlaneGeometry(32, 20), new THREE.Vector3(x, H + 8, z).addScaledVector(new THREE.Vector3(0, 0, -1).applyQuaternion(q), 2.2), q.clone().multiply(yaw(Math.PI))), '#fff6c9']);
  }
  scene.add(new THREE.Mesh(merged(parts), toon('#ffffff', { vertexColors: true })));
  scene.add(new THREE.Mesh(merged(heads), new THREE.MeshBasicMaterial({ vertexColors: true })));

  if (track.sphere) buildSphereFrame(scene, track);
}

/** Geodesic steel lattice around the course, brackets holding the road to it, and legs to the ground. */
function buildSphereFrame(scene, track) {
  const { center, radius } = track.sphere;
  const R = radius + 26;
  const steel = toon('#ffffff');
  const ico = new THREE.IcosahedronGeometry(R, 2);
  const pos = ico.attributes.position;
  const edges = new Map();
  const key = (v) => `${v.x.toFixed(1)},${v.y.toFixed(1)},${v.z.toFixed(1)}`;
  const a = new THREE.Vector3(), b = new THREE.Vector3();
  for (let i = 0; i < pos.count; i += 3) {
    for (const [p, q] of [[i, i + 1], [i + 1, i + 2], [i + 2, i]]) {
      a.fromBufferAttribute(pos, p);
      b.fromBufferAttribute(pos, q);
      const k1 = key(a), k2 = key(b), k = k1 < k2 ? k1 + '|' + k2 : k2 + '|' + k1;
      if (!edges.has(k)) edges.set(k, [a.clone(), b.clone()]);
    }
  }
  const beam = new THREE.CylinderGeometry(1, 1, 1, 6);
  const im = new THREE.InstancedMesh(beam, steel, edges.size);
  const m = new THREE.Matrix4(), q = new THREE.Quaternion(), s = new THREE.Vector3(), up = new THREE.Vector3(0, 1, 0), dir = new THREE.Vector3();
  let k = 0;
  for (const [p0, p1] of edges.values()) {
    dir.subVectors(p1, p0);
    const len = dir.length();
    q.setFromUnitVectors(up, dir.normalize());
    m.compose(p0.clone().add(p1).multiplyScalar(0.5).add(center), q, s.set(0.55, len, 0.55));
    im.setMatrixAt(k++, m);
  }
  scene.add(im);
  // Glowing equator ring
  const ring = new THREE.Mesh(new THREE.TorusGeometry(R, 1.4, 8, 160), new THREE.MeshBasicMaterial({ color: '#ff8a1e' }));
  ring.rotation.x = Math.PI / 2;
  ring.position.copy(center);
  scene.add(ring);

  // Brackets from the underside of the road out to the lattice
  const br = [];
  const P = new THREE.Vector3(), N = new THREE.Vector3();
  for (let i = 0; i < track.n; i += Math.round(40 / track.ds)) {
    if (track.gap[i]) continue;
    P.fromArray(track.P, i * 3);
    N.fromArray(track.N, i * 3);
    const out = P.clone().sub(center);
    const rr = out.length();
    if (rr < radius - 30 || rr > R - 4) continue; // inside a loop: no bracket
    const from = P.clone().addScaledVector(N, -0.8);
    const to = center.clone().addScaledVector(out.normalize(), R);
    br.push([from, to]);
  }
  const bim = new THREE.InstancedMesh(beam, steel, br.length);
  br.forEach(([p0, p1], i) => {
    dir.subVectors(p1, p0);
    const len = dir.length();
    q.setFromUnitVectors(up, dir.normalize());
    m.compose(p0.clone().add(p1).multiplyScalar(0.5), q, s.set(0.4, len, 0.4));
    bim.setMatrixAt(i, m);
  });
  scene.add(bim);

  // Four legs down to the pitch
  const legs = [];
  for (let i = 0; i < 4; i++) {
    const ang = (i / 4) * Math.PI * 2 + Math.PI / 4;
    const top = center.clone().add(new THREE.Vector3(Math.cos(ang) * R * 0.72, -R * 0.69, Math.sin(ang) * R * 0.72));
    const foot = new THREE.Vector3(center.x + Math.cos(ang) * R * 1.05, 0, center.z + Math.sin(ang) * R * 1.05);
    dir.subVectors(top, foot);
    const len = dir.length();
    legs.push([placed(new THREE.CylinderGeometry(5, 8, len, 10), foot.clone().add(top).multiplyScalar(0.5), new THREE.Quaternion().setFromUnitVectors(up, dir.normalize())), '#ff4d6d']);
  }
  scene.add(new THREE.Mesh(merged(legs), toon('#ffffff', { vertexColors: true })));
}
