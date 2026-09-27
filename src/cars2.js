import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

/**
 * Four detailed cars modelled on toy cars:
 *  - sixbysix: a black six-wheeled luxury off-road pickup (boxy SUV cab, bed, roll bar)
 *  - shark:    a shark-shaped hot rod with open jaws, fins and chrome exhausts
 *  - sixpack:  a spectraflame six-wheeler hatchback with an engine through the hood
 *  - dicerod:  a two-tone patina rat rod with dice air cleaners and whitewalls
 *
 * Each builder adds its parts to `body` (car faces +Z, wheels on y = 0) and
 * returns its wheel layout plus a few extras for buildCar().
 */

// ---------------- shared bits ----------------

let envTex = null;
/** A soft studio reflection so chrome and paint read as shiny without a scene environment. */
export function studioEnv() {
  if (envTex) return envTex;
  const face = (kind) => {
    const c = document.createElement('canvas');
    c.width = c.height = 64;
    const g = c.getContext('2d');
    if (kind === 'top') {
      g.fillStyle = '#f6f8ff';
      g.fillRect(0, 0, 64, 64);
    } else if (kind === 'bottom') {
      g.fillStyle = '#34383f';
      g.fillRect(0, 0, 64, 64);
    } else {
      const gr = g.createLinearGradient(0, 0, 0, 64);
      gr.addColorStop(0, '#cfdcf2');
      gr.addColorStop(0.46, '#ffffff');
      gr.addColorStop(0.54, '#7a808a');
      gr.addColorStop(1, '#2a2e35');
      g.fillStyle = gr;
      g.fillRect(0, 0, 64, 64);
      g.fillStyle = 'rgba(255,255,255,0.9)'; // softbox strips
      g.fillRect(10, 6, 8, 22);
      g.fillRect(44, 8, 6, 18);
    }
    return c;
  };
  envTex = new THREE.CubeTexture(['side', 'side', 'top', 'bottom', 'side', 'side'].map(face));
  envTex.colorSpace = THREE.SRGBColorSpace;
  envTex.needsUpdate = true;
  return envTex;
}

const mats = {
  chrome: () => new THREE.MeshStandardMaterial({ color: '#eef1f5', metalness: 1, roughness: 0.1, envMap: studioEnv() }),
  satin: () => new THREE.MeshStandardMaterial({ color: '#c9cdd3', metalness: 1, roughness: 0.35, envMap: studioEnv() }),
  paint: (color, o = {}) =>
    new THREE.MeshPhysicalMaterial({ color, metalness: 0.45, roughness: 0.3, clearcoat: 1, clearcoatRoughness: 0.08, envMap: studioEnv(), envMapIntensity: 0.9, ...o }),
  flat: (color, o = {}) => new THREE.MeshStandardMaterial({ color, roughness: 0.7, ...o }),
  glass: (color = '#1a2433', o = {}) => new THREE.MeshStandardMaterial({ color, metalness: 0.6, roughness: 0.05, envMap: studioEnv(), ...o }),
  glow: (color) => new THREE.MeshBasicMaterial({ color }),
};

function adder(body) {
  return (geo, mat, x = 0, y = 0, z = 0, parent = body) => {
    const m = new THREE.Mesh(geo, mat);
    m.position.set(x, y, z);
    m.castShadow = true;
    parent.add(m);
    return m;
  };
}

function canvasTex(w, h, draw) {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  draw(c.getContext('2d'), w, h);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 8;
  return t;
}

// Smooth piecewise lookup along the car
function table(rows) {
  return (z) => {
    if (z <= rows[0][0]) return rows[0][1];
    for (let i = 1; i < rows.length; i++) {
      if (z <= rows[i][0]) {
        const [z0, v0] = rows[i - 1], [z1, v1] = rows[i];
        const t = (z - z0) / (z1 - z0);
        return v0 + (v1 - v0) * t * t * (3 - 2 * t);
      }
    }
    return rows[rows.length - 1][1];
  };
}

const shade = (hex, k) => '#' + new THREE.Color(hex).lerp(new THREE.Color(k > 0 ? '#ffffff' : '#000000'), Math.abs(k)).getHexString();

/**
 * Lofted body: `section(z, a, out)` gives the outline point for a in
 * [-PI/2 (bottom) .. PI/2 (top)] on the +x side. Each half gets its own
 * side-view livery texture (u along the car, v = height / yMax); points with
 * a > plainAbove sample the top row of the texture.
 */
function loft(body, { z0, z1, step = 0.035, na = 36, section, material, yMax, plainAbove = 0.75, caps = true }) {
  const len = z1 - z0;
  for (const side of [1, -1]) {
    const pos = [], uv = [], idx = [];
    const zs = [];
    for (let z = z0; z < z1; z += step) zs.push(z);
    zs.push(z1);
    const p = new THREE.Vector3();
    for (const z of zs) {
      for (let j = 0; j <= na; j++) {
        const a = -Math.PI / 2 + (Math.PI * j) / na;
        section(z, a, p);
        pos.push(p.x * side, p.y, p.z);
        uv.push(side > 0 ? (z1 - z) / len : (z - z0) / len, a > plainAbove ? 0.985 : p.y / yMax);
      }
    }
    const row = na + 1;
    for (let i = 0; i < zs.length - 1; i++) {
      for (let j = 0; j < na; j++) {
        const a = i * row + j, b = a + 1, c = a + row, d = c + 1;
        if (side > 0) idx.push(a, b, c, b, d, c); // outward-facing
        else idx.push(a, c, b, b, c, d);
      }
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
    g.setIndex(idx);
    g.computeVertexNormals();
    const m = new THREE.Mesh(g, material(side));
    m.castShadow = true;
    body.add(m);
  }
  if (!caps) return;
  // Close the two ends
  for (const z of [z0, z1]) {
    const s = new THREE.Shape(), p = new THREE.Vector3();
    for (let j = 0; j <= 24; j++) {
      section(z, -Math.PI / 2 + (Math.PI * j) / 24, p);
      j === 0 ? s.moveTo(p.x, p.y) : s.lineTo(p.x, p.y);
    }
    for (let j = 24; j >= 0; j--) {
      section(z, -Math.PI / 2 + (Math.PI * j) / 24, p);
      s.lineTo(-p.x, p.y);
    }
    const m = new THREE.Mesh(new THREE.ShapeGeometry(s), material(1));
    m.material = m.material.clone();
    m.material.map = null;
    m.material.side = THREE.DoubleSide;
    m.position.z = z;
    body.add(m);
  }
}

/** Superellipse cross-section with a variable top (fender crest vs centre) and open wheel arches. */
function sectionFn({ W, belt, floor, top, arches = [], n = 3, crest = 0.72 }) {
  return (z, a, out) => {
    const w = W(z), yc = belt(z), fl = floor(z);
    const c = Math.cos(a), s = Math.sin(a);
    const x = w * Math.pow(Math.abs(c), 2 / n);
    const k = Math.pow(Math.abs(s), 2 / n);
    let y;
    if (s >= 0) {
      const u = w > 1e-3 ? Math.min(1, x / (w * crest)) : 0;
      const t = top(z, u * u * (3 - 2 * u));
      y = yc + (Math.max(t, yc) - yc) * k;
    } else {
      y = yc - (yc - fl) * k;
    }
    for (const [wz, r, h, minX] of arches) {
      const dz = z - wz;
      if (Math.abs(dz) < r && x > minX) y = Math.max(y, Math.min(yc + 0.3, h + Math.sqrt(r * r - dz * dz)));
    }
    return out.set(x, y, z);
  };
}

// ---------------- wheels ----------------

/** Tyre with rounded shoulders; optional off-road knobs. Axis along x. */
export function tireGeometry(r, w, { knobs = 0, inner = 0.62 } = {}) {
  const sh = Math.min(0.08, w * 0.25);
  const prof = [
    [r * inner, -w / 2],
    [r - sh, -w / 2],
    [r - sh * 0.3, -w / 2 + sh * 0.3],
    [r, -w / 2 + sh],
    [r, w / 2 - sh],
    [r - sh * 0.3, w / 2 - sh * 0.3],
    [r - sh, w / 2],
    [r * inner, w / 2],
  ].map(([a, b]) => new THREE.Vector2(a, b));
  let g = new THREE.LatheGeometry(prof, 28).rotateZ(Math.PI / 2);
  if (knobs) {
    const parts = [g.toNonIndexed()];
    for (let i = 0; i < knobs; i++) {
      const ang = (i / knobs) * Math.PI * 2;
      for (const off of i % 2 ? [-w * 0.24, w * 0.2] : [-w * 0.18, w * 0.26]) {
        const b = new THREE.BoxGeometry(w * 0.34, 0.05, r * 0.2).toNonIndexed();
        b.translate(off, r + 0.02, 0);
        b.rotateX(ang);
        parts.push(b);
      }
      // Shoulder lugs
      for (const sx of [-1, 1]) {
        const b = new THREE.BoxGeometry(0.05, r * 0.16, r * 0.14).toNonIndexed();
        b.translate(sx * (w / 2 + 0.005), r - r * 0.09, 0);
        b.rotateX(ang + (i % 2 ? 0.1 : -0.1));
        parts.push(b);
      }
    }
    for (const p of parts) p.deleteAttribute('uv');
    g = mergeGeometries(parts);
    g.computeVertexNormals();
  }
  return g;
}

/** Spoked rim on both faces of a tyre. */
function spokeRim(tire, r, w, { spokes = 5, face, dish, lip = null, spokeW = 0.1, hub = null, depth = 0.02 }) {
  for (const f of [1, -1]) {
    const x = f * (w / 2 - depth);
    const d = new THREE.Mesh(new THREE.CylinderGeometry(r * 0.6, r * 0.6, 0.02, 24).rotateZ(Math.PI / 2), dish);
    d.position.x = x - f * 0.02;
    tire.add(d);
    for (let k = 0; k < spokes; k++) {
      const ang = (k / spokes) * Math.PI * 2;
      const s = new THREE.Mesh(new THREE.BoxGeometry(0.035, r * 0.46, spokeW * r * 2.2), face);
      s.position.set(x, Math.cos(ang) * r * 0.33, Math.sin(ang) * r * 0.33);
      s.rotation.x = ang;
      tire.add(s);
    }
    const h = new THREE.Mesh(new THREE.CylinderGeometry(r * 0.16, r * 0.2, 0.06, 14).rotateZ(-f * Math.PI / 2), hub || face);
    h.position.x = x + f * 0.02;
    tire.add(h);
    const l = new THREE.Mesh(new THREE.TorusGeometry(r * 0.6, 0.022, 6, 28).rotateY(Math.PI / 2), lip || face);
    l.position.x = x;
    tire.add(l);
  }
}

/** Flat ring on both tyre sidewalls (whitewalls, redlines). */
function sidewallRing(tire, r, w, r0, r1, mat) {
  for (const f of [1, -1]) {
    const ring = new THREE.Mesh(new THREE.RingGeometry(r0, r1, 32), mat);
    ring.rotation.y = f * Math.PI / 2;
    ring.position.x = f * (w / 2 + 0.003);
    tire.add(ring);
  }
}

// ---------------- 1. Six-wheeled off-road pickup ----------------

function carbonTex() {
  const t = canvasTex(32, 32, (g) => {
    for (let y = 0; y < 4; y++) for (let x = 0; x < 4; x++) {
      g.fillStyle = (x + y) % 2 ? '#1c1e22' : '#26292e';
      g.fillRect(x * 8, y * 8, 8, 8);
    }
  });
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(16, 5);
  return t;
}

function plateTex(text) {
  return canvasTex(128, 32, (g, w, h) => {
    g.fillStyle = '#f4f4f0';
    g.fillRect(0, 0, w, h);
    g.fillStyle = '#1f4fbf';
    g.fillRect(0, 0, 14, h);
    g.strokeStyle = '#222';
    g.lineWidth = 2;
    g.strokeRect(1, 1, w - 2, h - 2);
    g.fillStyle = '#111';
    g.font = 'bold 22px Arial, sans-serif';
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.fillText(text, w / 2 + 6, h / 2 + 1);
  });
}

export function buildSixBySix(body, accent) {
  const add = adder(body);
  const rb = (w, h, d, r = 0.06) => new RoundedBoxGeometry(w, h, d, 3, r);
  const black = mats.paint(accent, { metalness: 0.5, roughness: 0.26, envMapIntensity: 0.6 }); // body in the player's colour
  const trim = mats.flat('#15171b', { roughness: 0.5 });
  const carbon = new THREE.MeshStandardMaterial({ map: carbonTex(), roughness: 0.35, metalness: 0.3, envMap: studioEnv(), envMapIntensity: 0.5 });
  const chrome = mats.chrome();
  const glass = mats.glass('#16202c', { transparent: true, opacity: 0.92 });
  const R = 0.56, TR = 1.04, AX = [1.55, -0.88, -2.02];

  // Lower body, flat hood on high fenders, upright cab, pickup bed
  add(rb(1.84, 0.64, 4.98, 0.08), black, 0, 1.07, -0.08);
  add(rb(1.8, 0.2, 1.42, 0.05), black, 0, 1.46, 1.72); // hood
  add(rb(1.86, 0.96, 1.96, 0.09), black, 0, 1.84, 0.05); // cab
  add(rb(1.78, 0.06, 1.85, 0.03), black, 0, 2.34, 0.05); // roof skin
  // Bed: side rails and tailgate above the lower body
  for (const x of [0.88, -0.88]) add(rb(0.09, 0.3, 1.62, 0.03), black, x, 1.52, -1.74);
  add(rb(1.84, 0.3, 0.09, 0.03), black, 0, 1.52, -2.52);
  add(new THREE.BoxGeometry(1.66, 0.02, 1.58), mats.flat('#1d1f23', { roughness: 0.9 }), 0, 1.4, -1.74); // bed liner
  // Glass: side windows (split by the B-pillar), near-upright windscreen, rear window
  for (const f of [1, -1]) {
    for (const [z0, z1] of [[0.12, 0.92], [-0.8, 0.02]]) {
      const pane = add(new THREE.PlaneGeometry(z1 - z0, 0.56), glass, f * 0.935, 2.0, (z0 + z1) / 2);
      pane.rotation.y = f * Math.PI / 2;
    }
    // Door shut lines and handles
    for (const z of [1.0, 0.06, -0.88]) add(new THREE.BoxGeometry(0.01, 1.3, 0.012), trim, f * 0.93, 1.66, z);
    add(new THREE.BoxGeometry(0.03, 0.04, 0.16), chrome, f * 0.945, 1.72, 0.72);
    add(new THREE.BoxGeometry(0.03, 0.04, 0.16), chrome, f * 0.945, 1.72, -0.2);
    // Mirror
    add(new THREE.BoxGeometry(0.06, 0.05, 0.05), trim, f * 0.98, 1.82, 0.96);
    add(rb(0.09, 0.2, 0.26, 0.03), black, f * 1.06, 1.86, 0.96);
    // Chrome running board between the front and middle wheels
    add(rb(0.26, 0.05, 1.2, 0.02), chrome, f * 1.0, 0.8, 0.34);
    // Fender-top indicators (a signature of the boxy off-roader)
    add(rb(0.16, 0.08, 0.2, 0.02), mats.glow('#ffb347'), f * 0.8, 1.6, 2.28);
    // Tail light cluster
    add(rb(0.08, 0.34, 0.2, 0.02), mats.glow('#ff2a2a'), f * 0.86, 1.22, -2.58);
  }
  const ws = add(new THREE.PlaneGeometry(1.62, 0.64), glass, 0, 1.98, 1.04);
  ws.rotation.x = -0.1;
  add(new THREE.PlaneGeometry(1.5, 0.5), glass, 0, 2.0, -0.935).rotation.y = Math.PI;
  // Roof light bar
  add(rb(1.5, 0.12, 0.18, 0.03), trim, 0, 2.43, 0.9);
  for (let i = 0; i < 6; i++) add(new THREE.BoxGeometry(0.16, 0.06, 0.02), mats.glow('#f4f8ff'), -0.55 + i * 0.22, 2.43, 1.0);
  // Roll bar over the bed
  const bar = mats.flat('#101114', { roughness: 0.35, metalness: 0.4 });
  for (const f of [1, -1]) {
    const c = new THREE.CatmullRomCurve3([new THREE.Vector3(f * 0.8, 1.66, -2.45), new THREE.Vector3(f * 0.8, 2.05, -1.55), new THREE.Vector3(f * 0.78, 2.28, -1.02)]);
    add(new THREE.TubeGeometry(c, 16, 0.045, 8), bar);
  }
  add(new THREE.CylinderGeometry(0.045, 0.045, 1.56, 8).rotateZ(Math.PI / 2), bar, 0, 2.28, -1.02);
  add(new THREE.CylinderGeometry(0.035, 0.035, 1.6, 8).rotateZ(Math.PI / 2), bar, 0, 1.9, -1.62);

  // Front: grille with chrome slats, round headlamps, bumper with fog lamps and plate
  add(rb(1.02, 0.44, 0.06, 0.02), trim, 0, 1.2, 2.39);
  for (let i = 0; i < 3; i++) add(rb(0.96, 0.05, 0.04, 0.015), chrome, 0, 1.08 + i * 0.12, 2.42);
  add(new THREE.CylinderGeometry(0.09, 0.09, 0.03, 20).rotateX(Math.PI / 2), chrome, 0, 1.2, 2.44);
  for (const f of [1, -1]) {
    add(new THREE.TorusGeometry(0.15, 0.03, 8, 24), chrome, f * 0.68, 1.22, 2.4);
    add(new THREE.CircleGeometry(0.14, 20), mats.glow('#fff5d8'), f * 0.68, 1.22, 2.405);
    add(new THREE.CircleGeometry(0.05, 12), mats.glow('#fffdf0'), f * 0.58, 0.93, 2.61);
  }
  add(rb(1.96, 0.3, 0.3, 0.06), trim, 0, 0.92, 2.46);
  add(new THREE.PlaneGeometry(0.52, 0.12), new THREE.MeshBasicMaterial({ map: plateTex('6X6') }), 0, 0.92, 2.615);
  add(rb(1.9, 0.26, 0.2, 0.05), trim, 0, 0.9, -2.62); // rear bumper

  // Carbon flares over every wheel
  for (const z of AX) {
    const s = new THREE.Shape();
    const ro = R + 0.2, ri = R + 0.06;
    s.absarc(0, 0, ro, 0.05, Math.PI - 0.05, false);
    s.absarc(0, 0, ri, Math.PI - 0.05, 0.05, true);
    const g = new THREE.ExtrudeGeometry(s, { depth: 0.36, bevelEnabled: true, bevelSize: 0.02, bevelThickness: 0.02, bevelSegments: 1 }).rotateY(-Math.PI / 2);
    for (const f of [1, -1]) add(g, carbon, f > 0 ? TR + 0.24 : -TR + 0.12, R + 0.02, z);
  }
  // Flare strip joining the two rear arches
  for (const f of [1, -1]) add(rb(0.34, 0.12, 0.5, 0.02), carbon, f * (TR + 0.06), R + 0.66, -1.45);

  return {
    roofY: 2.5,
    axles: AX.map((z, i) => ({ z, r: R, w: 0.46, track: TR, steer: i === 0 })),
    tire: (r, w) => tireGeometry(r, w, { knobs: 18, inner: 0.66 }),
    rim: (tire, r, w) => {
      spokeRim(tire, r, w, { spokes: 8, spokeW: 0.07, face: mats.flat('#2a2c31', { metalness: 0.6, roughness: 0.35 }), dish: mats.flat('#15161a'), lip: mats.flat(accent, { metalness: 0.4, roughness: 0.3 }) });
      // Beadlock bolt ring
      for (const f of [1, -1]) for (let k = 0; k < 12; k++) {
        const ang = (k / 12) * Math.PI * 2;
        const b = new THREE.Mesh(new THREE.CylinderGeometry(0.018, 0.018, 0.02, 6).rotateZ(Math.PI / 2), mats.satin());
        b.position.set(f * (w / 2 + 0.005), Math.cos(ang) * r * 0.66, Math.sin(ang) * r * 0.66);
        tire.add(b);
      }
    },
    flames: [[0.5, 0.75, -2.7], [-0.5, 0.75, -2.7]],
  };
}

// ---------------- 2. Shark hot rod ----------------

function sharkLivery(color, noseLeft) {
  const Z0 = -2.2, Z1 = 2.4, L = Z1 - Z0, YM = 1.35;
  return canvasTex(1024, 320, (g, W, H) => {
    const px = (z) => (noseLeft ? (Z1 - z) / L : (z - Z0) / L) * W;
    const py = (y) => (1 - y / YM) * H;
    const gr = g.createLinearGradient(0, 0, 0, H);
    gr.addColorStop(0, shade(color, 0.28));
    gr.addColorStop(0.45, color);
    gr.addColorStop(1, shade(color, -0.35));
    g.fillStyle = gr;
    g.fillRect(0, 0, W, H);
    // Pinstripe swooshes: head to tail
    g.lineCap = 'round';
    for (const [col, lw, dy] of [['#9fd8ff', 9, 0], ['#ffffff', 4, 0]]) {
      g.strokeStyle = col;
      g.lineWidth = lw;
      g.beginPath();
      g.moveTo(px(2.05), py(1.02 + dy));
      g.bezierCurveTo(px(1.2), py(1.2), px(0.4), py(0.95), px(-0.4), py(0.9));
      g.bezierCurveTo(px(-1.1), py(0.86), px(-1.6), py(0.8), px(-2.1), py(0.74));
      g.stroke();
      g.beginPath();
      g.moveTo(px(1.55), py(0.7));
      g.bezierCurveTo(px(1.0), py(0.84), px(0.6), py(0.62), px(-0.1), py(0.64));
      g.stroke();
    }
    // Gill slits
    g.strokeStyle = '#ffffff';
    g.lineWidth = 4;
    for (let i = 0; i < 3; i++) {
      const z = 1.18 - i * 0.13;
      g.beginPath();
      g.moveTo(px(z), py(0.95));
      g.quadraticCurveTo(px(z - 0.07), py(0.8), px(z), py(0.64));
      g.stroke();
    }
    // Angry eye: orange with a black slit and a white brow line
    const ex = px(1.93), ey = py(0.97);
    const dir = noseLeft ? -1 : 1;
    g.fillStyle = '#111';
    g.beginPath();
    g.moveTo(ex - dir * 38, ey - 24);
    g.lineTo(ex + dir * 34, ey - 6);
    g.lineTo(ex - dir * 30, ey + 24);
    g.closePath();
    g.fill();
    g.fillStyle = '#ff8a1e';
    g.beginPath();
    g.moveTo(ex - dir * 28, ey - 16);
    g.lineTo(ex + dir * 24, ey - 4);
    g.lineTo(ex - dir * 22, ey + 16);
    g.closePath();
    g.fill();
    g.fillStyle = '#111';
    g.fillRect(ex - 4, ey - 14, 8, 27);
    g.strokeStyle = '#ffffff';
    g.lineWidth = 5;
    g.beginPath();
    g.moveTo(ex - dir * 40, ey - 30);
    g.quadraticCurveTo(ex, ey - 34, ex + dir * 34, ey - 12);
    g.stroke();
    // Dark mouth line under the snout
    g.fillStyle = '#0a0a0c';
    g.beginPath();
    g.moveTo(px(2.3), py(0.66));
    g.quadraticCurveTo(px(1.8), py(0.5), px(1.2), py(0.56));
    g.lineTo(px(1.2), py(0.46));
    g.quadraticCurveTo(px(1.8), py(0.38), px(2.3), py(0.56));
    g.closePath();
    g.fill();
  });
}

export function buildShark(body, color) {
  const add = adder(body);
  const Z0 = -2.2, Z1 = 2.4;
  const W = table([[-2.2, 0.1], [-1.6, 0.28], [-0.8, 0.46], [0.3, 0.6], [1.2, 0.56], [1.9, 0.42], [2.25, 0.2], [2.4, 0.03]]);
  const Hh = table([[-2.2, 0.1], [-1.6, 0.2], [-0.8, 0.28], [0.3, 0.42], [1.2, 0.42], [1.9, 0.34], [2.25, 0.2], [2.4, 0.03]]);
  const C = table([[-2.2, 0.72], [-1.2, 0.68], [0.3, 0.8], [1.2, 0.84], [1.9, 0.82], [2.4, 0.74]]);
  // Round section, but the snout's underside is lifted to open the jaws
  const section = (z, a, out) => {
    const w = W(z), h = Hh(z), c = C(z);
    const x = w * Math.cos(a);
    let y = c + h * Math.sin(a);
    if (a < 0 && z > 1.25) {
      const t = Math.min(1, (z - 1.25) / 0.35);
      y = c + h * Math.sin(a) * (1 - 0.62 * t);
    }
    return out.set(x, y, z);
  };
  const liv = [sharkLivery(color, true), sharkLivery(color, false)];
  const skin = (tex) => mats.paint('#ffffff', { map: tex, metalness: 0.35, roughness: 0.28 });
  const skins = [skin(liv[0]), skin(liv[1])];
  loft(body, { z0: Z0, z1: Z1, section, material: (side) => skins[side > 0 ? 0 : 1], yMax: 1.35, plainAbove: 1.2 });
  const paint = mats.paint(color, { metalness: 0.4, roughness: 0.28 });
  const chrome = mats.chrome();

  // Lower jaw and the dark inside of the open mouth
  const jaw = add(new THREE.SphereGeometry(1, 24, 12), paint, 0, 0.5, 1.66);
  jaw.scale.set(0.34, 0.1, 0.56);
  const mouth = add(new THREE.SphereGeometry(1, 20, 10), mats.flat('#12070a'), 0, 0.62, 1.6);
  mouth.scale.set(0.33, 0.12, 0.5);
  // Teeth: upper row hanging from the snout, lower row from the jaw
  const toothMat = new THREE.MeshStandardMaterial({ color: '#f4f4f4', metalness: 0.9, roughness: 0.15, envMap: studioEnv() });
  const tooth = new THREE.ConeGeometry(0.065, 0.22, 6);
  for (const f of [1, -1]) {
    for (let i = 0; i < 5; i++) {
      const z = 1.32 + i * 0.17, x = f * Math.max(0.05, W(z) * 0.78 - 0.04);
      const up = add(tooth, toothMat, x, C(z) - Hh(z) * 0.38 - 0.08, z);
      up.rotation.x = Math.PI;
      if (i < 4) add(tooth, toothMat, x * 0.92, 0.6, z + 0.09);
    }
  }
  // Dorsal fin and tail fin
  const fin = new THREE.Shape();
  fin.moveTo(0.55, 0);
  fin.quadraticCurveTo(0.25, 0.35, -0.35, 0.78);
  fin.quadraticCurveTo(-0.3, 0.35, -0.45, 0);
  fin.closePath();
  const finGeo = new THREE.ExtrudeGeometry(fin, { depth: 0.08, bevelEnabled: true, bevelSize: 0.04, bevelThickness: 0.04, bevelSegments: 3 }).rotateY(-Math.PI / 2).translate(0.04, 0, 0);
  add(finGeo, paint, 0, C(0.15) + Hh(0.15) - 0.06, 0.15);
  const tail = new THREE.Shape();
  tail.moveTo(0.1, 0.05);
  tail.quadraticCurveTo(-0.35, 0.2, -0.75, 0.55);
  tail.quadraticCurveTo(-0.55, 0.15, -0.48, -0.02);
  tail.quadraticCurveTo(-0.62, -0.25, -0.95, -0.46);
  tail.quadraticCurveTo(-0.4, -0.3, 0.1, -0.08);
  tail.closePath();
  add(new THREE.ExtrudeGeometry(tail, { depth: 0.07, bevelEnabled: true, bevelSize: 0.03, bevelThickness: 0.03, bevelSegments: 2 }).rotateY(-Math.PI / 2).translate(0.035, 0, 0), paint, 0, 0.72, -2.05);
  // Little pectoral fins behind the jaws
  for (const f of [1, -1]) {
    const pf = new THREE.Shape();
    pf.moveTo(0, 0);
    pf.quadraticCurveTo(-0.2, -0.05, -0.45, -0.28);
    pf.quadraticCurveTo(-0.1, -0.2, 0.2, -0.04);
    pf.closePath();
    const m = add(new THREE.ExtrudeGeometry(pf, { depth: 0.04, bevelEnabled: false }).rotateY(-Math.PI / 2), paint, f * 0.5, 0.58, 0.75);
    m.rotation.z = f * 0.5;
  }
  // Open cockpit with a chrome seat
  const pit = add(new THREE.SphereGeometry(1, 20, 10, 0, Math.PI * 2, 0, Math.PI / 2), mats.flat('#0b0c10'), 0, C(0.95) + Hh(0.95) - 0.1, 0.9);
  pit.scale.set(0.24, 0.1, 0.34);
  add(new RoundedBoxGeometry(0.26, 0.2, 0.08, 2, 0.03), chrome, 0, C(0.95) + Hh(0.95) - 0.02, 0.72);

  // Big chrome engine through the rear of the body
  add(new RoundedBoxGeometry(1.1, 0.42, 0.95, 3, 0.05), chrome, 0, 0.58, -0.78);
  for (const f of [1, -1]) {
    add(new RoundedBoxGeometry(0.2, 0.18, 0.95, 2, 0.04), chrome, f * 0.47, 0.86, -0.78); // valve covers
    for (let i = 0; i < 4; i++) add(new THREE.SphereGeometry(0.075, 12, 8), chrome, f * 0.56, 0.44, -0.44 - i * 0.22);
    for (let i = 0; i < 5; i++) add(new THREE.BoxGeometry(0.02, 0.2, 0.05), mats.satin(), f * 0.575, 0.62, -0.4 - i * 0.18);
  }
  // Headers sweeping up and back into four stacked exhausts
  const exhausts = [];
  for (const f of [1, -1]) {
    for (const [dx, dy] of [[0.0, 0.0], [0.1, -0.16]]) {
      const x = f * (0.3 + dx), yTop = 1.34 + dy;
      const c = new THREE.CatmullRomCurve3([
        new THREE.Vector3(f * 0.5, 0.8, -0.45 - dx),
        new THREE.Vector3(f * 0.52, 1.1 + dy * 0.5, -0.75),
        new THREE.Vector3(x, yTop, -1.2),
        new THREE.Vector3(x, yTop, -1.75),
      ]);
      add(new THREE.TubeGeometry(c, 24, 0.07, 10), chrome);
      // Ribbed tip
      add(new THREE.CylinderGeometry(0.085, 0.085, 0.6, 14).rotateX(Math.PI / 2), mats.satin(), x, yTop, -2.05);
      for (let i = 0; i < 4; i++) add(new THREE.TorusGeometry(0.088, 0.012, 6, 16), chrome, x, yTop, -1.82 - i * 0.14);
      exhausts.push([x, yTop, -2.45]);
    }
  }
  return {
    roofY: 1.95,
    axles: [
      { z: 1.3, r: 0.33, w: 0.28, track: 0.64, steer: true },
      { z: -1.2, r: 0.43, w: 0.42, track: 0.8, steer: false },
    ],
    tire: (r, w) => tireGeometry(r, w, { inner: 0.64 }),
    rim: (tire, r, w) => spokeRim(tire, r, w, { spokes: 5, spokeW: 0.13, face: mats.chrome(), dish: mats.flat('#101114'), lip: mats.chrome() }),
    flames: exhausts.slice(0, 2).concat(exhausts.slice(2)).filter((_, i) => i % 2 === 0),
  };
}

// ---------------- 3. Spectraflame six-wheeler ----------------

function sparkleTex() {
  const t = canvasTex(64, 64, (g) => {
    g.fillStyle = '#9a9ea6';
    g.fillRect(0, 0, 64, 64);
    for (let i = 0; i < 500; i++) {
      const v = 150 + Math.floor(Math.random() * 105);
      g.fillStyle = `rgb(${v},${v},${v + 4})`;
      g.fillRect(Math.random() * 64, Math.random() * 64, 2, 2);
    }
  });
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(3, 3);
  return t;
}

function profileGeo(shape, width, bevel = 0.1) {
  const g = new THREE.ExtrudeGeometry(shape, { depth: width - bevel * 2, bevelEnabled: true, bevelThickness: bevel, bevelSize: bevel, bevelSegments: 3, curveSegments: 16 });
  g.rotateY(-Math.PI / 2);
  g.translate(width / 2 - bevel, 0, 0);
  return g;
}

export function buildSixPack(body, color) {
  const add = adder(body);
  // Candy paint that still reads as the chosen colour (full metalness turned it muddy)
  const spectra = mats.paint(color, { metalness: 0.65, roughness: 0.2, clearcoat: 1, clearcoatRoughness: 0.05, envMapIntensity: 1 });
  const chrome = mats.chrome();
  const cast = new THREE.MeshStandardMaterial({ color: '#f2f4f8', metalness: 1, roughness: 0.3, map: sparkleTex(), envMap: studioEnv(), envMapIntensity: 1.3 });
  const dark = mats.flat('#0d0e11');
  const glass = mats.glass('#2a5d6a', { transparent: true, opacity: 0.8 });
  const FZ = [1.72, 0.84], RZ = -1.45, RF = 0.38, RR = 0.44;

  // Side silhouette: long hood, cut-off Kamm tail, arches for three axles
  const s = new THREE.Shape();
  const base = 0.42;
  s.moveTo(-2.28, base);
  const arch = (zc, R, yc) => {
    s.lineTo(zc - R, base);
    s.absarc(zc, yc, R, Math.PI, 0, true);
  };
  arch(RZ, RR + 0.07, RR);
  // Tandem front wheels share one long opening
  const Rf = RF + 0.07, dz = (FZ[0] - FZ[1]) / 2;
  const hy = Math.sqrt(Math.max(0, Rf * Rf - dz * dz));
  s.lineTo(FZ[1] - Rf, base);
  s.absarc(FZ[1], RF, Rf, Math.PI, Math.atan2(hy, dz), true);
  s.absarc(FZ[0], RF, Rf, Math.PI - Math.atan2(hy, dz), 0, true);
  s.lineTo(2.34, base);
  s.lineTo(2.4, 0.66);
  s.lineTo(2.36, 0.94);
  s.lineTo(1.9, 1.02);
  s.lineTo(0.45, 1.06);
  s.lineTo(-1.95, 1.08);
  s.lineTo(-2.12, 1.04);
  s.lineTo(-2.3, 0.86);
  s.closePath();
  add(profileGeo(s, 1.86, 0.12), spectra);
  // Cabin: raked windscreen, flat roof, steep hatch
  const c = new THREE.Shape();
  c.moveTo(0.46, 1.0);
  c.lineTo(-0.1, 1.56);
  c.lineTo(-1.32, 1.6);
  c.lineTo(-2.02, 1.1);
  c.lineTo(-2.04, 1.0);
  c.closePath();
  add(profileGeo(c, 1.62, 0.08), spectra);
  // Glass: side windows (with the distinctive rear quarter), windscreen, hatch
  for (const f of [1, -1]) {
    for (const pts of [
      [[0.3, 1.14], [-0.1, 1.5], [-0.72, 1.52], [-0.72, 1.14]],
      [[-0.82, 1.14], [-0.82, 1.52], [-1.26, 1.53], [-1.72, 1.2], [-1.55, 1.14]],
    ]) {
      const sh = new THREE.Shape();
      pts.forEach(([z, y], i) => (i ? sh.lineTo(z, y) : sh.moveTo(z, y)));
      sh.closePath();
      const m = add(new THREE.ShapeGeometry(sh), glass, f * 0.813, 0, 0);
      m.rotation.y = f > 0 ? -Math.PI / 2 : Math.PI / 2;
      if (f < 0) m.scale.x = -1;
    }
  }
  const quad = (a, b, w, mat) => {
    const g = new THREE.BufferGeometry();
    const v = [-w, a[1], a[0], w, a[1], a[0], w, b[1], b[0], -w, b[1], b[0]];
    g.setAttribute('position', new THREE.Float32BufferAttribute(v, 3));
    g.setIndex([0, 1, 2, 0, 2, 3]);
    g.computeVertexNormals();
    const m = new THREE.Mesh(g, mat);
    m.material.side = THREE.DoubleSide;
    body.add(m);
  };
  quad([0.43, 1.08], [-0.05, 1.54], 0.7, glass);
  quad([-1.4, 1.575], [-1.98, 1.16], 0.66, glass);

  // Engine bursting through the hood: block, V valve covers, twin intakes
  add(new THREE.BoxGeometry(1.1, 0.06, 1.4), dark, 0, 1.075, 1.2);
  add(new RoundedBoxGeometry(0.62, 0.22, 1.2, 2, 0.04), cast, 0, 1.16, 1.18);
  for (const f of [1, -1]) {
    const vc = add(new RoundedBoxGeometry(0.28, 0.14, 1.15, 2, 0.04), cast, f * 0.3, 1.26, 1.15);
    vc.rotation.z = -f * 0.4;
    for (let i = 0; i < 7; i++) {
      const r = add(new THREE.BoxGeometry(0.3, 0.03, 0.04), cast, f * 0.31, 1.33, 0.7 + i * 0.15);
      r.rotation.z = -f * 0.4;
    }
    add(new RoundedBoxGeometry(0.3, 0.3, 0.34, 2, 0.05), cast, f * 0.2, 1.32, 1.98); // intake stacks
    add(new THREE.BoxGeometry(0.24, 0.02, 0.28), dark, f * 0.2, 1.475, 1.98);
  }
  // Front and rear: chrome bumpers, grille, lamps
  add(new RoundedBoxGeometry(1.92, 0.14, 0.2, 2, 0.05), chrome, 0, 0.5, 2.56);
  add(new RoundedBoxGeometry(1.9, 0.14, 0.2, 2, 0.05), chrome, 0, 0.5, -2.46);
  add(new THREE.BoxGeometry(1.5, 0.26, 0.04), dark, 0, 0.78, 2.525);
  for (let i = 0; i < 4; i++) add(new THREE.BoxGeometry(1.46, 0.02, 0.02), mats.satin(), 0, 0.68 + i * 0.065, 2.55);
  for (const f of [1, -1]) {
    add(new THREE.TorusGeometry(0.1, 0.022, 8, 20), chrome, f * 0.6, 0.78, 2.555);
    add(new THREE.CircleGeometry(0.09, 18), mats.glow('#fff3cf'), f * 0.6, 0.78, 2.56);
    add(new THREE.BoxGeometry(0.34, 0.12, 0.03), mats.glow('#ff2a2a'), f * 0.62, 0.8, -2.43);
    add(new RoundedBoxGeometry(0.12, 0.1, 1.28, 2, 0.04), chrome, f * 0.95, 0.46, -0.34); // side rocker trim
    add(new THREE.BoxGeometry(0.04, 0.03, 0.14), chrome, f * 0.935, 0.95, -0.08); // door handle
  }
  return {
    roofY: 1.72,
    axles: [
      { z: FZ[0], r: RF, w: 0.3, track: 0.8, steer: true },
      { z: FZ[1], r: RF, w: 0.3, track: 0.8, steer: true },
      { z: RZ, r: RR, w: 0.36, track: 0.82, steer: false },
    ],
    tire: (r, w) => tireGeometry(r, w, { inner: 0.66 }),
    rim: (tire, r, w) => {
      spokeRim(tire, r, w, { spokes: 5, spokeW: 0.09, face: mats.chrome(), dish: mats.flat('#1b1c20'), lip: mats.chrome() });
      sidewallRing(tire, r, w, r * 0.8, r * 0.84, mats.glow('#c8102e')); // redline
    },
    flames: [[0.4, 0.5, -2.6], [-0.4, 0.5, -2.6]],
  };
}

// ---------------- 4. Dice rat rod ----------------

function ratLivery(color, noseLeft) {
  const Z0 = -2.25, Z1 = 2.32, L = Z1 - Z0, YM = 1.1;
  let seed = noseLeft ? 7 : 7; // same patina on both sides, mirrored
  const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  return canvasTex(1024, 256, (g, W, H) => {
    const px = (z) => (noseLeft ? (Z1 - z) / L : (z - Z0) / L) * W;
    const py = (y) => (1 - y / YM) * H;
    // Trim line: along the fender, a V down through the door, back up at the rear
    const trimY = table([[-2.3, 0.72], [-0.55, 0.72], [-0.1, 0.52], [0.25, 0.52], [0.75, 0.72], [2.4, 0.72]]);
    g.fillStyle = '#f2efe6';
    g.fillRect(0, 0, W, H);
    g.fillStyle = color;
    g.beginPath();
    g.moveTo(px(Z0), 0);
    for (let z = Z0; z <= Z1; z += 0.02) g.lineTo(px(z), py(trimY(z)));
    g.lineTo(px(Z1), 0);
    g.closePath();
    g.fill();
    // Patina: rust blooms along the upper edges and the hood, spots elsewhere
    for (let i = 0; i < 45; i++) {
      const z = Z0 + rnd() * L, y = 0.62 + rnd() * 0.5;
      const r = 2 + rnd() * (y > 0.95 ? 9 : 5);
      g.fillStyle = `rgba(${140 + rnd() * 60},${60 + rnd() * 30},${30 + rnd() * 20},${0.45 + rnd() * 0.4})`;
      g.beginPath();
      g.ellipse(px(z), py(y), r * 1.8, r, 0, 0, Math.PI * 2);
      g.fill();
    }
    // Chrome trim spear
    g.strokeStyle = '#c9ced6';
    g.lineWidth = 6;
    g.beginPath();
    for (let z = Z0 + 0.3; z <= Z1 - 0.3; z += 0.02) z === Z0 + 0.3 ? g.moveTo(px(z), py(trimY(z))) : g.lineTo(px(z), py(trimY(z)));
    g.stroke();
    g.strokeStyle = 'rgba(255,255,255,0.8)';
    g.lineWidth = 2;
    g.stroke();
    // Door shut line
    g.strokeStyle = 'rgba(40,40,40,0.5)';
    g.lineWidth = 2;
    for (const z of [0.78, -0.68]) {
      g.beginPath();
      g.moveTo(px(z), py(0.95));
      g.lineTo(px(z), py(0.3));
      g.stroke();
    }
  });
}

function dieFace(n) {
  const pips = { 1: [[1, 1]], 2: [[0, 0], [2, 2]], 3: [[0, 0], [1, 1], [2, 2]], 4: [[0, 0], [2, 0], [0, 2], [2, 2]], 5: [[0, 0], [2, 0], [1, 1], [0, 2], [2, 2]], 6: [[0, 0], [0, 1], [0, 2], [2, 0], [2, 1], [2, 2]] }[n];
  return canvasTex(128, 128, (g) => {
    g.fillStyle = '#f7f7f4';
    g.fillRect(0, 0, 128, 128);
    g.fillStyle = '#111';
    for (const [x, y] of pips) {
      g.beginPath();
      g.arc(28 + x * 36, 28 + y * 36, 12, 0, Math.PI * 2);
      g.fill();
    }
  });
}

export function buildDiceRod(body, color) {
  const add = adder(body);
  const Z0 = -2.25, Z1 = 2.32;
  const FW = 1.45, RW = -1.35, RF = 0.46, RR = 0.5;
  const section = sectionFn({
    W: (z) => {
      let w = table([[-2.25, 0.74], [-1.7, 0.9], [1.1, 0.9], [1.9, 0.86]])(z);
      if (z > 1.9) w *= Math.pow(Math.max(0, 1 - ((z - 1.9) / (Z1 - 1.9 + 0.001)) ** 3), 0.3);
      if (z < -1.9) w *= Math.pow(Math.max(0, 1 - ((-1.9 - z) / (-1.9 - Z0 + 0.001)) ** 3), 0.35);
      return w;
    },
    belt: table([[-2.25, 0.58], [2.32, 0.6]]),
    floor: table([[-2.25, 0.34], [-1.9, 0.26], [1.9, 0.26], [2.32, 0.36]]),
    // Centre line vs. rounded fender crests over each wheel
    top: (z, u) => {
      const ctr = table([[-2.25, 0.74], [-1.6, 0.9], [0.4, 0.92], [1.9, 0.88], [2.32, 0.7]])(z);
      const fen = table([[-2.25, 0.78], [-1.35, 1.0], [-0.4, 0.93], [0.6, 0.93], [1.45, 1.02], [2.05, 0.98], [2.32, 0.72]])(z);
      return ctr + (fen - ctr) * u;
    },
    arches: [[FW, RF + 0.12, RF - 0.02, 0.55], [RW, RR + 0.08, RR - 0.1, 0.6]],
    n: 2.6,
  });
  const liv = [ratLivery(color, true), ratLivery(color, false)];
  const skins = liv.map((t) => new THREE.MeshStandardMaterial({ map: t, metalness: 0.15, roughness: 0.55, envMap: studioEnv(), envMapIntensity: 0.5, side: THREE.DoubleSide }));
  loft(body, { z0: Z0, z1: Z1, section, material: (side) => skins[side > 0 ? 0 : 1], yMax: 1.1, plainAbove: 0.95 });
  const chrome = mats.chrome();
  const white = mats.flat('#f2efe6', { roughness: 0.4 });

  // White bubble hardtop: a roof cap plus a rear section, open side windows
  const roofC = [0, 0.86, -0.55], roofS = [0.8, 0.56, 0.98];
  const cap = add(new THREE.SphereGeometry(1, 36, 12, 0, Math.PI * 2, 0, 1.0), white, ...roofC);
  cap.scale.set(...roofS);
  // The hardtop comes down to the body behind the side windows
  const back = add(new THREE.SphereGeometry(1, 24, 10, Math.PI * 1.5 - 1.15, 2.3, 0, Math.PI / 2), white, ...roofC);
  back.scale.set(...roofS);
  // Interior: seats and wheel seen through the windows
  add(new THREE.BoxGeometry(1.3, 0.3, 0.5), mats.flat('#241c18'), 0, 0.95, -0.6);
  add(new THREE.TorusGeometry(0.16, 0.025, 8, 20), mats.flat('#111'), 0.35, 1.05, 0.1).rotation.x = -0.6;
  // Raked windscreen with a chrome frame
  const ws = add(new THREE.PlaneGeometry(1.36, 0.52), mats.glass('#9fc6d4', { transparent: true, opacity: 0.45, side: THREE.DoubleSide }), 0, 1.13, 0.28);
  ws.rotation.x = -0.9;
  for (const f of [1, -1]) {
    const post = add(new THREE.CylinderGeometry(0.025, 0.025, 0.56, 6), chrome, f * 0.69, 1.13, 0.28);
    post.rotation.x = -0.9;
  }
  add(new THREE.CylinderGeometry(0.025, 0.025, 1.38, 6).rotateZ(Math.PI / 2), chrome, 0, 1.335, 0.1);

  // Engine out of the hood: block, twin carbs and giant dice air cleaners
  add(new THREE.BoxGeometry(0.9, 0.04, 0.9), mats.flat('#0c0c0e'), 0, 0.91, 1.15);
  add(new RoundedBoxGeometry(0.6, 0.2, 0.7, 2, 0.04), mats.satin(), 0, 0.98, 1.15);
  const faces = [1, 6, 2, 5, 3, 4].map((n) => new THREE.MeshStandardMaterial({ map: dieFace(n), roughness: 0.35 }));
  for (const [x, rotY, rotZ] of [[0.24, 0.35, 0.08], [-0.24, -0.2, -0.06]]) {
    add(new THREE.CylinderGeometry(0.11, 0.13, 0.28, 16), chrome, x, 1.2, 1.15);
    add(new THREE.CylinderGeometry(0.06, 0.06, 0.2, 10), mats.flat('#222'), x, 1.4, 1.15);
    const die = add(new RoundedBoxGeometry(0.42, 0.42, 0.42, 3, 0.05), faces, x, 1.68, 1.15);
    die.rotation.set(0.05, rotY, rotZ);
  }
  // Round headlamps in the fender fronts, rusty grille, turn lamps, side port
  for (const f of [1, -1]) {
    const lz = 2.08, lx = f * 0.62, ly = 0.74;
    add(new THREE.TorusGeometry(0.15, 0.035, 10, 28), chrome, lx, ly, lz);
    const lens = add(new THREE.SphereGeometry(0.14, 20, 10, 0, Math.PI * 2, 0, Math.PI / 2), mats.glow('#fff4d6'), lx, ly, lz);
    lens.rotation.x = Math.PI / 2;
    add(new THREE.SphereGeometry(0.05, 10, 8), mats.glow('#ffb347'), f * 0.52, 0.42, 2.25);
    add(new THREE.TorusGeometry(0.09, 0.025, 8, 18).rotateY(Math.PI / 2), chrome, f * 0.9, 0.6, 0.72);
    add(new THREE.CircleGeometry(0.075, 16).rotateY(f * Math.PI / 2), mats.flat('#0c0c0e'), f * 0.905, 0.6, 0.72);
    add(new THREE.SphereGeometry(0.07, 10, 8), mats.glow('#ff2a2a'), f * 0.55, 0.68, -2.2);
    add(new THREE.BoxGeometry(0.03, 0.03, 0.14), chrome, f * 0.915, 0.82, -0.3); // door handle
  }
  const grille = canvasTex(128, 64, (g, w, h) => {
    g.fillStyle = '#6b4a2e';
    g.fillRect(0, 0, w, h);
    g.strokeStyle = '#c9b48a';
    g.lineWidth = 3;
    for (let x = 4; x < w; x += 8) (g.beginPath(), g.moveTo(x, 0), g.lineTo(x, h), g.stroke());
    for (let y = 4; y < h; y += 8) (g.beginPath(), g.moveTo(0, y), g.lineTo(w, y), g.stroke());
  });
  const gr = add(new THREE.CircleGeometry(0.25, 28), new THREE.MeshStandardMaterial({ map: grille, metalness: 0.5, roughness: 0.6 }), 0, 0.54, 2.345);
  gr.scale.set(1.35, 0.7, 1);
  const ring = add(new THREE.TorusGeometry(0.25, 0.03, 8, 32), chrome, 0, 0.54, 2.345);
  ring.scale.set(1.35, 0.7, 1);

  return {
    roofY: 1.95,
    axles: [
      { z: FW, r: RF, w: 0.36, track: 0.86, steer: true },
      { z: RW, r: RR, w: 0.44, track: 0.88, steer: false },
    ],
    tire: (r, w) => tireGeometry(r, w, { inner: 0.6 }),
    rim: (tire, r, w) => {
      sidewallRing(tire, r, w, r * 0.64, r * 0.9, mats.flat('#f4f2ea', { roughness: 0.6 })); // wide whitewalls
      const steel = mats.paint(color, { metalness: 0.2, roughness: 0.45 });
      for (const f of [1, -1]) {
        const x = f * (w / 2 - 0.01);
        const d = new THREE.Mesh(new THREE.CylinderGeometry(r * 0.6, r * 0.6, 0.03, 28).rotateZ(Math.PI / 2), steel);
        d.position.x = x;
        tire.add(d);
        const cap = new THREE.Mesh(new THREE.SphereGeometry(r * 0.2, 14, 8, 0, Math.PI * 2, 0, Math.PI / 2).rotateZ(-f * Math.PI / 2), mats.chrome());
        cap.position.x = x + f * 0.01;
        tire.add(cap);
        for (let k = 0; k < 5; k++) {
          const ang = (k / 5) * Math.PI * 2;
          const n = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.02, 0.04, 6).rotateZ(Math.PI / 2), mats.chrome());
          n.position.set(x + f * 0.015, Math.cos(ang) * r * 0.3, Math.sin(ang) * r * 0.3);
          tire.add(n);
          const hole = new THREE.Mesh(new THREE.CircleGeometry(0.035, 10).rotateY(f * Math.PI / 2), mats.flat('#101010'));
          hole.position.set(x + f * 0.017, Math.cos(ang + 0.6) * r * 0.46, Math.sin(ang + 0.6) * r * 0.46);
          tire.add(hole);
        }
      }
    },
    flames: [[0.35, 0.4, -2.4], [-0.35, 0.4, -2.4]],
  };
}

// ---------------- 5. Stadium F1 ----------------

function f1Livery(color, noseLeft) {
  const Z0 = -2.3, Z1 = 2.55, L = Z1 - Z0, YM = 1.15;
  return canvasTex(1024, 256, (g, W, H) => {
    const px = (z) => (noseLeft ? (Z1 - z) / L : (z - Z0) / L) * W;
    const py = (y) => (1 - y / YM) * H;
    const gr = g.createLinearGradient(0, 0, 0, H);
    gr.addColorStop(0, shade(color, 0.18));
    gr.addColorStop(0.55, color);
    gr.addColorStop(1, shade(color, -0.3));
    g.fillStyle = gr;
    g.fillRect(0, 0, W, H);
    // White flash sweeping back from the nose, thinning over the sidepod
    g.fillStyle = '#f4f6f8';
    g.beginPath();
    g.moveTo(px(2.55), py(0.36));
    g.lineTo(px(1.2), py(0.42));
    g.lineTo(px(-0.2), py(0.58));
    g.lineTo(px(-1.9), py(0.62));
    g.lineTo(px(-1.9), py(0.55));
    g.lineTo(px(-0.2), py(0.48));
    g.lineTo(px(1.2), py(0.33));
    g.lineTo(px(2.55), py(0.3));
    g.closePath();
    g.fill();
    // Carbon floor edge
    g.fillStyle = '#15171b';
    g.fillRect(0, py(0.31), W, H);
    // Race number roundel on the engine cover
    const cx = px(-0.9), cy = py(0.78), r = 0.13 * (H / YM);
    g.save();
    g.translate(cx, cy);
    g.scale((W / L) / (H / YM), 1);
    g.fillStyle = '#ffffff';
    g.beginPath();
    g.arc(0, 0, r, 0, Math.PI * 2);
    g.fill();
    g.fillStyle = '#111';
    g.font = `900 ${Math.round(r * 1.25)}px Arial Black, Impact, sans-serif`;
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.fillText('01', 0, 3);
    g.restore();
  });
}

export function buildStadiumF1(body, color) {
  const add = adder(body);
  const Z0 = -2.3, Z1 = 2.55;
  const W = table([[-2.3, 0.2], [-1.9, 0.3], [-1.2, 0.42], [-0.4, 0.46], [0.3, 0.4], [1.0, 0.3], [1.8, 0.2], [2.4, 0.13], [2.55, 0.06]]);
  const top = table([[-2.3, 0.52], [-1.9, 0.62], [-1.2, 0.88], [-0.5, 1.02], [-0.15, 0.94], [0.2, 0.74], [1.0, 0.64], [1.8, 0.52], [2.4, 0.42], [2.55, 0.36]]);
  const floor = table([[-2.3, 0.3], [2.55, 0.3]]);
  const section = (z, a, out) => {
    const w = W(z), c = Math.cos(a), s = Math.sin(a), n = 2.4;
    const x = w * Math.pow(Math.abs(c), 2 / n);
    const mid = floor(z) + 0.14;
    const y = s >= 0 ? mid + (top(z) - mid) * Math.pow(Math.abs(s), 2 / n) : mid - (mid - floor(z)) * Math.pow(Math.abs(s), 2 / n);
    return out.set(x, y, z);
  };
  const liv = [f1Livery(color, true), f1Livery(color, false)];
  const skins = liv.map((t) => mats.paint('#ffffff', { map: t, metalness: 0.5, roughness: 0.22, side: THREE.DoubleSide }));
  loft(body, { z0: Z0, z1: Z1, section, material: (side) => skins[side > 0 ? 0 : 1], yMax: 1.15, plainAbove: 2 });
  const paint = mats.paint(color, { metalness: 0.5, roughness: 0.22 });
  const white = mats.paint('#f4f6f8', { metalness: 0.2, roughness: 0.3 });
  const carbon = mats.flat('#16181c', { roughness: 0.45, metalness: 0.3 });

  // White centre stripe over the nose, cockpit surround and engine cover
  const stripe = [];
  for (let z = Z0 + 0.05; z <= Z1 - 0.05; z += 0.05) stripe.push(z);
  const sPos = [], sIdx = [];
  stripe.forEach((z, i) => {
    const y = top(z) + 0.006, w = Math.min(0.11, W(z) * 0.5);
    sPos.push(-w, y, z, w, y, z);
    if (i) sIdx.push(2 * i - 2, 2 * i - 1, 2 * i, 2 * i - 1, 2 * i + 1, 2 * i);
  });
  const sg = new THREE.BufferGeometry();
  sg.setAttribute('position', new THREE.Float32BufferAttribute(sPos, 3));
  sg.setIndex(sIdx);
  sg.computeVertexNormals();
  add(sg, new THREE.MeshStandardMaterial({ color: '#f4f6f8', roughness: 0.3, side: THREE.DoubleSide, polygonOffset: true, polygonOffsetFactor: -2 }));

  // Sidepods: rounded, with dark intakes up front
  for (const f of [1, -1]) {
    const pod = add(new RoundedBoxGeometry(0.46, 0.36, 1.9, 4, 0.14), paint, f * 0.62, 0.5, -0.45);
    pod.rotation.x = 0.04;
    add(new RoundedBoxGeometry(0.38, 0.26, 0.06, 2, 0.05), carbon, f * 0.62, 0.52, 0.52);
    add(new RoundedBoxGeometry(0.47, 0.06, 1.6, 2, 0.02), white, f * 0.62, 0.66, -0.55);
  }
  // Cockpit and driver
  const pit = add(new THREE.SphereGeometry(1, 20, 10), carbon, 0, 0.74, 0.18);
  pit.scale.set(0.3, 0.12, 0.5);
  const helmet = add(new THREE.SphereGeometry(0.2, 20, 14), white, 0, 0.9, 0.05);
  helmet.scale.set(1, 1.05, 1.15);
  const visor = add(new THREE.SphereGeometry(0.205, 20, 10, -0.9, 1.8, 1.1, 0.55), mats.glass('#0b0e14'), 0, 0.9, 0.05);
  visor.scale.set(1, 1.05, 1.15);
  add(new THREE.TorusGeometry(0.2, 0.025, 6, 20).rotateX(Math.PI / 2), paint, 0, 0.92, 0.05);
  // Airbox intake above the driver's head
  add(new RoundedBoxGeometry(0.3, 0.2, 0.08, 2, 0.04), carbon, 0, 1.0, -0.33);
  // Mirrors
  for (const f of [1, -1]) {
    add(new THREE.BoxGeometry(0.04, 0.1, 0.04), carbon, f * 0.38, 0.78, 0.55);
    add(new RoundedBoxGeometry(0.16, 0.08, 0.05, 2, 0.02), paint, f * 0.44, 0.84, 0.55);
  }
  // Front wing: main plane, accent flap, endplates
  add(new RoundedBoxGeometry(2.05, 0.05, 0.5, 2, 0.02), carbon, 0, 0.3, 2.3);
  add(new RoundedBoxGeometry(1.9, 0.04, 0.2, 2, 0.015), paint, 0, 0.37, 2.2).rotation.x = -0.25;
  for (const f of [1, -1]) add(new RoundedBoxGeometry(0.04, 0.24, 0.56, 2, 0.015), white, f * 1.02, 0.36, 2.3);
  // Rear wing: two elements, endplates and a centre pylon
  add(new RoundedBoxGeometry(1.7, 0.05, 0.42, 2, 0.02), carbon, 0, 1.08, -2.1).rotation.x = 0.1;
  add(new RoundedBoxGeometry(1.7, 0.04, 0.22, 2, 0.015), paint, 0, 1.2, -2.25).rotation.x = 0.45;
  for (const f of [1, -1]) add(new RoundedBoxGeometry(0.05, 0.62, 0.62, 2, 0.02), paint, f * 0.87, 1.0, -2.15);
  add(new THREE.BoxGeometry(0.06, 0.5, 0.3), carbon, 0, 0.8, -2.05);
  // Diffuser and brake light
  add(new RoundedBoxGeometry(1.1, 0.16, 0.3, 2, 0.03), carbon, 0, 0.3, -2.25);
  add(new THREE.BoxGeometry(0.22, 0.08, 0.03), new THREE.MeshBasicMaterial({ color: new THREE.Color('#ff2020').multiplyScalar(3), toneMapped: false }), 0, 0.5, -2.33);

  const FZ = 1.55, RZ = -1.35, FT = 0.98, RT = 1.0;
  // Suspension arms from the body to each wheel
  const arm = (a, b) => {
    const d = b.clone().sub(a), len = d.length();
    const m = add(new THREE.CylinderGeometry(0.025, 0.025, len, 6), carbon, 0, 0, 0);
    m.position.copy(a).lerp(b, 0.5);
    m.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), d.normalize());
  };
  for (const [z, x, r] of [[FZ, FT, 0.4], [RZ, RT, 0.48]]) {
    for (const f of [1, -1]) {
      for (const [dy, dz] of [[0.12, 0.18], [0.12, -0.18], [-0.08, 0.2], [-0.08, -0.2]]) {
        arm(new THREE.Vector3(f * 0.2, r + dy, z + dz), new THREE.Vector3(f * (x - 0.12), r + dy * 0.6, z));
      }
    }
  }
  return {
    roofY: 1.35,
    axles: [
      { z: FZ, r: 0.4, w: 0.36, track: FT, steer: true },
      { z: RZ, r: 0.48, w: 0.56, track: RT, steer: false },
    ],
    tire: (r, w) => tireGeometry(r, w, { inner: 0.7 }),
    rim: (tire, r, w) => {
      spokeRim(tire, r, w, { spokes: 6, spokeW: 0.07, face: mats.flat('#23262c', { metalness: 0.7, roughness: 0.3 }), dish: mats.flat('#0f1013'), lip: mats.paint(color, { metalness: 0.5, roughness: 0.25 }) });
    },
    flames: [[0.25, 0.5, -2.4], [-0.25, 0.5, -2.4]],
  };
}

// ---------------- 6. Twin-jet land speed record car ----------------

/** Surface of revolution around the car's length: profile is [radius, z] from tail to nose. */
function latheZ(profile, seg = 32) {
  return new THREE.LatheGeometry(profile.map(([r, z]) => new THREE.Vector2(r, z)), seg).rotateX(Math.PI / 2);
}

/** White roundel with a race number, for the nacelle sides. */
function jetRoundel(color) {
  return canvasTex(128, 128, (g, w, h) => {
    g.fillStyle = '#f4f6f8';
    g.beginPath();
    g.arc(w / 2, h / 2, w / 2 - 2, 0, Math.PI * 2);
    g.fill();
    g.strokeStyle = color;
    g.lineWidth = 10;
    g.beginPath();
    g.arc(w / 2, h / 2, w / 2 - 12, 0, Math.PI * 2);
    g.stroke();
    g.fillStyle = '#111';
    g.font = '900 54px Arial Black, Impact, sans-serif';
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.fillText('SSC', w / 2, h / 2 + 3);
  });
}

/**
 * Soundbreaker: a jet-powered land speed record car. A needle nose with a
 * striped probe, two huge jet nacelles with chrome intake lips, a swept
 * T-tail fin in the player's colour, and solid aluminium wheels tucked
 * under the body.
 */
export function buildThrust(body, color) {
  const add = adder(body);
  // Fuselage and nacelles in the player's colour; tail fin and pinstripes contrast
  const black = mats.paint(color, { metalness: 0.35, roughness: 0.18, side: THREE.DoubleSide });
  const accent = mats.paint('#0c0d10', { metalness: 0.4, roughness: 0.25, side: THREE.DoubleSide });
  const chrome = mats.chrome();
  const dark = mats.flat('#07080a', { side: THREE.DoubleSide });
  const white = mats.paint('#f4f6f8', { metalness: 0.1, roughness: 0.3 });

  // Central fuselage: long needle nose, dipping slightly toward the ground
  const FY = 0.56;
  const fus = add(
    latheZ([[0.001, -3.05], [0.2, -3.0], [0.3, -2.7], [0.34, -2.1], [0.35, -0.8], [0.35, 0.5], [0.32, 1.2], [0.25, 1.95], [0.16, 2.6], [0.075, 3.0], [0.05, 3.08]]),
    black,
    0,
    FY,
    0,
  );
  fus.rotation.x = 0.05;
  const noseAt = (z) => new THREE.Vector3(0, FY - Math.sin(0.05) * z, z);
  const tip = add(new THREE.ConeGeometry(0.05, 0.3, 16).rotateX(Math.PI / 2), chrome);
  tip.position.copy(noseAt(3.23));
  tip.rotation.x = 0.05;
  // Striped air-data probe off the nose
  for (let k = 0; k < 6; k++) {
    const seg = add(new THREE.CylinderGeometry(0.018, 0.018, 0.09, 8).rotateX(Math.PI / 2), k % 2 ? mats.flat('#111') : mats.flat('#ffcf1f'));
    seg.position.copy(noseAt(3.42 + k * 0.09));
  }
  // Cockpit canopy on the spine ahead of the intakes
  const canopy = add(new THREE.SphereGeometry(1, 20, 10, 0, Math.PI * 2, 0, Math.PI / 2), mats.glass('#10151d'), 0, FY + 0.27, 1.3);
  canopy.scale.set(0.16, 0.12, 0.42);
  // Pinstripes along the nose (white and the player's colour)
  for (const [f, m] of [[1, white], [-1, white]]) {
    const s = add(new THREE.BoxGeometry(0.015, 0.03, 1.1), m, f * 0.215, FY + 0.03, 2.05);
    s.rotation.y = -f * 0.1;
    const s2 = add(new THREE.BoxGeometry(0.015, 0.03, 1.1), accent, f * 0.205, FY - 0.03, 2.05);
    s2.rotation.y = -f * 0.1;
  }

  // Jet nacelles either side
  const NX = 0.68, NY = 0.64, NR = 0.42;
  const roundel = new THREE.MeshStandardMaterial({ map: jetRoundel(color), roughness: 0.35, transparent: true, polygonOffset: true, polygonOffsetFactor: -2 });
  for (const f of [1, -1]) {
    const x = f * NX;
    add(latheZ([[0.22, -3.0], [0.33, -2.92], [0.4, -2.55], [NR, -1.8], [NR, 0.0], [0.41, 0.6], [0.38, 0.95]]), black, x, NY, 0);
    // Intake: chrome lip, dark duct, fan face and spinner
    const lip = add(new THREE.TorusGeometry(0.37, 0.05, 10, 32), chrome, x, NY, 0.95);
    lip.rotation.y = 0;
    add(new THREE.CylinderGeometry(0.36, 0.36, 0.5, 28, 1, true).rotateX(Math.PI / 2), dark, x, NY, 0.72);
    add(new THREE.CircleGeometry(0.36, 28), mats.flat('#2a2d33', { metalness: 0.6, roughness: 0.4 }), x, NY, 0.5);
    for (let k = 0; k < 10; k++) {
      const blade = add(new THREE.BoxGeometry(0.05, 0.3, 0.012), mats.flat('#4a4f58', { metalness: 0.8, roughness: 0.3 }), x, NY, 0.52);
      blade.rotation.order = 'ZYX'; // pitch each blade about its own radius, then spin it into place
      blade.rotation.set(0, 0.5, (k / 10) * Math.PI * 2);
      blade.geometry.translate(0, 0.17, 0);
    }
    add(new THREE.ConeGeometry(0.1, 0.18, 16).rotateX(Math.PI / 2), chrome, x, NY, 0.6);
    // Exhaust nozzle
    add(new THREE.TorusGeometry(0.22, 0.035, 8, 24), mats.satin(), x, NY, -3.0);
    add(new THREE.CircleGeometry(0.21, 24).rotateY(Math.PI), mats.flat('#26140a', { emissive: '#ff5a14', emissiveIntensity: 0.35 }), x, NY, -2.97);
    // Side stripe in the player's colour, and a roundel
    add(new THREE.BoxGeometry(0.02, 0.07, 2.6), accent, f * (NX + NR + 0.004), NY + 0.04, -0.8);
    add(new THREE.BoxGeometry(0.02, 0.025, 2.6), white, f * (NX + NR + 0.004), NY - 0.03, -0.8);
    const r = add(new THREE.CircleGeometry(0.26, 28), roundel, f * (NX + NR + 0.012), NY + 0.02, 0.0);
    r.rotation.y = f * Math.PI / 2;
  }

  // Swept tail fin with a T-tailplane, in the player's colour
  const fin = new THREE.Shape();
  fin.moveTo(-1.5, 0);
  fin.lineTo(-3.0, 0);
  fin.lineTo(-3.22, 1.12);
  fin.lineTo(-2.78, 1.12);
  fin.closePath();
  const finGeo = new THREE.ExtrudeGeometry(fin, { depth: 0.08, bevelEnabled: true, bevelThickness: 0.02, bevelSize: 0.02, bevelSegments: 1 });
  finGeo.rotateY(-Math.PI / 2); // shape x -> car z
  finGeo.translate(0.04, 0, 0);
  add(finGeo, accent, 0, FY + 0.26, 0);
  const tp = add(new RoundedBoxGeometry(1.7, 0.05, 0.5, 2, 0.02), black, 0, FY + 1.4, -3.0);
  tp.rotation.x = 0.02;
  add(new RoundedBoxGeometry(0.16, 0.12, 0.62, 2, 0.04), accent, 0, FY + 1.42, -3.0);

  // Solid aluminium wheels: two pairs under each nacelle, a narrow pair at the tail
  const alloy = mats.satin();
  return {
    roofY: 0.95,
    axles: [
      { z: 0.25, r: 0.3, w: 0.2, track: NX, steer: true },
      { z: -0.6, r: 0.3, w: 0.2, track: NX, steer: false },
      { z: -2.35, r: 0.3, w: 0.14, track: 0.2, steer: false },
    ],
    tireMat: alloy,
    tire: (r, w) => new THREE.CylinderGeometry(r, r, w, 28).rotateZ(Math.PI / 2),
    rim: (tire, r, w) => {
      for (const f of [1, -1]) {
        const hub = new THREE.Mesh(new THREE.CylinderGeometry(r * 0.35, r * 0.35, 0.02, 20).rotateZ(Math.PI / 2), mats.flat('#3a3e45', { metalness: 0.8, roughness: 0.3 }));
        hub.position.x = f * (w / 2 + 0.005);
        tire.add(hub);
        const ring = new THREE.Mesh(new THREE.TorusGeometry(r * 0.72, 0.012, 6, 28).rotateY(Math.PI / 2), mats.flat('#7b8089', { metalness: 0.8 }));
        ring.position.x = f * (w / 2 + 0.004);
        tire.add(ring);
      }
    },
    flames: [[NX, NY, -3.0], [-NX, NY, -3.0]],
  };
}

// Shared with cars3.js
export { adder, mats, canvasTex, spokeRim, sidewallRing, profileGeo, shade, plateTex };
