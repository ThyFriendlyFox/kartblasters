import * as THREE from 'three';

/**
 * "Stadium" look: a warm sunset sky (also used as the environment map, so
 * paint and metal pick up the sunset), a low golden sun, a mown stadium
 * pitch with grandstands, floodlight towers and flags, and, for sphere
 * courses, the steel lattice ball the road hangs inside.
 */

const SUN_DIR = new THREE.Vector3(0.62, 0.16, -0.77).normalize();

function canvas(w, h, draw) {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  draw(c.getContext('2d'), w, h);
  return c;
}

let skyTex = null;
/** Equirectangular sunset sky with the sun baked in. */
export function sunsetSky() {
  if (skyTex) return skyTex;
  const c = canvas(2048, 1024, (g, w, h) => {
    const grad = g.createLinearGradient(0, 0, 0, h);
    grad.addColorStop(0, '#2d5b9a');
    grad.addColorStop(0.28, '#6f94c4');
    grad.addColorStop(0.44, '#f2b98a');
    grad.addColorStop(0.5, '#ffd6a1');
    grad.addColorStop(0.53, '#c98c73');
    grad.addColorStop(1, '#3b3446');
    g.fillStyle = grad;
    g.fillRect(0, 0, w, h);
    // Sun position in the equirect map
    const az = Math.atan2(SUN_DIR.x, -SUN_DIR.z);
    const sx = ((az / (Math.PI * 2) + 0.5) % 1) * w;
    const sy = (0.5 - Math.asin(SUN_DIR.y) / Math.PI) * h;
    for (const [r, a, col] of [[520, 0.35, '255,170,90'], [260, 0.55, '255,205,140'], [90, 0.9, '255,236,200'], [34, 1, '255,252,240']]) {
      const glow = g.createRadialGradient(sx, sy, 0, sx, sy, r);
      glow.addColorStop(0, `rgba(${col},${a})`);
      glow.addColorStop(1, `rgba(${col},0)`);
      g.fillStyle = glow;
      g.fillRect(0, 0, w, h);
    }
    // Soft streaky clouds lit from the sun side
    let seed = 7;
    const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
    for (let i = 0; i < 90; i++) {
      const x = rnd() * w, y = h * (0.18 + rnd() * 0.3), rw = 80 + rnd() * 260, rh = 6 + rnd() * 16;
      const near = Math.max(0, 1 - Math.abs(x - sx) / (w * 0.35));
      g.fillStyle = `rgba(${255},${Math.round(200 + 40 * near)},${Math.round(190 + 30 * near)},${0.12 + 0.25 * rnd()})`;
      g.beginPath();
      g.ellipse(x, y, rw, rh, 0, 0, Math.PI * 2);
      g.fill();
    }
  });
  skyTex = new THREE.CanvasTexture(c);
  skyTex.mapping = THREE.EquirectangularReflectionMapping;
  skyTex.colorSpace = THREE.SRGBColorSpace;
  return skyTex;
}

function tex(c, repeat = 1) {
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(repeat, repeat);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 8;
  return t;
}

/** Concrete stadium road: light grey, fine grain, darker tyre lanes, slab joints. */
export function stadiumRoadTexture() {
  return tex(
    canvas(256, 512, (g, w, h) => {
      g.fillStyle = '#a7acb3';
      g.fillRect(0, 0, w, h);
      const img = g.getImageData(0, 0, w, h);
      for (let i = 0; i < img.data.length; i += 4) {
        const v = (Math.random() - 0.5) * 26;
        img.data[i] += v;
        img.data[i + 1] += v;
        img.data[i + 2] += v;
      }
      g.putImageData(img, 0, 0);
      // Tyre-worn lanes
      for (const x of [0.3, 0.7]) {
        const lane = g.createLinearGradient(w * (x - 0.12), 0, w * (x + 0.12), 0);
        lane.addColorStop(0, 'rgba(40,42,48,0)');
        lane.addColorStop(0.5, 'rgba(40,42,48,0.22)');
        lane.addColorStop(1, 'rgba(40,42,48,0)');
        g.fillStyle = lane;
        g.fillRect(0, 0, w, h);
      }
      // Slab joints
      g.fillStyle = 'rgba(30,32,38,0.45)';
      g.fillRect(0, 0, w, 2);
      g.fillRect(0, h / 2, w, 2);
      g.fillRect(w / 2 - 1, 0, 2, h);
      // Painted edge lines
      g.fillStyle = 'rgba(245,247,250,0.85)';
      g.fillRect(10, 0, 5, h);
      g.fillRect(w - 15, 0, 5, h);
    }),
  );
}

function grassTexture() {
  return tex(
    canvas(512, 512, (g, w, h) => {
      for (let i = 0; i < 8; i++) {
        g.fillStyle = i % 2 ? '#4f8a3a' : '#5a9842';
        g.fillRect(0, (i * h) / 8, w, h / 8);
      }
      const img = g.getImageData(0, 0, w, h);
      for (let i = 0; i < img.data.length; i += 4) {
        const v = (Math.random() - 0.5) * 16;
        img.data[i] += v;
        img.data[i + 1] += v;
      }
      g.putImageData(img, 0, 0);
    }),
    40,
  );
}

function seatsTexture() {
  return tex(
    canvas(128, 128, (g, w, h) => {
      g.fillStyle = '#2b3140';
      g.fillRect(0, 0, w, h);
      const cols = ['#e63946', '#f1faee', '#457b9d', '#ffb703'];
      for (let y = 0; y < h; y += 8) {
        for (let x = 0; x < w; x += 6) {
          g.fillStyle = Math.random() < 0.6 ? cols[Math.floor(Math.random() * cols.length)] : '#3a4152';
          g.fillRect(x + 1, y + 2, 4, 4);
        }
      }
    }),
  );
}

export function buildStadium(scene, track) {
  const sky = sunsetSky();
  scene.background = sky;
  scene.environment = sky;
  scene.backgroundIntensity = 1;
  scene.environmentIntensity = 0.55;
  scene.fog = new THREE.Fog('#f0bf94', 1400, 4200);

  scene.add(new THREE.HemisphereLight('#ffd9b8', '#46505e', 1.1));
  const sun = new THREE.DirectionalLight('#ffc48a', 3.2);
  const c = track.sphere?.center || new THREE.Vector3();
  sun.position.copy(c).addScaledVector(SUN_DIR, 400);
  sun.target.position.copy(c);
  sun.castShadow = true;
  sun.shadow.mapSize.setScalar(document.body.classList.contains('touch') ? 1024 : 2048);
  const sc = sun.shadow.camera;
  sc.left = sc.bottom = -300;
  sc.right = sc.top = 300;
  sc.near = 10;
  sc.far = 1400;
  sun.shadow.bias = -0.0006;
  scene.add(sun, sun.target);
  track.sun = sun;
  track.sunDir = SUN_DIR.clone();

  // Pitch
  const ground = new THREE.Mesh(new THREE.CircleGeometry(1800, 64), new THREE.MeshStandardMaterial({ map: grassTexture(), roughness: 0.95 }));
  ground.rotation.x = -Math.PI / 2;
  ground.position.set(c.x, 0, c.z);
  ground.receiveShadow = true;
  scene.add(ground);
  const apron = new THREE.Mesh(new THREE.RingGeometry(470, 560, 96), new THREE.MeshStandardMaterial({ color: '#8d939c', roughness: 0.85 }));
  apron.rotation.x = -Math.PI / 2;
  apron.position.set(c.x, 0.05, c.z);
  apron.receiveShadow = true;
  scene.add(apron);

  // Grandstands: a ring of raked seating blocks with roofs
  const standMat = new THREE.MeshStandardMaterial({ map: seatsTexture(), roughness: 0.8 });
  const concrete = new THREE.MeshStandardMaterial({ color: '#b6bcc5', roughness: 0.8 });
  const roofMat = new THREE.MeshStandardMaterial({ color: '#e9edf2', metalness: 0.4, roughness: 0.4 });
  const blocks = 20;
  for (let i = 0; i < blocks; i++) {
    const a = (i / blocks) * Math.PI * 2;
    if (Math.abs(Math.atan2(Math.sin(a - Math.atan2(SUN_DIR.z, SUN_DIR.x)), Math.cos(a - Math.atan2(SUN_DIR.z, SUN_DIR.x)))) < 0.35) continue; // leave the sunset open
    const g = new THREE.Group();
    const w = (2 * Math.PI * 600) / blocks - 8;
    for (let k = 0; k < 5; k++) {
      const tier = new THREE.Mesh(new THREE.BoxGeometry(w, 12, 22), k % 2 ? standMat : standMat);
      tier.position.set(0, 6 + k * 12, k * 18);
      tier.castShadow = tier.receiveShadow = true;
      g.add(tier);
    }
    const back = new THREE.Mesh(new THREE.BoxGeometry(w, 80, 8), concrete);
    back.position.set(0, 40, 5 * 18 + 6);
    g.add(back);
    const roof = new THREE.Mesh(new THREE.BoxGeometry(w + 4, 3, 70), roofMat);
    roof.position.set(0, 88, 55);
    roof.rotation.x = -0.12;
    g.add(roof);
    g.position.set(c.x + Math.cos(a) * 600, 0, c.z + Math.sin(a) * 600);
    g.lookAt(c.x + Math.cos(a) * 2000, 0, c.z + Math.sin(a) * 2000);
    scene.add(g);
  }

  // Floodlight towers with glowing lamp banks
  const pole = new THREE.MeshStandardMaterial({ color: '#c9ced6', metalness: 0.6, roughness: 0.35 });
  const lamp = new THREE.MeshBasicMaterial({ color: new THREE.Color('#fff4dc').multiplyScalar(3), toneMapped: false });
  const lampTex = tex(
    canvas(64, 64, (g, w, h) => {
      g.fillStyle = '#20242b';
      g.fillRect(0, 0, w, h);
      g.fillStyle = '#ffffff';
      for (let y = 4; y < h; y += 15) for (let x = 4; x < w; x += 15) g.fillRect(x, y, 11, 11);
    }),
  );
  const lampMat = new THREE.MeshBasicMaterial({ map: lampTex, color: new THREE.Color('#fff2d6').multiplyScalar(2.6), toneMapped: false });
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * Math.PI * 2 + 0.2;
    const x = c.x + Math.cos(a) * 520, z = c.z + Math.sin(a) * 520, H = 300;
    const m = new THREE.Mesh(new THREE.CylinderGeometry(2.2, 4, H, 10), pole);
    m.position.set(x, H / 2, z);
    m.castShadow = true;
    scene.add(m);
    const head = new THREE.Group();
    const panel = new THREE.Mesh(new THREE.BoxGeometry(34, 22, 3), new THREE.MeshStandardMaterial({ color: '#2a2f38', metalness: 0.5 }));
    head.add(panel);
    const face = new THREE.Mesh(new THREE.PlaneGeometry(31, 19), lampMat);
    face.position.z = 1.6;
    head.add(face);
    head.position.set(x, H + 8, z);
    head.lookAt(c.x, H * 0.3, c.z);
    scene.add(head);
    // A soft halo so the lamps read from far away
    const halo = new THREE.Sprite(new THREE.SpriteMaterial({ map: haloTexture(), color: '#fff0d0', transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, opacity: 0.55 }));
    halo.scale.set(110, 110, 1);
    halo.position.copy(head.position);
    scene.add(halo);
    void lamp;
  }

  // Flags around the stand tops
  const flagCols = ['#e63946', '#f1faee', '#1d4ed8', '#ffb703', '#10b981'];
  for (let i = 0; i < 28; i++) {
    const a = (i / 28) * Math.PI * 2;
    const x = c.x + Math.cos(a) * 690, z = c.z + Math.sin(a) * 690;
    const p = new THREE.Mesh(new THREE.CylinderGeometry(0.4, 0.5, 40, 6), pole);
    p.position.set(x, 110, z);
    scene.add(p);
    const f = new THREE.Mesh(new THREE.PlaneGeometry(14, 8, 6, 1), new THREE.MeshStandardMaterial({ color: flagCols[i % flagCols.length], side: THREE.DoubleSide, roughness: 0.7 }));
    const pos = f.geometry.attributes.position;
    for (let k = 0; k < pos.count; k++) pos.setZ(k, Math.sin(pos.getX(k) * 0.5 + i) * 0.8);
    f.geometry.computeVertexNormals();
    f.position.set(x + 7 * Math.cos(a + 1.2), 125, z + 7 * Math.sin(a + 1.2));
    f.rotation.y = -(a + 1.2);
    scene.add(f);
  }

  if (track.sphere) buildSphereFrame(scene, track);
}

let halo = null;
function haloTexture() {
  if (halo) return halo;
  halo = new THREE.CanvasTexture(
    canvas(128, 128, (g, w, h) => {
      const r = g.createRadialGradient(w / 2, h / 2, 0, w / 2, h / 2, w / 2);
      r.addColorStop(0, 'rgba(255,255,255,1)');
      r.addColorStop(0.2, 'rgba(255,240,210,0.5)');
      r.addColorStop(1, 'rgba(255,220,180,0)');
      g.fillStyle = r;
      g.fillRect(0, 0, w, h);
    }),
  );
  return halo;
}

/** Geodesic steel lattice around the course, brackets holding the road to it, and legs to the ground. */
function buildSphereFrame(scene, track) {
  const { center, radius } = track.sphere;
  const R = radius + 26;
  const steel = new THREE.MeshStandardMaterial({ color: '#9aa3b0', metalness: 0.8, roughness: 0.3 });
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
  im.castShadow = true;
  scene.add(im);
  // Glowing equator ring
  const ring = new THREE.Mesh(new THREE.TorusGeometry(R, 1.4, 8, 160), new THREE.MeshBasicMaterial({ color: new THREE.Color('#ff8a1e').multiplyScalar(2.2), toneMapped: false }));
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
  bim.castShadow = true;
  scene.add(bim);

  // Four legs down to the pitch
  for (let i = 0; i < 4; i++) {
    const ang = (i / 4) * Math.PI * 2 + Math.PI / 4;
    const top = center.clone().add(new THREE.Vector3(Math.cos(ang) * R * 0.72, -R * 0.69, Math.sin(ang) * R * 0.72));
    const foot = new THREE.Vector3(center.x + Math.cos(ang) * R * 1.05, 0, center.z + Math.sin(ang) * R * 1.05);
    dir.subVectors(top, foot);
    const len = dir.length();
    const leg = new THREE.Mesh(new THREE.CylinderGeometry(5, 8, len, 10), steel);
    leg.position.copy(foot).add(top).multiplyScalar(0.5);
    leg.quaternion.setFromUnitVectors(up, dir.normalize());
    leg.castShadow = true;
    scene.add(leg);
  }
}
