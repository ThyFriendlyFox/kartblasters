import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
import { adder, mats, canvasTex, tireGeometry, spokeRim, sidewallRing, profileGeo, shade, plateTex } from './cars2.js';

/**
 * Four more detailed cars, replacing the original simple bodies:
 *  - buggy:  a VW-style rail dune buggy (tube frame in the player's colour,
 *            woodgrain side panels, flat-4 out back, whip flag)
 *  - hyper:  a black 80s wedge supercar with a turbo (louvred rear window,
 *            cross-spoke wheels, pinstripes in the player's colour)
 *  - muscle: a 60s muscle coupe (stacked headlamps, split grille, hood
 *            scoop, Rally wheels on redline tyres)
 *  - truck:  an armoured mine-protected 4x4 (V-hull, crew box, cooling fans,
 *            spare wheels on the flanks)
 *
 * Same contract as cars2.js: parts go into `body` (car faces +Z, wheels on
 * y = 0) and the builder returns its wheel layout and extras.
 */

const rb = (w, h, d, r = 0.05, s = 2) => new RoundedBoxGeometry(w, h, d, s, Math.max(0.001, Math.min(r, w / 2 - 0.001, h / 2 - 0.001, d / 2 - 0.001)));
const V = (p) => new THREE.Vector3(...p);

/** Tube through points (a bent frame member). */
function tube(add, mat, pts, r = 0.042) {
  const g =
    pts.length === 2
      ? (() => {
          const a = V(pts[0]), b = V(pts[1]), d = b.clone().sub(a);
          const c = new THREE.CylinderGeometry(r, r, d.length(), 10);
          c.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), d.normalize()));
          c.translate(...a.clone().add(b).multiplyScalar(0.5).toArray());
          return c;
        })()
      : new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts.map(V), false, 'centripetal'), pts.length * 10, r, 10);
  return add(g, mat);
}

/** Flat polygon from [z, y] points, on the car's side at x (double sided). */
function sidePoly(add, mat, pts, x) {
  const s = new THREE.Shape();
  pts.forEach(([z, y], i) => (i ? s.lineTo(z, y) : s.moveTo(z, y)));
  s.closePath();
  const m = add(new THREE.ShapeGeometry(s).rotateY(-Math.PI / 2), mat, x, 0, 0);
  return m;
}

/** Quad between two [z, y] edges of width 2w (windscreens and rear glass). */
function quad(add, mat, a, b, w, wb = w) {
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute([-w, a[1], a[0], w, a[1], a[0], wb, b[1], b[0], -wb, b[1], b[0]], 3));
  g.setIndex([0, 1, 2, 0, 2, 3]);
  g.computeVertexNormals();
  return add(g, mat);
}

/** Side silhouette with round wheel arches cut in. `top` runs front to back. */
function silhouette(base, arches, front, top) {
  const s = new THREE.Shape();
  const [z0] = top[top.length - 1];
  s.moveTo(z0, base);
  for (const [zc, r, yc] of [...arches].sort((a, b) => a[0] - b[0])) {
    s.lineTo(zc - r, base);
    s.absarc(zc, yc, r, Math.PI, 0, true);
  }
  s.lineTo(front, base);
  for (const [z, y] of top) s.lineTo(z, y);
  s.closePath();
  return s;
}

function textDecal(text, color, { w = 512, h = 128, font = 'italic 900 88px Arial Black, Impact, sans-serif' } = {}) {
  return canvasTex(w, h, (g) => {
    g.clearRect(0, 0, w, h);
    g.fillStyle = color;
    g.font = font;
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.fillText(text, w / 2, h / 2 + 4);
  });
}

// ---------------- 1. Rail dune buggy ----------------

function woodTex() {
  const t = canvasTex(512, 128, (g, w, h) => {
    g.fillStyle = '#7a4424';
    g.fillRect(0, 0, w, h);
    let seed = 5;
    const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
    for (let i = 0; i < 90; i++) {
      const y = rnd() * h, a = 0.08 + rnd() * 0.18;
      g.strokeStyle = rnd() < 0.5 ? `rgba(40,18,6,${a})` : `rgba(190,110,60,${a})`;
      g.lineWidth = 1 + rnd() * 3;
      g.beginPath();
      g.moveTo(0, y);
      for (let x = 0; x <= w; x += 32) g.lineTo(x, y + Math.sin(x * 0.01 + i) * 4 + (rnd() - 0.5) * 2);
      g.stroke();
    }
    // Gold pinstripe border
    g.strokeStyle = '#e0b060';
    g.lineWidth = 4;
    g.strokeRect(4, 4, w - 8, h - 8);
  });
  return t;
}

export function buildRailBuggy(body, color) {
  const add = adder(body);
  const frame = mats.paint(color, { metalness: 0.55, roughness: 0.2 });
  const chrome = mats.chrome();
  const black = mats.flat('#101115', { roughness: 0.45 });
  const alu = mats.satin();
  const T = (pts, r = 0.042) => tube(add, frame, pts, r);

  // Tube frame: lower and upper rails, nose, cage, rear braces
  for (const f of [1, -1]) {
    T([[f * 0.26, 0.5, 2.05], [f * 0.42, 0.48, 1.2], [f * 0.58, 0.48, 0.3], [f * 0.6, 0.5, -0.6], [f * 0.55, 0.56, -1.55]]);
    T([[f * 0.26, 0.82, 2.05], [f * 0.42, 0.97, 1.15], [f * 0.55, 1.01, 0.6], [f * 0.6, 0.98, 0.0], [f * 0.6, 0.98, -0.62], [f * 0.52, 1.06, -1.55]]);
    T([[f * 0.26, 0.5, 2.05], [f * 0.26, 0.82, 2.05]]);
    T([[f * 0.42, 0.48, 1.2], [f * 0.42, 0.97, 1.15]]);
    T([[f * 0.26, 0.5, 2.05], [f * 0.42, 0.97, 1.15]], 0.03);
    T([[f * 0.42, 0.48, 1.2], [f * 0.57, 0.99, 0.35]], 0.03);
    T([[f * 0.58, 0.48, 0.3], [f * 0.57, 0.99, 0.35]]);
    // A-pillar from the cowl up to the roof, main hoop, roof bar
    T([[f * 0.52, 1.0, 0.75], [f * 0.48, 1.55, 0.3], [f * 0.44, 1.95, -0.05]]);
    T([[f * 0.6, 0.5, -0.62], [f * 0.58, 1.3, -0.64], [f * 0.48, 1.95, -0.62]]);
    T([[f * 0.44, 1.95, -0.05], [f * 0.48, 1.95, -0.62]]);
    // Rear braces down to the engine cage
    T([[f * 0.48, 1.93, -0.64], [f * 0.46, 1.4, -1.2], [f * 0.52, 1.08, -1.55]]);
    T([[f * 0.55, 0.56, -1.55], [f * 0.52, 1.06, -1.55]]);
    T([[f * 0.55, 0.56, -1.55], [f * 0.42, 0.62, -2.05], [f * 0.42, 1.0, -2.05], [f * 0.52, 1.06, -1.55]], 0.035);
  }
  for (const [a, b] of [
    [[-0.26, 0.82, 2.05], [0.26, 0.82, 2.05]],
    [[-0.26, 0.5, 2.05], [0.26, 0.5, 2.05]],
    [[-0.44, 1.95, -0.05], [0.44, 1.95, -0.05]],
    [[-0.48, 1.95, -0.62], [0.48, 1.95, -0.62]],
    [[-0.52, 1.0, 0.75], [0.52, 1.0, 0.75]],
    [[-0.58, 1.3, -0.64], [0.58, 1.3, -0.64]],
    [[-0.52, 1.06, -1.55], [0.52, 1.06, -1.55]],
    [[-0.55, 0.56, -1.55], [0.55, 0.56, -1.55]],
    [[-0.42, 1.0, -2.05], [0.42, 1.0, -2.05]],
  ]) T([a, b]);
  // Padded grab hoops over the two seats
  for (const s of [0.27, -0.27]) tube(add, black, [[s - 0.17, 1.95, -0.62], [s - 0.12, 2.12, -0.58], [s + 0.12, 2.12, -0.58], [s + 0.17, 1.95, -0.62]], 0.055);

  // Perforated side mesh in the nose, and the belly pan
  const mesh = mats.flat('#c6ccd4', { metalness: 0.6, roughness: 0.4, transparent: true, opacity: 0.55, side: THREE.DoubleSide });
  for (const f of [1, -1]) {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute([f * 0.26, 0.5, 2.05, f * 0.26, 0.82, 2.05, f * 0.42, 0.97, 1.15, f * 0.42, 0.48, 1.2, f * 0.57, 0.99, 0.35, f * 0.58, 0.48, 0.3], 3));
    g.setIndex([0, 1, 2, 0, 2, 3, 3, 2, 4, 3, 4, 5]);
    g.computeVertexNormals();
    add(g, mesh);
  }
  const pan = new THREE.Shape();
  [[0.26, 2.05], [0.58, 0.3], [0.6, -0.6], [0.55, -1.55], [-0.55, -1.55], [-0.6, -0.6], [-0.58, 0.3], [-0.26, 2.05]].forEach(([x, z], i) => (i ? pan.lineTo(x, -z) : pan.moveTo(x, -z)));
  add(new THREE.ShapeGeometry(pan).rotateX(-Math.PI / 2), mats.flat('#9aa1ab', { metalness: 0.7, roughness: 0.35, side: THREE.DoubleSide }), 0, 0.47, 0);

  // Side body panels: black with a woodgrain insert and a pinstripe
  const wood = new THREE.MeshStandardMaterial({ map: woodTex(), roughness: 0.3, metalness: 0.1, side: THREE.DoubleSide });
  wood.map.repeat.set(0.52, 1.9);
  wood.map.offset.set(0.4, -0.95);
  wood.map.wrapS = wood.map.wrapT = THREE.RepeatWrapping;
  const panel = mats.paint('#0c0d10', { metalness: 0.3, roughness: 0.2, side: THREE.DoubleSide });
  for (const f of [1, -1]) {
    sidePoly(add, panel, [[0.78, 0.48], [0.55, 0.97], [-1.5, 1.02], [-1.55, 0.5]], f * 0.625);
    sidePoly(add, wood, [[0.62, 0.58], [0.47, 0.88], [-1.4, 0.92], [-1.44, 0.58]], f * 0.632);
  }

  // Cockpit: two black buckets, steering wheel on the left
  for (const s of [0.27, -0.27]) {
    add(rb(0.42, 0.12, 0.44, 0.05), black, s, 0.62, -0.3);
    const back = add(rb(0.42, 0.62, 0.12, 0.05), black, s, 0.98, -0.54);
    back.rotation.x = -0.18;
    add(rb(0.3, 0.14, 0.14, 0.06), black, s, 1.34, -0.6);
    for (const x of [s - 0.2, s + 0.2]) add(rb(0.06, 0.34, 0.4, 0.03), black, x, 0.8, -0.35); // bolsters
  }
  const wheel = add(new THREE.TorusGeometry(0.17, 0.024, 8, 24), black, 0.27, 1.1, 0.25);
  wheel.rotation.x = -0.55;
  add(new THREE.CylinderGeometry(0.03, 0.03, 0.55, 8).rotateX(Math.PI / 2 - 0.55), chrome, 0.27, 1.02, 0.48);
  add(rb(0.12, 0.35, 0.08, 0.02), chrome, 0.08, 0.72, 0.1); // gear lever gate

  // Front: VW twin-tube beam with trailing arms, shocks, square lamps
  for (const y of [0.4, 0.58]) add(new THREE.CylinderGeometry(0.05, 0.05, 1.5, 12).rotateZ(Math.PI / 2), chrome, 0, y, 1.9);
  for (const f of [1, -1]) {
    add(rb(0.1, 0.34, 0.12, 0.03), frame, f * 0.72, 0.49, 1.88);
    for (const y of [0.4, 0.58]) add(rb(0.05, 0.05, 0.3, 0.02), chrome, f * 0.8, y, 1.78);
    tube(add, chrome, [[f * 0.28, 0.9, 1.95], [f * 0.62, 0.52, 1.85]], 0.028);
    const spring = add(new THREE.TorusGeometry(0.05, 0.012, 6, 12), mats.flat('#d0302a'), f * 0.46, 0.72, 1.9);
    spring.rotation.set(0.9, 0, f * 0.8);
    add(rb(0.24, 0.14, 0.1, 0.02), chrome, f * 0.38, 0.84, 2.1);
    add(new THREE.PlaneGeometry(0.2, 0.1), mats.glow('#fff6d8'), f * 0.38, 0.84, 2.152);
    add(rb(0.06, 0.08, 0.04, 0.01), mats.glow('#ffa21c'), f * 0.62, 0.52, 2.0);
  }

  // Rear: flat-4 with twin air cleaners, exhaust, aluminium wing
  add(rb(0.78, 0.36, 0.52, 0.06), alu, 0, 0.82, -1.88);
  for (const f of [1, -1]) {
    add(rb(0.16, 0.3, 0.44, 0.05), alu, f * 0.47, 0.8, -1.88);
    add(new THREE.CylinderGeometry(0.13, 0.13, 0.12, 20), chrome, f * 0.24, 1.14, -1.86);
    add(new THREE.CylinderGeometry(0.03, 0.04, 0.16, 8), chrome, f * 0.24, 1.02, -1.86);
    tube(add, chrome, [[f * 0.3, 0.62, -2.05], [f * 0.2, 0.5, -2.2], [f * 0.12, 0.52, -2.35]], 0.035);
  }
  add(new THREE.CylinderGeometry(0.16, 0.16, 0.14, 20).rotateX(Math.PI / 2), black, 0, 0.96, -2.14); // fan housing
  const wing = add(rb(1.5, 0.03, 0.36, 0.01), alu, 0, 1.62, -1.78);
  wing.rotation.x = 0.15;
  for (const f of [1, -1]) {
    add(rb(0.03, 0.2, 0.4, 0.01), alu, f * 0.75, 1.64, -1.78);
    tube(add, alu, [[f * 0.4, 1.6, -1.72], [f * 0.46, 1.4, -1.25]], 0.02);
  }

  // Whip flag on the front beam
  add(new THREE.CylinderGeometry(0.012, 0.016, 2.9, 6), mats.flat('#f4f4f4'), -0.52, 1.98, 1.9);
  const flag = new THREE.Shape();
  flag.moveTo(0, 0);
  flag.lineTo(-0.62, -0.17);
  flag.lineTo(0, -0.46);
  flag.closePath();
  const fg = new THREE.ShapeGeometry(flag, 4);
  const fm = add(fg.rotateY(-Math.PI / 2), mats.flat('#ff5a14', { side: THREE.DoubleSide, roughness: 0.8 }), -0.52, 3.42, 1.9);
  fm.rotation.y = 0.25;

  return {
    roofY: 2.15,
    axles: [
      { z: 1.75, r: 0.4, w: 0.22, track: 0.88, steer: true },
      { z: -1.3, r: 0.6, w: 0.56, track: 0.94, steer: false },
    ],
    tire: (r, w) => tireGeometry(r, w, r > 0.5 ? { knobs: 20, inner: 0.6 } : { inner: 0.62 }),
    rim: (tire, r, w) =>
      r > 0.5
        ? spokeRim(tire, r, w, { spokes: 8, spokeW: 0.05, face: mats.chrome(), dish: mats.satin(), lip: mats.chrome(), depth: 0.05 })
        : spokeRim(tire, r, w, { spokes: 5, spokeW: 0.1, face: mats.chrome(), dish: mats.flat('#b9c0c8', { metalness: 0.8, roughness: 0.25 }), lip: mats.chrome() }),
    flames: [[0.12, 0.52, -2.2], [-0.12, 0.52, -2.2]],
  };
}

// ---------------- 2. Black 80s wedge supercar ----------------

function yellowPlate(text) {
  return canvasTex(128, 32, (g, w, h) => {
    g.fillStyle = '#f5c518';
    g.fillRect(0, 0, w, h);
    g.strokeStyle = '#222';
    g.lineWidth = 2;
    g.strokeRect(1, 1, w - 2, h - 2);
    g.fillStyle = '#111';
    g.font = 'bold 22px Arial, sans-serif';
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.fillText(text, w / 2, h / 2 + 1);
  });
}

export function buildWedge(body, color) {
  const add = adder(body);
  const black = mats.paint('#08090b', { metalness: 0.5, roughness: 0.16 });
  const trim = mats.flat('#141518', { roughness: 0.55 });
  const glass = mats.glass('#1b2533', { transparent: true, opacity: 0.9, side: THREE.DoubleSide });
  const stripe = mats.paint(color, { metalness: 0.6, roughness: 0.25 });
  const FZ = 1.45, RZ = -1.38, RF = 0.35, RR = 0.37;

  // Folded-paper wedge: sharp low nose, flat rising hood, long flat deck
  const s = silhouette(0.3, [[FZ, RF + 0.07, RF], [RZ, RR + 0.07, RR]], 2.22, [
    [2.33, 0.44],
    [2.27, 0.6],
    [1.9, 0.7],
    [0.74, 0.9],
    [-1.3, 0.96],
    [-2.2, 0.97],
    [-2.28, 0.9],
    [-2.3, 0.5],
    [-2.24, 0.3],
  ]);
  add(profileGeo(s, 1.86, 0.05), black);
  // Glasshouse: steep screen, short flat roof, buttressed rear
  const c = new THREE.Shape();
  [[0.78, 0.88], [0.02, 1.2], [-0.78, 1.22], [-1.32, 0.96], [0.78, 0.9]].forEach(([z, y], i) => (i ? c.lineTo(z, y) : c.moveTo(z, y)));
  add(profileGeo(c, 1.46, 0.03), glass);
  add(rb(1.38, 0.04, 0.82, 0.02), black, 0, 1.225, -0.38); // roof panel
  for (const f of [1, -1]) {
    // Sail panels from the roof down to the tail, and the B-pillar
    const sail = new THREE.Shape();
    [[-0.76, 1.22], [-2.08, 0.97], [-1.2, 0.95]].forEach(([z, y], i) => (i ? sail.lineTo(z, y) : sail.moveTo(z, y)));
    add(profileGeo(sail, 0.12, 0.02), black, f * 0.68, 0, 0);
    add(rb(0.02, 0.3, 0.1, 0.01), black, f * 0.735, 1.06, -0.62);
    // Belt-line pinstripes and a TURBO script on the doors
    add(new THREE.BoxGeometry(0.012, 0.022, 4.1), stripe, f * 0.935, 0.72, 0.05);
    add(new THREE.BoxGeometry(0.012, 0.012, 3.2), stripe, f * 0.935, 0.4, 0.05);
    const d = add(new THREE.PlaneGeometry(0.9, 0.22), new THREE.MeshBasicMaterial({ map: textDecal('TURBO', color), transparent: true }), f * 0.937, 0.58, 0.1);
    d.rotation.y = f * Math.PI / 2;
    // Engine air intake behind the door, door line, mirror
    add(rb(0.02, 0.16, 0.34, 0.01), trim, f * 0.93, 0.78, -1.05);
    add(new THREE.BoxGeometry(0.01, 0.5, 0.01), trim, f * 0.934, 0.68, -0.72);
    add(rb(0.12, 0.08, 0.14, 0.03), black, f * 0.83, 1.0, 0.55);
  }
  // Louvred engine cover between the sails
  for (let i = 0; i < 9; i++) {
    const z = -0.86 - i * 0.13, y = 1.19 - i * 0.026;
    const l = add(rb(1.2, 0.025, 0.1, 0.01), black, 0, y, z);
    l.rotation.x = -0.35;
  }
  // Hood: pop-up lamp shut lines and a vent
  for (const f of [1, -1]) add(new THREE.BoxGeometry(0.48, 0.005, 0.005), trim, f * 0.5, 0.715, 1.8);
  for (let i = 0; i < 4; i++) add(new THREE.BoxGeometry(0.5, 0.01, 0.03), trim, 0, 0.87 + i * 0.004, 0.92 + i * 0.07);
  // Nose: black spoiler, amber and white lamps, plate
  add(rb(1.9, 0.14, 0.24, 0.04), trim, 0, 0.36, 2.27);
  for (const f of [1, -1]) {
    add(rb(0.22, 0.06, 0.02, 0.01), mats.glow('#ffa21c'), f * 0.66, 0.5, 2.37);
    add(rb(0.14, 0.06, 0.02, 0.01), mats.glow('#fff6d8'), f * 0.42, 0.5, 2.375);
  }
  add(new THREE.PlaneGeometry(0.46, 0.11), new THREE.MeshBasicMaterial({ map: plateTex('TURBO') }), 0, 0.5, 2.385);
  // Tail: full-width lamp band, black panel, yellow plate, twin pipes
  add(rb(1.84, 0.34, 0.04, 0.02), trim, 0, 0.72, -2.36);
  for (const f of [1, -1]) {
    add(new THREE.PlaneGeometry(0.34, 0.16), mats.glow('#e0141e'), f * 0.62, 0.78, -2.385).rotation.y = Math.PI;
    add(new THREE.PlaneGeometry(0.16, 0.16), mats.glow('#ff9a1c'), f * 0.36, 0.78, -2.385).rotation.y = Math.PI;
    add(new THREE.CylinderGeometry(0.05, 0.05, 0.2, 12).rotateX(Math.PI / 2), mats.chrome(), f * 0.3, 0.36, -2.36);
  }
  add(new THREE.PlaneGeometry(0.46, 0.11), new THREE.MeshBasicMaterial({ map: yellowPlate('TURBO') }), 0, 0.6, -2.385).rotation.y = Math.PI;
  add(rb(1.9, 0.14, 0.22, 0.04), trim, 0, 0.44, -2.3);

  return {
    roofY: 1.3,
    axles: [
      { z: FZ, r: RF, w: 0.28, track: 0.8, steer: true },
      { z: RZ, r: RR, w: 0.34, track: 0.8, steer: false },
    ],
    tire: (r, w) => tireGeometry(r, w, { inner: 0.7 }),
    // Cross-spoke alloys
    rim: (tire, r, w) => {
      spokeRim(tire, r, w, { spokes: 14, spokeW: 0.022, face: mats.satin(), dish: mats.flat('#2b2e33', { metalness: 0.6 }), lip: mats.chrome(), hub: mats.chrome() });
      for (const f of [1, -1]) {
        for (let k = 0; k < 14; k++) {
          const ang = (k / 14) * Math.PI * 2 + 0.22;
          const sp = new THREE.Mesh(new THREE.BoxGeometry(0.03, r * 0.46, 0.022 * r * 2.2), mats.satin());
          sp.position.set(f * (w / 2 - 0.03), Math.cos(ang) * r * 0.33, Math.sin(ang) * r * 0.33);
          sp.rotation.x = ang + 0.45;
          tire.add(sp);
        }
      }
    },
    flames: [[0.3, 0.36, -2.4], [-0.3, 0.36, -2.4]],
  };
}

// ---------------- 3. 60s muscle coupe ----------------

export function buildGoat(body, color) {
  const add = adder(body);
  const paint = mats.paint(color, { metalness: 0.55, roughness: 0.2 });
  const chrome = mats.chrome();
  const dark = mats.flat('#0e0f12', { roughness: 0.6 });
  const glass = mats.glass('#22303c', { transparent: true, opacity: 0.75, side: THREE.DoubleSide });
  const FZ = 1.5, RZ = -1.42, R = 0.39;

  // Long hood, short deck, rear fenders kicking up behind the doors (coke bottle)
  const s = silhouette(0.34, [[FZ, R + 0.08, R], [RZ, R + 0.08, R]], 2.4, [
    [2.47, 0.52],
    [2.46, 0.9],
    [2.3, 0.96],
    [0.74, 0.97],
    [-0.7, 0.96],
    [-1.35, 1.01],
    [-2.3, 0.98],
    [-2.44, 0.9],
    [-2.47, 0.52],
    [-2.4, 0.34],
  ]);
  add(profileGeo(s, 1.92, 0.12), paint);
  // Hardtop roof with a raked screen and sloping C-pillars
  const c = new THREE.Shape();
  [[0.74, 0.96], [0.04, 1.4], [-0.92, 1.42], [-1.55, 0.99], [0.74, 0.99]].forEach(([z, y], i) => (i ? c.lineTo(z, y) : c.moveTo(z, y)));
  add(profileGeo(c, 1.6, 0.07), paint);
  // Glass: pillarless side windows with chrome surrounds, screen and rear window
  for (const f of [1, -1]) {
    for (const pts of [
      [[0.58, 1.02], [0.05, 1.36], [-0.5, 1.37], [-0.5, 1.02]],
      [[-0.56, 1.02], [-0.56, 1.37], [-0.9, 1.38], [-1.32, 1.02]],
    ]) {
      sidePoly(add, glass, pts, f * 0.805);
      tube(add, chrome, [...pts, pts[0]].map(([z, y]) => [f * 0.807, y, z]), 0.012);
    }
  }
  quad(add, glass, [0.72, 1.0], [0.06, 1.39], 0.72, 0.68);
  quad(add, glass, [-0.94, 1.4], [-1.5, 1.02], 0.68, 0.72);
  // Chrome trim: rocker mouldings, arch lips, drip rails, door handles
  for (const f of [1, -1]) {
    add(rb(0.04, 0.05, 3.3, 0.02), chrome, f * 0.965, 0.42, 0.02);
    for (const z of [FZ, RZ]) {
      const lip = add(new THREE.TorusGeometry(R + 0.08, 0.018, 6, 24, Math.PI), chrome, f * 0.965, R, z);
      lip.rotation.y = Math.PI / 2;
    }
    tube(add, chrome, [[f * 0.8, 1.41, 0.04], [f * 0.8, 1.425, -0.92]], 0.012);
    add(rb(0.03, 0.04, 0.16, 0.01), chrome, f * 0.965, 0.9, -0.3);
    // GTO-style tricolour badge on the front fender
    add(new THREE.PlaneGeometry(0.2, 0.05), mats.glow('#d91e2e'), f * 0.962, 0.66, 0.85).rotation.y = f * Math.PI / 2;
  }
  // Hood scoop
  add(rb(0.5, 0.08, 0.56, 0.03), paint, 0, 1.02, 1.3);
  add(rb(0.44, 0.04, 0.02, 0.01), dark, 0, 1.02, 1.585);
  // Front: stacked headlamps in chrome bezels, split recessed grilles, wrap bumper
  for (const f of [1, -1]) {
    add(rb(0.3, 0.46, 0.06, 0.03), chrome, f * 0.74, 0.72, 2.55);
    for (const y of [0.61, 0.83]) {
      add(new THREE.TorusGeometry(0.1, 0.02, 8, 20), chrome, f * 0.74, y, 2.585);
      add(new THREE.CircleGeometry(0.095, 20), mats.glow('#fff4d4'), f * 0.74, y, 2.58);
    }
    add(rb(0.5, 0.24, 0.05, 0.03), chrome, f * 0.31, 0.72, 2.55);
    add(rb(0.44, 0.18, 0.02, 0.02), dark, f * 0.31, 0.72, 2.58);
    for (let i = 0; i < 5; i++) add(new THREE.BoxGeometry(0.42, 0.008, 0.01), mats.satin(), f * 0.31, 0.65 + i * 0.035, 2.59);
    add(new THREE.CylinderGeometry(0.035, 0.035, 0.02, 12).rotateX(Math.PI / 2), mats.glow('#ffd28a'), f * 0.44, 0.72, 2.595); // parking lamp
  }
  add(rb(1.98, 0.18, 0.24, 0.06), chrome, 0, 0.45, 2.52);
  // Rear: chrome bumper, full-width louvred tail lamps
  add(rb(1.96, 0.16, 0.22, 0.06), chrome, 0, 0.47, -2.5);
  for (const f of [1, -1]) {
    add(rb(0.6, 0.12, 0.03, 0.02), mats.glow('#c8101e'), f * 0.48, 0.75, -2.57);
    for (let i = 0; i < 4; i++) add(new THREE.BoxGeometry(0.01, 0.12, 0.02), chrome, f * (0.24 + i * 0.16), 0.75, -2.585);
  }
  // Whip antenna on the right front fender
  const ant = add(new THREE.CylinderGeometry(0.006, 0.01, 1.0, 5), chrome, 0.78, 1.45, 1.35);
  ant.rotation.x = -0.12;

  return {
    roofY: 1.52,
    axles: [
      { z: FZ, r: R, w: 0.32, track: 0.8, steer: true },
      { z: RZ, r: R, w: 0.34, track: 0.8, steer: false },
    ],
    tire: (r, w) => tireGeometry(r, w, { inner: 0.66 }),
    // Rally wheels: slotted steel centre, chrome trim ring and cap, on redline tyres
    rim: (tire, r, w) => {
      spokeRim(tire, r, w, { spokes: 5, spokeW: 0.13, face: mats.flat('#4a4e55', { metalness: 0.6, roughness: 0.35 }), dish: mats.flat('#2a2d32', { metalness: 0.5 }), lip: mats.chrome(), hub: mats.chrome() });
      sidewallRing(tire, r, w, r * 0.8, r * 0.83, mats.glow('#c8102e'));
    },
    flames: [[0.45, 0.4, -2.65], [-0.45, 0.4, -2.65]],
  };
}

// ---------------- 4. Armoured mine-protected 4x4 ----------------

export function buildArmoured(body, color) {
  const add = adder(body);
  const paint = mats.paint(color, { metalness: 0.2, roughness: 0.55, clearcoat: 0.2 });
  const hull = mats.paint(shade(color, -0.28), { metalness: 0.2, roughness: 0.6, clearcoat: 0.1 });
  const steel = mats.flat('#2b2e33', { metalness: 0.6, roughness: 0.45 });
  const black = mats.flat('#121316', { roughness: 0.6 });
  const glass = mats.glass('#1c2630', { transparent: true, opacity: 0.85, side: THREE.DoubleSide });
  const R = 0.62, TR = 1.08, AX = [1.6, -1.55];

  // V-shaped lower hull that deflects blasts, running the length of the body
  const v = new THREE.Shape();
  [[-1.04, 1.78], [1.04, 1.78], [1.0, 1.3], [0.5, 0.98], [-0.5, 0.98], [-1.0, 1.3]].forEach(([x, y], i) => (i ? v.lineTo(x, y) : v.moveTo(x, y)));
  const vg = new THREE.ExtrudeGeometry(v, { depth: 4.1, bevelEnabled: false });
  add(vg, hull, 0, 0, -2.6);
  // Crew box at the back, cab, long angular armoured nose
  add(rb(2.02, 0.98, 2.95, 0.06), paint, 0, 2.25, -1.12);
  add(new THREE.CylinderGeometry(0.62, 0.7, 0.12, 20), paint, 0, 2.78, -0.7); // roof hatch dome
  add(rb(1.98, 0.9, 1.05, 0.06), paint, 0, 2.2, 0.85);
  const nose = silhouette(1.0, [], 2.95, [
    [3.0, 1.35],
    [2.92, 1.72],
    [2.35, 1.95],
    [1.36, 2.12],
    [1.36, 1.0],
  ]);
  add(profileGeo(nose, 1.86, 0.05), paint);
  add(rb(1.7, 0.18, 0.9, 0.04), hull, 0, 1.95, 2.0); // raised engine deck
  for (let i = 0; i < 5; i++) add(rb(1.4, 0.02, 0.08, 0.01), black, 0, 2.05 + i * 0.004, 1.65 + i * 0.16); // deck vents
  // Front armour: bumper block, chin plate, small inset lamps
  add(rb(1.9, 0.42, 0.34, 0.04), paint, 0, 1.3, 2.95);
  add(rb(1.5, 0.3, 0.06, 0.02), hull, 0, 1.05, 2.72);
  for (const f of [1, -1]) {
    add(rb(0.22, 0.1, 0.04, 0.02), mats.glow('#fff6d8'), f * 0.62, 1.58, 3.02);
    add(rb(0.1, 0.06, 0.03, 0.01), mats.glow('#ffa21c'), f * 0.84, 1.45, 3.13);
  }
  // Windscreen: two small armoured panes
  for (const f of [1, -1]) quad(add, glass, [1.39, 2.2], [1.36, 2.58], 0.42).position.x = f * 0.46;

  for (const f of [1, -1]) {
    const x = f * 1.012;
    // Cab door with window, hinges, handle and step
    sidePoly(add, glass, [[1.2, 2.24], [1.2, 2.56], [0.5, 2.56], [0.5, 2.24]], f * 0.995);
    add(new THREE.BoxGeometry(0.01, 0.95, 0.012), black, f * 0.994, 2.15, 0.35);
    for (const y of [1.95, 2.45]) add(rb(0.05, 0.12, 0.08, 0.02), steel, f * 1.0, y, 1.3);
    add(rb(0.03, 0.04, 0.16, 0.01), steel, f * 1.0, 2.1, 0.55);
    for (const y of [1.25, 1.5]) add(rb(0.34, 0.03, 0.14, 0.01), steel, f * 0.95, y, 0.78);
    // Mirror on an arm
    tube(add, steel, [[f * 0.99, 2.5, 1.32], [f * 1.2, 2.55, 1.4]], 0.02);
    add(rb(0.06, 0.28, 0.18, 0.02), black, f * 1.22, 2.5, 1.4);
    // Crew box: two windows with round ports
    for (const z of [-0.55, -1.75]) {
      sidePoly(add, glass, [[z + 0.45, 2.3], [z + 0.45, 2.62], [z - 0.45, 2.62], [z - 0.45, 2.3]], f * 1.015);
      add(rb(0.02, 0.36, 0.94, 0.02), steel, f * 1.005, 2.46, z);
      for (const dz of [-0.2, 0.2]) {
        const port = add(new THREE.CircleGeometry(0.1, 16), black, f * 1.022, 2.5, z + dz);
        port.rotation.y = f * Math.PI / 2;
      }
    }
    // Cooling fans in a mesh panel low on the crew box
    add(rb(0.02, 0.44, 1.7, 0.02), mats.flat('#7d838c', { metalness: 0.6, roughness: 0.4 }), f * 1.02, 1.98, -1.65);
    for (let k = 0; k < 4; k++) {
      const z = -2.28 + k * 0.42;
      const fan = add(new THREE.CircleGeometry(0.17, 20), black, f * 1.034, 1.98, z);
      fan.rotation.y = f * Math.PI / 2;
      for (let b = 0; b < 5; b++) {
        const blade = add(new THREE.BoxGeometry(0.01, 0.15, 0.05), steel, f * 1.04, 1.98, z);
        blade.rotation.x = (b / 5) * Math.PI * 2;
        blade.geometry.translate(0, 0.07, 0);
      }
    }
    // Stowage locker and hull bolts
    add(rb(0.03, 0.34, 0.8, 0.02), paint, f * 1.03, 1.52, 0.1);
    // Spare wheel carried on the flank between the axles
    const spare = new THREE.Mesh(tireGeometry(R, 0.44, { knobs: 22, inner: 0.62 }), black);
    spare.position.set(f * (TR + 0.14), 1.72, 0.05);
    body.add(spare);
    spokeRim(spare, R, 0.44, { spokes: 0, face: steel, dish: steel, lip: steel, hub: paint });
    add(rb(0.2, 0.2, 0.3, 0.03), steel, f * 1.08, 1.72, 0.05); // carrier
    // Tie-down points, lifting eyes on the roof
    for (const z of [-2.3, 0.9]) {
      const eye = add(new THREE.TorusGeometry(0.1, 0.035, 8, 16), steel, f * 0.75, 2.86, z);
      eye.rotation.y = Math.PI / 2;
      add(rb(0.12, 0.08, 0.2, 0.02), steel, f * 0.75, 2.77, z);
    }
    void x;
  }
  // Antennas, rear ladder, rear bumper with a step
  for (const [x, z, h] of [[0.5, 0.95, 0.9], [-0.7, -2.4, 0.7]]) add(new THREE.CylinderGeometry(0.008, 0.015, h, 5), black, x, 2.7 + h / 2, z);
  for (let i = 0; i < 5; i++) add(rb(0.5, 0.03, 0.04, 0.01), steel, -0.62, 1.85 + i * 0.16, -2.62);
  for (const f of [1, -1]) add(rb(0.04, 0.8, 0.04, 0.01), steel, -0.62 + f * 0.25, 2.18, -2.62);
  add(rb(2.06, 0.3, 0.3, 0.04), black, 0, 1.3, -2.72);
  add(rb(0.5, 0.03, 0.3, 0.01), steel, 0.5, 1.02, -2.78);
  for (const f of [1, -1]) add(rb(0.18, 0.1, 0.03, 0.01), mats.glow('#e0141e'), f * 0.85, 1.55, -2.62);
  // Running gear: axles, drive shaft, suspension arms
  for (const z of AX) add(new THREE.CylinderGeometry(0.1, 0.1, 2.1, 10).rotateZ(Math.PI / 2), black, 0, R, z);
  add(new THREE.CylinderGeometry(0.07, 0.07, 3.1, 8).rotateX(Math.PI / 2), black, 0, 0.8, 0.02);
  for (const f of [1, -1]) for (const z of AX) tube(add, black, [[f * 0.3, 1.0, z + 0.5], [f * 0.8, R + 0.05, z]], 0.05);

  return {
    roofY: 2.85,
    axles: AX.map((z, i) => ({ z, r: R, w: 0.5, track: TR, steer: i === 0 })),
    tire: (r, w) => tireGeometry(r, w, { knobs: 22, inner: 0.62 }),
    rim: (tire, r, w) => {
      spokeRim(tire, r, w, { spokes: 0, face: steel, dish: mats.flat('#8b9097', { metalness: 0.6, roughness: 0.4 }), lip: steel, hub: paint });
      for (const f of [1, -1]) for (let k = 0; k < 10; k++) {
        const ang = (k / 10) * Math.PI * 2;
        const b = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.02, 0.03, 6).rotateZ(Math.PI / 2), steel);
        b.position.set(f * (w / 2 - 0.01), Math.cos(ang) * r * 0.3, Math.sin(ang) * r * 0.3);
        tire.add(b);
      }
    },
    flames: [[0.5, 1.3, -2.85], [-0.5, 1.3, -2.85]],
  };
}
