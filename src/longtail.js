import * as THREE from 'three';

/**
 * "Longtail 17": a 1970s long-tail endurance racer in race livery: body in
 * the player's colour, red sills, black side stripe with pinstripes, #17 roundels, blue headlight
 * domes, gold 5-spoke wheels. Unlike the other cars, the body is a lofted
 * shell: a smooth cross-section swept along the length, with fender humps,
 * a low wedge nose and open wheel arches.
 *
 * Car faces +Z, wheels rest on y = 0. Units are roughly metres.
 */

const Z_TAIL = -2.55, Z_NOSE = 2.46, LEN = Z_NOSE - Z_TAIL, Y_MAX = 1.3;
export const LONGTAIL_WHEELS = { front: 1.45, rear: -1.25, r: 0.36, track: 0.83, width: 0.32, rearScale: 1.08 };

// Piecewise-linear lookup along the car
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

// Center-line top (hood, cockpit base, engine deck, tail)
const centerTop = table([[-2.55, 0.66], [-2.3, 0.72], [-1.6, 0.78], [-0.7, 0.76], [-0.45, 0.66], [0.95, 0.64], [1.3, 0.6], [1.9, 0.47], [2.46, 0.33]]);
// Fender crest: humps over both axles
const fenderTop = table([[-2.55, 0.74], [-2.2, 0.8], [-1.25, 0.88], [-0.4, 0.74], [0.4, 0.66], [1.45, 0.8], [1.95, 0.62], [2.46, 0.34]]);
const belt = table([[-2.55, 0.46], [1.5, 0.46], [2.1, 0.37], [2.46, 0.31]]);
const floorY = table([[-2.55, 0.24], [-2.2, 0.2], [1.8, 0.2], [2.46, 0.29]]);
const halfWidth = (z) => {
  let w = table([[-2.55, 0.86], [-1.8, 0.98], [1.6, 0.98]])(z);
  if (z > 1.7) w *= Math.pow(Math.max(0, 1 - ((z - 1.7) / (Z_NOSE - 1.7 + 0.001)) ** 4), 0.25); // blunt rounded nose
  return w;
};
// Height of the wheel-arch opening at this station (or -1 if none)
function archAt(z) {
  for (const [wz, r] of [[LONGTAIL_WHEELS.front, 0.5], [LONGTAIL_WHEELS.rear, 0.52]]) {
    const dz = z - wz;
    if (Math.abs(dz) < r) return Math.min(0.74, 0.34 + Math.sqrt(r * r - dz * dz));
  }
  return -1;
}

/** Outline point of the body section at z, a in [-PI/2, PI/2] (bottom -> side -> top). */
function sectionPoint(z, a, out) {
  const W = halfWidth(z), yc = belt(z), fl = floorY(z);
  const n = 3; // superellipse power: rounded but boxy
  const c = Math.cos(a), s = Math.sin(a);
  const x = W * Math.pow(Math.abs(c), 2 / n);
  const k = Math.pow(Math.abs(s), 2 / n);
  let y;
  if (s >= 0) {
    // Top: blend from the center line up to the fender crest toward the sides
    const u = W > 1e-3 ? Math.min(1, x / (W * 0.72)) : 0;
    const top = centerTop(z) + (fenderTop(z) - centerTop(z)) * u * u * (3 - 2 * u);
    y = yc + (Math.max(top, yc) - yc) * k;
  } else {
    y = yc - (yc - fl) * k;
  }
  // Open wheel arches: lift the outer lower body up to the arch line
  const arch = archAt(z);
  if (arch > 0 && x > 0.6 && y < arch) y = arch;
  return out.set(x, y, z);
}

// Livery painted as a side view (nose on the left or right)
function liveryTexture(noseLeft, accent) {
  const W = 1024, H = 272;
  const c = document.createElement('canvas');
  c.width = W;
  c.height = H;
  const g = c.getContext('2d');
  const px = (z) => (noseLeft ? (Z_NOSE - z) / LEN : (z - Z_TAIL) / LEN) * W;
  const py = (y) => (1 - y / Y_MAX) * H;
  // Body paint in the player's colour, a little lighter up top
  const tint = (k) => '#' + new THREE.Color(accent).lerp(new THREE.Color(k > 0 ? '#ffffff' : '#000000'), Math.abs(k)).getHexString();
  const grad = g.createLinearGradient(0, 0, 0, H);
  grad.addColorStop(0, tint(0.35));
  grad.addColorStop(0.5, accent);
  grad.addColorStop(1, tint(-0.2));
  g.fillStyle = grad;
  g.fillRect(0, 0, W, H);
  // Red lower sills (higher around the nose)
  g.fillStyle = '#c8102e';
  g.beginPath();
  g.moveTo(px(Z_NOSE), py(0));
  for (let z = Z_NOSE; z >= Z_TAIL; z -= 0.05) g.lineTo(px(z), py(z > 1.7 ? 0.34 + (z - 1.7) * 0.16 : 0.34));
  g.lineTo(px(Z_TAIL), py(0));
  g.closePath();
  g.fill();
  // Black side stripe with red and accent pinstripes, door to tail
  const band = (y0, y1, col, z0 = 0.35) => {
    g.fillStyle = col;
    const a = px(z0), b = px(Z_TAIL);
    g.fillRect(Math.min(a, b), py(y1), Math.abs(b - a), py(y0) - py(y1));
  };
  band(0.39, 0.52, '#15161a');
  band(0.462, 0.482, '#e3262b');
  band(0.425, 0.445, '#f4f4f4');
  // #17 roundel on the door
  const rx = px(0.5), ry = py(0.56), rr = (0.15 / Y_MAX) * H;
  g.save();
  g.translate(rx, ry);
  g.scale((W / LEN) / (H / Y_MAX), 1); // keep it round after the texture's stretch
  g.fillStyle = '#ffffff';
  g.beginPath();
  g.arc(0, 0, rr, 0, Math.PI * 2);
  g.fill();
  g.lineWidth = 4;
  g.strokeStyle = '#15161a';
  g.stroke();
  g.restore();
  g.save();
  g.translate(rx, ry + 2);
  g.scale(((W / LEN) / (H / Y_MAX)) * 0.9, 1);
  g.fillStyle = '#15161a';
  g.font = `900 ${Math.round(rr * 1.35)}px Arial Black, Impact, sans-serif`;
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.fillText('17', 0, 0);
  g.restore();
  // Small sponsor-style decal ahead of the rear wheel
  g.fillStyle = '#ffffff';
  g.fillRect(Math.min(px(-0.45), px(-0.8)), py(0.6), Math.abs(px(-0.8) - px(-0.45)), py(0.53) - py(0.6));
  g.fillStyle = '#c8102e';
  g.fillRect(Math.min(px(-0.47), px(-0.78)), py(0.585), Math.abs(px(-0.78) - px(-0.47)), py(0.545) - py(0.585));
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 8;
  return t;
}

function loftHalf(side, mat) {
  const pos = [], uv = [], idx = [];
  const NA = 36;
  const zs = [];
  for (let z = Z_TAIL; z < Z_NOSE; z += 0.035) zs.push(z);
  zs.push(Z_NOSE);
  const p = new THREE.Vector3();
  for (const z of zs) {
    for (let j = 0; j <= NA; j++) {
      const a = -Math.PI / 2 + (Math.PI * j) / NA;
      sectionPoint(z, a, p);
      pos.push(p.x * side, p.y, p.z);
      // Side projection: u along the car (nose at u = 0 on the right side), v up
      // (the upper surfaces take a plain gold row so side decals don't smear over the top)
      uv.push(side > 0 ? (Z_NOSE - z) / LEN : (z - Z_TAIL) / LEN, a > 0.75 ? 0.97 : p.y / Y_MAX);
    }
  }
  const row = NA + 1;
  for (let i = 0; i < zs.length - 1; i++) {
    for (let j = 0; j < NA; j++) {
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
  const m = new THREE.Mesh(g, mat);
  m.castShadow = true;
  return m;
}

/** Adds the car's parts to `body`, painted in `accent` (the player's colour). */
export function buildLongtail(body, accent) {
  const paintOpts = { metalness: 0.35, roughness: 0.3, side: THREE.DoubleSide };
  body.add(loftHalf(1, new THREE.MeshStandardMaterial({ map: liveryTexture(true, accent), ...paintOpts })));
  body.add(loftHalf(-1, new THREE.MeshStandardMaterial({ map: liveryTexture(false, accent), ...paintOpts })));

  const gold = new THREE.MeshStandardMaterial({ color: accent, metalness: 0.35, roughness: 0.3 }); // body-coloured panels
  const black = new THREE.MeshStandardMaterial({ color: '#15161a', roughness: 0.6 });
  const add = (geo, mat, x, y, z) => {
    const m = new THREE.Mesh(geo, mat);
    m.position.set(x, y, z);
    m.castShadow = true;
    body.add(m);
    return m;
  };

  // Flat tail panel with the taillights
  const tail = new THREE.Shape();
  const p = new THREE.Vector3();
  for (let j = 0; j <= 24; j++) {
    sectionPoint(Z_TAIL, -Math.PI / 2 + (Math.PI * j) / 24, p);
    j === 0 ? tail.moveTo(p.x, p.y) : tail.lineTo(p.x, p.y);
  }
  for (let j = 24; j >= 0; j--) {
    sectionPoint(Z_TAIL, -Math.PI / 2 + (Math.PI * j) / 24, p);
    tail.lineTo(-p.x, p.y);
  }
  add(new THREE.ShapeGeometry(tail), new THREE.MeshStandardMaterial({ color: '#1c1d22', roughness: 0.5, side: THREE.DoubleSide }), 0, 0, Z_TAIL - 0.001);
  const red = new THREE.MeshBasicMaterial({ color: '#ff2a2a' });
  for (const x of [0.62, -0.62]) add(new THREE.BoxGeometry(0.26, 0.1, 0.03), red, x, 0.58, Z_TAIL - 0.02);
  const pipe = new THREE.MeshStandardMaterial({ color: '#bfc4cc', metalness: 1, roughness: 0.25 });
  for (const x of [0.22, -0.22]) add(new THREE.CylinderGeometry(0.06, 0.06, 0.3, 10).rotateX(Math.PI / 2), pipe, x, 0.3, Z_TAIL - 0.08);

  // Bubble canopy: light blue tinted glass
  const glass = new THREE.MeshStandardMaterial({ color: '#8fd0ff', metalness: 0.3, roughness: 0.06, transparent: true, opacity: 0.88 });
  const canopy = add(new THREE.SphereGeometry(1, 28, 14, 0, Math.PI * 2, 0, Math.PI / 2), glass, 0, 0.6, 0.12);
  canopy.scale.set(0.52, 0.38, 0.9);
  // Body-colored roof over the cockpit: glass stays at the windscreen and sides
  const roof = add(new THREE.SphereGeometry(1, 28, 8, 0, Math.PI * 2, 0, 0.62), gold, 0, 0.6, -0.05);
  roof.scale.set(0.535, 0.39, 0.78);
  // Small mirrors on the front fenders
  for (const x of [0.7, -0.7]) {
    add(new THREE.BoxGeometry(0.03, 0.08, 0.03), black, x, 0.72, 0.95);
    add(new THREE.BoxGeometry(0.1, 0.06, 0.03), gold, x, 0.78, 0.95);
  }

  // Blue headlight domes on the front fenders, lamp glowing inside
  const domeMat = new THREE.MeshStandardMaterial({ color: '#4aa8ff', metalness: 0.2, roughness: 0.05, transparent: true, opacity: 0.75 });
  const lamp = new THREE.MeshBasicMaterial({ color: '#fff8d6' });
  for (const x of [0.6, -0.6]) {
    const d = add(new THREE.SphereGeometry(1, 20, 12, 0, Math.PI * 2, 0, Math.PI / 2), domeMat, x, 0.5, 2.02);
    d.scale.set(0.22, 0.13, 0.34);
    d.rotation.x = 0.28;
    add(new THREE.SphereGeometry(0.07, 10, 8), lamp, x, 0.52, 2.12);
  }

  // Engine deck louvres
  for (let i = 0; i < 6; i++) {
    const z = -0.85 - i * 0.14;
    add(new THREE.BoxGeometry(0.42, 0.015, 0.05), black, 0, centerTop(z) + 0.02, z);
  }

  // Tail fins sweeping up to the rear wing
  const fin = new THREE.Shape();
  fin.moveTo(-1.3, 0.82);
  fin.lineTo(Z_TAIL, 0.76);
  fin.lineTo(Z_TAIL - 0.02, 1.2);
  fin.lineTo(-2.25, 1.22);
  fin.closePath();
  const finGeo = new THREE.ExtrudeGeometry(fin, { depth: 0.05, bevelEnabled: false }).rotateY(-Math.PI / 2);
  for (const x of [0.8, -0.75]) add(finGeo, gold, x, 0, 0);
  const wing = add(new THREE.BoxGeometry(1.72, 0.05, 0.42), gold, 0, 1.19, -2.38);
  wing.rotation.x = -0.08;
  add(new THREE.BoxGeometry(1.72, 0.06, 0.03), black, 0, 1.22, -2.585); // gurney flap

  // #17 on the nose
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const g = c.getContext('2d');
  g.fillStyle = '#ffffff';
  g.beginPath();
  g.arc(64, 64, 60, 0, Math.PI * 2);
  g.fill();
  g.lineWidth = 6;
  g.strokeStyle = '#15161a';
  g.stroke();
  g.fillStyle = '#15161a';
  g.font = '900 70px Arial Black, Impact, sans-serif';
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.fillText('17', 64, 68);
  const nt = new THREE.CanvasTexture(c);
  nt.colorSpace = THREE.SRGBColorSpace;
  const decal = add(new THREE.PlaneGeometry(0.36, 0.36), new THREE.MeshStandardMaterial({ map: nt, transparent: true, roughness: 0.4, polygonOffset: true, polygonOffsetFactor: -2 }), 0, centerTop(1.98) + 0.012, 1.98);
  decal.rotation.x = -Math.PI / 2 + 0.28;
}

/** Gold 5-spoke rims for this car's wheels. */
export function longtailRim(tire, r, w) {
  const gold = new THREE.MeshStandardMaterial({ color: '#e0b23c', metalness: 0.75, roughness: 0.22 });
  const rim = new THREE.Mesh(new THREE.CylinderGeometry(r * 0.66, r * 0.66, w + 0.01, 20).rotateZ(Math.PI / 2), new THREE.MeshStandardMaterial({ color: '#2a2418', metalness: 0.4, roughness: 0.5 }));
  tire.add(rim);
  for (const face of [1, -1]) {
    const hub = new THREE.Mesh(new THREE.CylinderGeometry(r * 0.16, r * 0.16, 0.03, 12).rotateZ(Math.PI / 2), gold);
    hub.position.x = face * (w / 2 + 0.01);
    tire.add(hub);
    const lip = new THREE.Mesh(new THREE.TorusGeometry(r * 0.62, 0.025, 6, 24).rotateY(Math.PI / 2), gold);
    lip.position.x = face * (w / 2 + 0.005);
    tire.add(lip);
    for (let k = 0; k < 5; k++) {
      const spoke = new THREE.Mesh(new THREE.BoxGeometry(0.03, r * 0.5, 0.09), gold);
      const ang = (k / 5) * Math.PI * 2;
      spoke.position.set(face * (w / 2 + 0.01), Math.cos(ang) * r * 0.36, Math.sin(ang) * r * 0.36);
      spoke.rotation.x = ang;
      tire.add(spoke);
    }
  }
}
