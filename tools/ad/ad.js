/**
 * Kart Blasters promo ad renderer.
 *
 * Renders a beat-synced motion-design ad from the real game: actual tracks,
 * cars and arena built with the game's own code, driven by scripted cameras
 * and car paths, with kinetic typography and transitions drawn on top.
 * Rendering is fully deterministic: window.AD.frame(i) draws frame i.
 * window.AD.audio() renders the soundtrack (the game's own music engine
 * plus whooshes and hits on the cuts) as a WAV.
 *
 * Driven by tools/ad/render.mjs, which saves the frames and encodes the video.
 */
import * as THREE from 'three';
import { Track, Path } from '../../src/track.js';
import { buildCar, CARS, CAR_IDS } from '../../src/cars.js';
import { buildArena } from '../../src/arena.js';
import { Music } from '../../src/music.js';

const params = new URLSearchParams(location.search);
const W = +(params.get('w') || 1280), H = +(params.get('h') || 720);
const FPS = +(params.get('fps') || 30);
const BPM = 110, BEAT = 60 / BPM, BAR = 4 * BEAT;

// Shot list, in bars (cuts land on downbeats of the music)
const SHOTS = [
  { id: 'intro', bars: 1 },
  { id: 'chase', bars: 2 },
  { id: 'tower', bars: 2 },
  { id: 'summit', bars: 2 },
  { id: 'loop', bars: 2 },
  { id: 'roster', bars: 2 },
  { id: 'battle', bars: 2 },
  { id: 'end', bars: 2.5 },
];
let acc = 0;
for (const s of SHOTS) {
  s.t0 = acc * BAR;
  s.dur = s.bars * BAR;
  acc += s.bars;
}
const TOTAL = acc * BAR;

// ---------------------------------------------------------------- setup
const out = document.getElementById('out');
out.width = W;
out.height = H;
const ctx = out.getContext('2d');
const renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
renderer.setPixelRatio(1);
renderer.setSize(W, H, false);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFShadowMap;
const camera = new THREE.PerspectiveCamera(68, W / H, 0.3, 6000);
const fr = Path.newFrame();
const tmp = new THREE.Vector3(), tmp2 = new THREE.Vector3(), mtx = new THREE.Matrix4();

const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const lerp = (a, b, t) => a + (b - a) * t;
const ease = {
  outCubic: (t) => 1 - Math.pow(1 - clamp(t, 0, 1), 3),
  inCubic: (t) => Math.pow(clamp(t, 0, 1), 3),
  inOut: (t) => ((t = clamp(t, 0, 1)), t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2),
  outBack: (t) => {
    t = clamp(t, 0, 1);
    const c1 = 1.9, c3 = c1 + 1;
    return 1 + c3 * Math.pow(t - 1, 3) + c1 * Math.pow(t - 1, 2);
  },
};
// Deterministic pseudo-random
const rnd = (i) => {
  const x = Math.sin(i * 127.1 + 311.7) * 43758.5453;
  return x - Math.floor(x);
};

// ---------------------------------------------------------------- helpers
function disposeScene(scene) {
  scene?.traverse((o) => {
    o.geometry?.dispose();
    for (const m of [].concat(o.material || [])) {
      for (const k of ['map', 'emissiveMap', 'envMap']) m[k]?.dispose?.();
      m.dispose?.();
    }
  });
}

function addCar(scene, type, color) {
  const c = buildCar(type, color);
  c.group.traverse((o) => (o.castShadow = true));
  scene.add(c.group);
  return c;
}

/** Put a car on a path at distance s, lateral offset d. */
function placeCar(c, path, s, d = 0) {
  path.frame(s, fr);
  const up = fr.N.clone(), fwd = fr.T.clone();
  const x = tmp.crossVectors(up, fwd).normalize();
  const y = tmp2.crossVectors(fwd, x).normalize();
  c.group.position.copy(fr.P).addScaledVector(fr.R, d);
  c.group.quaternion.setFromRotationMatrix(mtx.makeBasis(x, y, fwd));
  for (const w of c.wheels) w.rotation.x = s / c.wheelRadius;
  return c.group.position;
}

function findS(path, test, from = 0) {
  for (let s = from; s < path.L; s += 1) {
    path.frame(s, fr);
    if (test(fr, s)) return s;
  }
  return from;
}

// ---------------------------------------------------------------- shots
const shots = {
  chase: {
    setup() {
      const scene = new THREE.Scene();
      const track = new Track('chaos');
      track.build(scene);
      // First wall ride on the main line: road banked hard but not climbing
      const sWall = findS(track, (f) => f.N.y < 0.35 && Math.abs(f.T.y) < 0.3, 200);
      const cars = [
        [addCar(scene, 'shark', '#1f6bff'), 0, -2],
        [addCar(scene, 'longtail', '#ff7a00'), -13, 4],
        [addCar(scene, 'dicerod', '#ff3b5c'), -26, -4],
        [addCar(scene, 'sixbysix', '#00e5ff'), -40, 3],
      ];
      return { scene, track, cars, s0: sWall - 125, v: 62 };
    },
    update(st, t) {
      const lead = st.s0 + st.v * t;
      for (const [c, back, d] of st.cars) placeCar(c, st.track, lead + back, d);
      const f = Path.newFrame();
      st.track.frame(lead - 17, f);
      camera.fov = 72;
      camera.position.copy(f.P).addScaledVector(f.N, 6.5).addScaledVector(f.R, -1.5);
      camera.up.copy(f.N);
      st.track.frame(lead + 16, f);
      camera.lookAt(tmp.copy(f.P).addScaledVector(f.N, 1.2));
      st.track.update(1 / FPS);
    },
    text: [
      { t: 0.25, text: 'WALL RIDES', size: 110, y: 0.2, color: '#ffb703' },
      { t: 2.3, text: 'OVER. UNDER. THROUGH.', size: 64, y: 0.2, color: '#00e5ff' },
    ],
    label: 'CHAOS CROSSING',
  },

  tower: {
    setup() {
      const scene = new THREE.Scene();
      const track = new Track('skyline');
      track.build(scene);
      const tw = track.marks.tower;
      // Part-way up the skyscraper spiral
      const s0 = findS(track, (f) => Math.hypot(f.P.x - tw.x, f.P.z - tw.z) < tw.r + 4 && f.P.y > 60);
      const cars = [
        [addCar(scene, 'longtail', '#ffd000'), 0, 1],
        [addCar(scene, 'formula', '#ff2bd6'), -12, -4],
        [addCar(scene, 'shark', '#00e5ff'), -24, 3],
      ];
      return { scene, track, tw, cars, s0, v: 58 };
    },
    update(st, t) {
      const lead = st.s0 + st.v * t;
      let p = null;
      for (const [c, back, d] of st.cars) {
        const q = placeCar(c, st.track, lead + back, d);
        if (!back) p = q.clone();
      }
      const tw = st.tw;
      const ang = Math.atan2(p.z - tw.z, p.x - tw.x) + lerp(0.36, 0.2, ease.inOut(t / 4.36));
      const R = tw.r + 14; // inside the building-free ring around the tower
      camera.fov = 62;
      camera.up.set(0, 1, 0);
      camera.position.set(tw.x + Math.cos(ang) * R, p.y + 15, tw.z + Math.sin(ang) * R);
      camera.lookAt(p.x, p.y + 3, p.z);
      camera.updateMatrixWorld();
      camera.updateProjectionMatrix();
      const c0 = st.cars[0][0].group;
      st.dbg = { car: p.toArray().map(Math.round), grp: c0.position.toArray().map(Math.round), vis: c0.visible, inScene: !!c0.parent, ndc: p.clone().project(camera).toArray().map((v) => +v.toFixed(2)), s: Math.round(lead) };
      st.track.update(1 / FPS);
    },
    text: [{ t: 0.25, text: 'SPIRAL THE SKYLINE', size: 92, y: 0.2, color: '#ff2bd6' }],
    label: 'SKYLINE SPIRAL',
  },

  summit: {
    setup() {
      const scene = new THREE.Scene();
      const track = new Track('summit');
      track.build(scene);
      const cars = [
        [addCar(scene, 'sixbysix', '#ff7a00'), 0, -2],
        [addCar(scene, 'buggy', '#ffd000'), -14, 3],
        [addCar(scene, 'muscle', '#ff3b3b'), -28, -3],
      ];
      return { scene, track, cars, s0: track.mountainS[0] + 520, v: 55 };
    },
    update(st, t) {
      const lead = st.s0 + st.v * t;
      let p = null;
      for (const [c, back, d] of st.cars) {
        const q = placeCar(c, st.track, lead + back, d);
        if (!back) p = q.clone();
      }
      st.track.followShadow(p);
      const a = 2.3 + t * 0.22;
      camera.fov = 58;
      camera.up.set(0, 1, 0);
      camera.position.set(p.x + Math.cos(a) * 95, p.y + 62 - t * 4, p.z + Math.sin(a) * 95);
      camera.lookAt(p.x, p.y + 4, p.z);
      st.track.update(1 / FPS);
    },
    text: [{ t: 0.25, text: 'CLIMB THE MOUNTAIN', size: 92, y: 0.2, color: '#ffffff' }],
    label: 'SUMMIT RUSH  ·  7.2 KM',
  },

  loop: {
    setup() {
      const scene = new THREE.Scene();
      const track = new Track('colossus');
      track.build(scene);
      // Top of the first real loop: upside down AND well above the road just before it
      const g = Path.newFrame();
      const sTop = findS(track, (f, s) => {
        if (f.N.y > -0.9) return false;
        track.frame(s - 70, g);
        return f.P.y - g.P.y > 40;
      }, 200);
      const f = Path.newFrame();
      track.frame(sTop, f);
      const center = f.P.clone().addScaledVector(f.N, 40);
      const side = f.R.clone();
      const cars = [
        [addCar(scene, 'formula', '#39d353'), 0, 0],
        [addCar(scene, 'hyper', '#ff3b3b'), -15, 3],
        [addCar(scene, 'sixpack', '#12b886'), -30, -3],
      ];
      return { scene, track, cars, center, side, sTop, v: 66 };
    },
    update(st, t) {
      const lead = st.sTop + st.v * (t - 2.0);
      for (const [c, back, d] of st.cars) placeCar(c, st.track, lead + back, d);
      camera.fov = 64;
      camera.up.set(0, 1, 0);
      camera.position.copy(st.center).addScaledVector(st.side, 92 - t * 6).add(tmp.set(0, -16 + t * 2, 0));
      camera.lookAt(st.center);
      st.track.followShadow(st.center);
      st.track.update(1 / FPS);
    },
    text: [
      { t: 0.25, text: 'LOOPS', size: 120, y: 0.2, color: '#ffb703' },
      { t: 1.35, text: 'CORKSCREWS', size: 100, y: 0.2, color: '#ff3b3b' },
      { t: 2.45, text: 'JUMPS', size: 120, y: 0.2, color: '#00e5ff' },
    ],
    label: 'CANYON COLOSSUS',
  },

  roster: {
    setup() {
      const scene = new THREE.Scene();
      scene.background = new THREE.Color('#07080d');
      scene.fog = new THREE.Fog('#07080d', 12, 40);
      scene.add(new THREE.HemisphereLight('#cfe0ff', '#1a1020', 1.2));
      const key = new THREE.DirectionalLight('#ffffff', 2.6);
      key.position.set(4, 7, 5);
      key.castShadow = true;
      key.shadow.mapSize.setScalar(1024);
      scene.add(key);
      const rim = new THREE.DirectionalLight('#ff2bd6', 2.2);
      rim.position.set(-6, 3, -5);
      scene.add(rim);
      const rim2 = new THREE.DirectionalLight('#00e5ff', 1.6);
      rim2.position.set(6, 2, -6);
      scene.add(rim2);
      const floor = new THREE.Mesh(new THREE.CircleGeometry(60, 64), new THREE.MeshStandardMaterial({ color: '#0e1018', roughness: 0.35, metalness: 0.4 }));
      floor.rotation.x = -Math.PI / 2;
      floor.receiveShadow = true;
      scene.add(floor);
      const ring = new THREE.Mesh(new THREE.RingGeometry(3.6, 3.8, 64), new THREE.MeshBasicMaterial({ color: '#ffb703' }));
      ring.rotation.x = -Math.PI / 2;
      ring.position.y = 0.01;
      scene.add(ring);
      const table = new THREE.Group();
      scene.add(table);
      const colors = ['#ff3b3b', '#ffb703', '#39d353', '#00e5ff', '#ff7a00', '#ffd000', '#111111', '#1f6bff', '#12b886', '#4fc3c8'];
      const cars = CAR_IDS.map((id, i) => {
        const c = buildCar(id, colors[i % colors.length]);
        c.group.traverse((o) => (o.castShadow = true));
        c.group.visible = false;
        table.add(c.group);
        return { id, c };
      });
      return { scene, table, cars, per: (SHOTS.find((s) => s.id === 'roster').dur - 0.2) / cars.length };
    },
    update(st, t) {
      const k = clamp(Math.floor(t / st.per), 0, st.cars.length - 1);
      st.cars.forEach((c, i) => (c.c.group.visible = i === k));
      st.current = k;
      st.local = t - k * st.per;
      st.table.rotation.y = -0.6 + t * 0.9;
      st.table.position.x = -1.6;
      camera.fov = 40;
      camera.up.set(0, 1, 0);
      const z = 1 - 0.06 * ease.outCubic(st.local / st.per);
      camera.position.set(6.2 * z, 2.3, 7.4 * z);
      camera.lookAt(0.6, 0.8, 0);
    },
    text: [{ t: 0.1, text: '10 CARS', size: 80, y: 0.14, color: '#ffb703', x: 0.06, align: 'left' }],
  },

  battle: {
    setup() {
      const scene = new THREE.Scene();
      const world = buildArena(scene, { map: 'stadium' });
      const types = ['truck', 'shark', 'hyper', 'buggy'];
      const cols = ['#ff7a00', '#1f6bff', '#ff3b3b', '#39d353'];
      const cars = types.map((ty, i) => ({ c: addCar(scene, ty, cols[i]), ph: (i / types.length) * Math.PI * 2, r: 26 + (i % 2) * 12 }));
      // Explosions and rockets, on the beat
      const fx = [];
      const boomMat = new THREE.MeshBasicMaterial({ color: '#ffb347', transparent: true });
      for (let i = 0; i < 5; i++) {
        const m = new THREE.Mesh(new THREE.SphereGeometry(1, 20, 14), boomMat.clone());
        m.visible = false;
        scene.add(m);
        const light = new THREE.PointLight('#ff7a1a', 0, 60, 1.5);
        scene.add(light);
        const rocket = new THREE.Mesh(new THREE.CylinderGeometry(0.35, 0.35, 3, 8), new THREE.MeshBasicMaterial({ color: '#fff3a0' }));
        rocket.visible = false;
        scene.add(rocket);
        fx.push({ m, light, rocket, t: 0.35 + i * BEAT * 1.5, from: i % cars.length, to: (i + 2) % cars.length });
      }
      return { scene, world, cars, fx };
    },
    carPos(st, car, t) {
      const a = car.ph + t * (0.55 + car.r * 0.004) * (car.r > 30 ? -1 : 1);
      return [new THREE.Vector3(Math.cos(a) * car.r, 0, Math.sin(a) * car.r), a];
    },
    update(st, t) {
      for (const car of st.cars) {
        const [p, a] = this.carPos(st, car, t);
        const dir = car.r > 30 ? -1 : 1;
        car.c.group.position.copy(p);
        car.c.group.rotation.set(0, -a + (dir > 0 ? Math.PI : 0), 0);
        for (const w of car.c.wheels) w.rotation.x = t * 12;
      }
      for (const e of st.fx) {
        const fly = (t - e.t) / 0.35;
        const from = this.carPos(st, st.cars[e.from], e.t)[0].add(tmp.set(0, 2, 0));
        const to = this.carPos(st, st.cars[e.to], e.t + 0.35)[0].add(tmp2.set(0, 1, 0));
        e.rocket.visible = fly > 0 && fly < 1;
        if (e.rocket.visible) {
          e.rocket.position.copy(from).lerp(to, fly);
          e.rocket.lookAt(to);
          e.rocket.rotateX(Math.PI / 2);
        }
        const bt = (t - e.t - 0.35) / 0.7;
        e.m.visible = bt > 0 && bt < 1;
        if (e.m.visible) {
          const r = 2 + 9 * ease.outCubic(bt);
          e.m.position.copy(to);
          e.m.scale.setScalar(r);
          e.m.material.opacity = 1 - bt;
          e.m.material.color.set(bt < 0.25 ? '#fff6c0' : '#ff8a2a');
        }
        e.light.position.copy(to);
        e.light.intensity = bt > 0 && bt < 1 ? 60 * (1 - bt) : 0;
      }
      const a = 0.6 + t * 0.18;
      camera.fov = 60;
      camera.up.set(0, 1, 0);
      camera.position.set(Math.cos(a) * 40, 12 - t * 1.2, Math.sin(a) * 40);
      camera.lookAt(0, 1, 0);
    },
    text: [
      { t: 0.25, text: 'BATTLE MODE', size: 110, y: 0.2, color: '#ff3b3b' },
      { t: 1.4, text: '10 WEAPONS  ·  DESTRUCTIBLE ARENAS', size: 44, y: 0.31, color: '#ffffff' },
    ],
  },

  end: {
    setup() {
      const scene = new THREE.Scene();
      const track = new Track('chaos');
      track.build(scene);
      const box = new THREE.Box3();
      for (let i = 0; i < track.n; i += 8) box.expandByPoint(tmp.fromArray(track.P, i * 3));
      const cars = [
        [addCar(scene, 'shark', '#1f6bff'), 0, -2],
        [addCar(scene, 'longtail', '#ff7a00'), -14, 3],
      ];
      return { scene, track, center: box.getCenter(new THREE.Vector3()), size: box.getSize(new THREE.Vector3()), cars };
    },
    update(st, t) {
      const lead = 900 + 60 * t;
      for (const [c, back, d] of st.cars) placeCar(c, st.track, lead + back, d);
      const a = 0.8 + t * 0.07;
      const R = Math.max(st.size.x, st.size.z) * 0.75;
      camera.fov = 50;
      camera.up.set(0, 1, 0);
      camera.position.set(st.center.x + Math.cos(a) * R, 330, st.center.z + Math.sin(a) * R);
      camera.lookAt(st.center.x, 20, st.center.z);
      st.track.update(1 / FPS);
    },
  },
};

// ---------------------------------------------------------------- 2D overlay
const FONT = (size, fam = 'Russo') => `${size}px ${fam}, 'Liberation Sans', sans-serif`;

function kinetic(item, t, shotDur) {
  const lt = t - item.t;
  if (lt < 0) return;
  const next = item.until ?? shotDur;
  const outT = t - (next - 0.14);
  const inK = ease.outBack(lt / 0.28);
  const alpha = clamp(lt / 0.1, 0, 1) * (1 - clamp(outT / 0.14, 0, 1));
  if (alpha <= 0) return;
  const size = item.size * (W / 1280);
  const align = item.align || 'center';
  const x = (item.x ?? 0.5) * W + (1 - inK) * W * 0.25 - clamp(outT / 0.14, 0, 1) * W * 0.2;
  const y = item.y * H + size * 0.35;
  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.translate(x, y);
  ctx.transform(1, 0, -0.18, 1, 0, 0); // italic lean
  const sc = lerp(1.35, 1, clamp(inK, 0, 1.2));
  ctx.scale(sc, sc);
  ctx.font = FONT(size);
  ctx.textAlign = align;
  ctx.textBaseline = 'alphabetic';
  // Hard offset shadow + outline, arcade style
  ctx.lineJoin = 'round';
  ctx.fillStyle = 'rgba(0,0,0,0.55)';
  ctx.fillText(item.text, size * 0.06, size * 0.07);
  ctx.lineWidth = size * 0.11;
  ctx.strokeStyle = '#0b0d14';
  ctx.strokeText(item.text, 0, 0);
  ctx.fillStyle = item.color;
  ctx.fillText(item.text, 0, 0);
  ctx.restore();
}

function trackLabel(text, lt, dur) {
  const a = clamp((lt - 0.4) / 0.2, 0, 1) * (1 - clamp((lt - dur + 0.2) / 0.15, 0, 1));
  if (a <= 0) return;
  const s = W / 1280;
  const slide = (1 - ease.outCubic((lt - 0.4) / 0.35)) * 60 * s;
  ctx.save();
  ctx.globalAlpha = a;
  ctx.font = FONT(26 * s);
  const w = ctx.measureText(text).width + 56 * s;
  const x = 40 * s - slide, y = H - 70 * s;
  ctx.fillStyle = 'rgba(8,10,18,0.78)';
  ctx.beginPath();
  ctx.moveTo(x, y);
  ctx.lineTo(x + w + 18 * s, y);
  ctx.lineTo(x + w, y + 44 * s);
  ctx.lineTo(x - 18 * s, y + 44 * s);
  ctx.closePath();
  ctx.fill();
  ctx.fillStyle = '#ffb703';
  ctx.fillRect(x - 6 * s, y, 8 * s, 44 * s);
  ctx.fillStyle = '#fff';
  ctx.textBaseline = 'middle';
  ctx.fillText(text, x + 22 * s, y + 23 * s);
  ctx.restore();
}

function vignette(strength = 0.55) {
  const g = ctx.createRadialGradient(W / 2, H / 2, H * 0.35, W / 2, H / 2, H * 0.95);
  g.addColorStop(0, 'rgba(0,0,0,0)');
  g.addColorStop(1, `rgba(0,0,0,${strength})`);
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, W, H);
}

function speedLines(t, n = 26, alpha = 0.5, seed = 0) {
  ctx.save();
  ctx.globalCompositeOperation = 'lighter';
  for (let i = 0; i < n; i++) {
    const y = rnd(i + seed) * H;
    const len = (0.15 + rnd(i * 3 + seed) * 0.35) * W;
    const speed = (1.5 + rnd(i * 7 + seed) * 2.5) * W;
    const x = ((rnd(i * 11 + seed) * W * 2 + t * speed) % (W * 2)) - len;
    const g = ctx.createLinearGradient(x, 0, x + len, 0);
    const col = i % 3 === 0 ? '255,43,214' : i % 3 === 1 ? '0,229,255' : '255,183,3';
    g.addColorStop(0, `rgba(${col},0)`);
    g.addColorStop(1, `rgba(${col},${alpha})`);
    ctx.fillStyle = g;
    ctx.fillRect(x, y, len, 2 + rnd(i * 5 + seed) * 3);
  }
  ctx.restore();
}

function neonGrid(t) {
  ctx.fillStyle = '#06060f';
  ctx.fillRect(0, 0, W, H);
  const hy = H * 0.55;
  const sky = ctx.createLinearGradient(0, 0, 0, hy);
  sky.addColorStop(0, '#07071a');
  sky.addColorStop(1, '#3a0b4a');
  ctx.fillStyle = sky;
  ctx.fillRect(0, 0, W, hy);
  // Sun
  ctx.save();
  const sun = ctx.createLinearGradient(0, hy - H * 0.32, 0, hy);
  sun.addColorStop(0, '#ffe066');
  sun.addColorStop(1, '#ff2bd6');
  ctx.fillStyle = sun;
  ctx.beginPath();
  ctx.arc(W / 2, hy, H * 0.3, Math.PI, 0);
  ctx.fill();
  ctx.fillStyle = '#3a0b4a';
  for (let i = 0; i < 7; i++) ctx.fillRect(W / 2 - H * 0.3, hy - i * i * 2.4 - 6, H * 0.6, 2 + i * 0.8);
  ctx.restore();
  // Grid floor
  ctx.strokeStyle = 'rgba(255,43,214,0.8)';
  ctx.lineWidth = 2;
  for (let i = -16; i <= 16; i++) {
    ctx.beginPath();
    ctx.moveTo(W / 2 + i * 12, hy);
    ctx.lineTo(W / 2 + i * W * 0.14, H);
    ctx.stroke();
  }
  const phase = (t * 1.6) % 1;
  for (let k = 0; k < 14; k++) {
    const z = (k + phase) / 14;
    const y = hy + (H - hy) * Math.pow(z, 2.2);
    ctx.globalAlpha = z;
    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.lineTo(W, y);
    ctx.stroke();
  }
  ctx.globalAlpha = 1;
}

function logo(cx, cy, scale, t, reveal = 1) {
  const s = scale * (W / 1280);
  ctx.save();
  ctx.translate(cx, cy);
  ctx.transform(1, 0, -0.16, 1, 0, 0);
  ctx.textBaseline = 'middle';
  const parts = [
    ['KART', '#ffb703', -1, 0],
    ['BLASTERS', '#ff3b3b', 1, 0.2],
  ];
  ctx.font = FONT(120 * s, 'Bungee');
  const w1 = ctx.measureText('KART ').width, w2 = ctx.measureText('BLASTERS').width;
  const total = w1 + w2;
  let x = -total / 2;
  for (const [txt, col, from, delay] of parts) {
    const k = ease.outBack((t - delay) / 0.3);
    if (t - delay < 0) {
      x += txt === 'KART' ? w1 : w2;
      continue;
    }
    const dx = (1 - clamp(k, 0, 1.3)) * from * W * 0.7;
    ctx.globalAlpha = clamp((t - delay) / 0.08, 0, 1) * reveal;
    ctx.fillStyle = 'rgba(0,0,0,0.6)';
    ctx.fillText(txt, x + dx + 8 * s, 9 * s);
    ctx.lineWidth = 14 * s;
    ctx.strokeStyle = '#0b0d14';
    ctx.lineJoin = 'round';
    ctx.strokeText(txt, x + dx, 0);
    ctx.fillStyle = col;
    ctx.fillText(txt, x + dx, 0);
    x += txt === 'KART' ? w1 : w2;
  }
  ctx.restore();
}

function flash(a, col = '255,255,255') {
  if (a <= 0) return;
  ctx.fillStyle = `rgba(${col},${clamp(a, 0, 1)})`;
  ctx.fillRect(0, 0, W, H);
}

function statBars(id, lt) {
  const car = CARS[id];
  const s = W / 1280;
  const defs = [['ACCELERATION', 'accel'], ['TOP SPEED', 'speed'], ['BOOST POWER', 'boost'], ['GRIP', 'grip'], ['HEALTH', 'hp']];
  const x = W - 470 * s, y0 = H * 0.3;
  ctx.save();
  ctx.fillStyle = 'rgba(8,10,18,0.7)';
  ctx.beginPath();
  ctx.roundRect(x - 26 * s, y0 - 100 * s, 480 * s, 330 * s, 16 * s);
  ctx.fill();
  ctx.font = FONT(50 * s);
  ctx.textAlign = 'right';
  ctx.textBaseline = 'alphabetic';
  const nameIn = ease.outCubic(lt / 0.12);
  ctx.globalAlpha = nameIn;
  ctx.fillStyle = '#fff';
  ctx.fillText(car.name.toUpperCase(), W - 60 * s + (1 - nameIn) * 60 * s, y0 - 36 * s);
  ctx.textAlign = 'left';
  ctx.font = FONT(18 * s);
  defs.forEach(([label, key], i) => {
    const vals = CAR_IDS.map((c) => CARS[c][key]);
    const lo = Math.min(...vals), hi = Math.max(...vals);
    const f = 0.18 + 0.82 * ((car[key] - lo) / (hi - lo || 1));
    const y = y0 + i * 44 * s;
    const grow = ease.outCubic((lt - 0.03 * i) / 0.22);
    ctx.globalAlpha = 1;
    ctx.fillStyle = '#9aa3b5';
    ctx.fillText(label, x, y);
    ctx.fillStyle = 'rgba(255,255,255,0.12)';
    ctx.fillRect(x, y + 10 * s, 420 * s, 12 * s);
    const g = ctx.createLinearGradient(x, 0, x + 420 * s, 0);
    g.addColorStop(0, '#ffb703');
    g.addColorStop(1, '#ff3b3b');
    ctx.fillStyle = g;
    ctx.fillRect(x, y + 10 * s, 420 * s * f * clamp(grow, 0, 1), 12 * s);
  });
  ctx.restore();
}

// ---------------------------------------------------------------- frame
let active = null; // { id, st }

function shotAt(t) {
  for (let i = SHOTS.length - 1; i >= 0; i--) if (t >= SHOTS[i].t0) return SHOTS[i];
  return SHOTS[0];
}

function frame(i) {
  const t = i / FPS;
  const shot = shotAt(t);
  const lt = t - shot.t0;
  const def = shots[shot.id];
  if (def && active?.id !== shot.id) {
    disposeScene(active?.st.scene);
    active = { id: shot.id, st: def.setup() };
  }
  ctx.clearRect(0, 0, W, H);
  if (def) {
    def.update(active.st, lt);
    camera.aspect = W / H;
    camera.updateProjectionMatrix();
    renderer.render(active.st.scene, camera);
    ctx.drawImage(renderer.domElement, 0, 0, W, H);
  }

  const beatPhase = (t % BEAT) / BEAT;
  switch (shot.id) {
    case 'intro': {
      neonGrid(t);
      speedLines(t, 30, 0.7, 3);
      logo(W / 2, H * 0.4, 1.05, lt - 0.12);
      kinetic({ t: 1.05, text: 'STUNT RACING  ·  CAR BATTLES', size: 38, y: 0.58, color: '#ffffff' }, lt, shot.dur);
      flash(1 - lt / 0.25, '0,0,0');
      break;
    }
    case 'roster': {
      vignette(0.5);
      const st = active.st;
      statBars(st.cars[st.current].id, st.local);
      for (const it of def.text) kinetic(it, lt, shot.dur);
      break;
    }
    case 'end': {
      ctx.fillStyle = 'rgba(5,6,14,0.55)';
      ctx.fillRect(0, 0, W, H);
      vignette(0.75);
      speedLines(t, 14, 0.35, 9);
      logo(W / 2, H * 0.34, 1.0, lt - 0.05);
      const s = W / 1280;
      const a1 = ease.outCubic((lt - 0.55) / 0.3);
      ctx.save();
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.globalAlpha = a1;
      ctx.font = FONT(46 * s);
      ctx.fillStyle = '#fff';
      ctx.fillText('PLAY FREE WITH YOUR FRIENDS', W / 2, H * 0.52 + (1 - a1) * 30);
      // URL button
      const a2 = ease.outBack((lt - 0.9) / 0.35);
      if (lt > 0.9) {
        ctx.globalAlpha = clamp((lt - 0.9) / 0.1, 0, 1);
        ctx.font = FONT(34 * s);
        const url = 'online-go-kart-game.vercel.app';
        const bw = ctx.measureText(url).width + 80 * s, bh = 72 * s;
        const pulse = 1 + 0.03 * Math.sin(lt * 7);
        ctx.save();
        ctx.translate(W / 2, H * 0.67);
        ctx.scale(clamp(a2, 0, 1.2) * pulse, clamp(a2, 0, 1.2) * pulse);
        const grad = ctx.createLinearGradient(-bw / 2, 0, bw / 2, 0);
        grad.addColorStop(0, '#ffb703');
        grad.addColorStop(1, '#ff7a00');
        ctx.fillStyle = grad;
        ctx.beginPath();
        ctx.roundRect(-bw / 2, -bh / 2, bw, bh, 18 * s);
        ctx.fill();
        ctx.fillStyle = '#12131a';
        ctx.fillText(url, 0, 3 * s);
        ctx.restore();
      }
      const a3 = clamp((lt - 1.4) / 0.3, 0, 1);
      ctx.globalAlpha = a3;
      ctx.font = FONT(22 * s);
      ctx.fillStyle = '#9fe8ff';
      ctx.fillText('IN YOUR BROWSER  ·  NO DOWNLOAD  ·  PEER-TO-PEER  ·  MOBILE READY', W / 2, H * 0.8);
      ctx.fillStyle = '#ffb703';
      ctx.fillText('10 TRACKS  ·  10 CARS  ·  RACE & BATTLE', W / 2, H * 0.85);
      ctx.restore();
      // Fade to black at the very end
      flash((lt - (shot.dur - 0.5)) / 0.5, '0,0,0');
      break;
    }
    default: {
      vignette(0.5);
      if (lt < 0.45) speedLines(t, 20, 0.45 * (1 - lt / 0.45), shot.t0);
      (def.text || []).forEach((it, k, arr) => kinetic({ ...it, until: arr[k + 1]?.t }, lt, shot.dur));
      if (def.label) trackLabel(def.label, lt, shot.dur);
    }
  }
  // Cut flash and a soft pulse on every beat
  if (shot.id !== 'intro') flash(0.75 * (1 - lt / 0.14));
  flash(0.06 * (1 - beatPhase * 5), '255,255,255');
  return out.toDataURL('image/jpeg', 0.93);
}

// ---------------------------------------------------------------- audio
async function audio() {
  const sr = 44100;
  const len = Math.ceil(TOTAL * sr);
  const ac = new OfflineAudioContext(2, len, sr);
  const master = ac.createGain();
  master.gain.setValueAtTime(1, 0);
  master.gain.setValueAtTime(1, TOTAL - 1.4);
  master.gain.linearRampToValueAtTime(0, TOTAL);
  master.connect(ac.destination);
  const noise = ac.createBuffer(1, sr, sr);
  const nd = noise.getChannelData(0);
  for (let i = 0; i < sr; i++) nd[i] = rnd(i) * 2 - 1;

  // Music: the game's own synth engine, straight into the main section
  const m = new Music(ac, master, noise);
  m.volume = 0.6;
  m.setEnabled(true);
  m.play('neon');
  clearInterval(m.timer);
  m.timer = 1;
  m.step = 4 * 16;
  m.nextTime = 0;
  m.out.gain.cancelScheduledValues(0);
  m.out.gain.setValueAtTime(m.volume, 0);
  while (m.nextTime < TOTAL) {
    Object.defineProperty(ac, 'currentTime', { value: m.nextTime, configurable: true });
    m.schedule();
  }

  // Whoosh into every cut, a hit on every cut and on the logo slams
  const whoosh = (at) => {
    const src = ac.createBufferSource();
    src.buffer = noise;
    src.loop = true;
    const bp = ac.createBiquadFilter();
    bp.type = 'bandpass';
    bp.Q.value = 1.2;
    bp.frequency.setValueAtTime(300, at - 0.35);
    bp.frequency.exponentialRampToValueAtTime(4000, at);
    const g = ac.createGain();
    g.gain.setValueAtTime(0.0001, at - 0.35);
    g.gain.exponentialRampToValueAtTime(0.35, at - 0.02);
    g.gain.exponentialRampToValueAtTime(0.0001, at + 0.12);
    src.connect(bp).connect(g).connect(master);
    src.start(Math.max(0, at - 0.35));
    src.stop(at + 0.2);
  };
  const hit = (at, vol = 0.7) => {
    const o = ac.createOscillator();
    o.frequency.setValueAtTime(120, at);
    o.frequency.exponentialRampToValueAtTime(40, at + 0.35);
    const g = ac.createGain();
    g.gain.setValueAtTime(vol, at);
    g.gain.exponentialRampToValueAtTime(0.001, at + 0.5);
    o.connect(g).connect(master);
    o.start(at);
    o.stop(at + 0.55);
  };
  for (const s of SHOTS.slice(1)) {
    whoosh(s.t0);
    hit(s.t0, 0.45);
  }
  hit(0.12, 0.8);
  hit(0.32, 0.8);
  const end = SHOTS.find((s) => s.id === 'end').t0;
  hit(end + 0.05, 0.8);
  hit(end + 0.25, 0.8);

  const buf = await ac.startRendering();
  // Normalise and encode 16-bit WAV
  let peak = 0;
  for (let c = 0; c < 2; c++) for (const x of buf.getChannelData(c)) peak = Math.max(peak, Math.abs(x));
  const gain = peak > 0 ? 0.89 / peak : 1;
  const n = buf.length, bytes = 44 + n * 4;
  const dv = new DataView(new ArrayBuffer(bytes));
  const w = (o, s) => [...s].forEach((ch, i) => dv.setUint8(o + i, ch.charCodeAt(0)));
  w(0, 'RIFF');
  dv.setUint32(4, bytes - 8, true);
  w(8, 'WAVEfmt ');
  dv.setUint32(16, 16, true);
  dv.setUint16(20, 1, true);
  dv.setUint16(22, 2, true);
  dv.setUint32(24, sr, true);
  dv.setUint32(28, sr * 4, true);
  dv.setUint16(32, 4, true);
  dv.setUint16(34, 16, true);
  w(36, 'data');
  dv.setUint32(40, n * 4, true);
  const L = buf.getChannelData(0), R = buf.getChannelData(1);
  for (let i = 0; i < n; i++) {
    dv.setInt16(44 + i * 4, clamp(L[i] * gain, -1, 1) * 32767, true);
    dv.setInt16(46 + i * 4, clamp(R[i] * gain, -1, 1) * 32767, true);
  }
  let bin = '';
  const u8 = new Uint8Array(dv.buffer);
  for (let i = 0; i < u8.length; i += 0x8000) bin += String.fromCharCode(...u8.subarray(i, i + 0x8000));
  return btoa(bin);
}

window.AD = {
  W, H, FPS, TOTAL,
  frames: Math.ceil(TOTAL * FPS),
  shots: SHOTS.map((s) => ({ id: s.id, t0: s.t0, dur: s.dur })),
  async ready() {
    await document.fonts.load(FONT(40));
    await document.fonts.load(FONT(40, 'Bungee'));
  },
  frame,
  audio,
  dbg: () => active?.st.dbg,
};
