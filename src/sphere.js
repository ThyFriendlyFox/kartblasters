import * as THREE from 'three';

/**
 * A course on the inside of a giant sphere.
 *
 * The centreline is a closed curve on the sphere (a tilted, wavy line that
 * winds around it several times), so the road runs across the floor, up the
 * walls and upside-down across the ceiling, criss-crossing itself. Every
 * crossing is made an over/under: one pass bulges in toward the centre and
 * the other out, so the roads never meet. The road's "up" always points at
 * the sphere's centre. Loops sit where the road crosses the floor, jumps on
 * the floor too (flight uses real gravity), and corkscrews on the walls.
 *
 * Returns turtle-style output ({ pts, marks }) for Track.
 */
export function sphereCourse({
  radius = 200,
  center = new THREE.Vector3(0, 240, 0),
  turns = 3,
  waves = 5,
  amp = 0.45,
  tiltDeg = 65,
  width = 16,
  clearance = 20,
  loops = 2,
  jumps = 3,
  corkscrews = 3,
  colors = {},
}) {
  const STEP = 3;
  const tilt = new THREE.Matrix4().makeRotationX(THREE.MathUtils.degToRad(tiltDeg));
  const onSphere = (t) => {
    const ph = turns * t, th = amp * Math.sin(waves * t);
    return new THREE.Vector3(Math.cos(th) * Math.cos(ph), Math.sin(th), Math.cos(th) * Math.sin(ph)).applyMatrix4(tilt).multiplyScalar(radius).add(center);
  };

  // Dense samples, then resample at an even spacing
  const M = 12000;
  const dense = [], cum = [0];
  for (let i = 0; i <= M; i++) dense.push(onSphere((i / M) * Math.PI * 2));
  for (let i = 1; i <= M; i++) cum.push(cum[i - 1] + dense[i].distanceTo(dense[i - 1]));
  const L = cum[M];
  const n = Math.round(L / STEP);
  const base = [];
  for (let k = 0, j = 0; k < n; k++) {
    const s = (k / n) * L;
    while (cum[j + 1] < s) j++;
    base.push(dense[j].clone().lerp(dense[j + 1], (s - cum[j]) / (cum[j + 1] - cum[j])));
  }

  const frames = (P) => {
    const T = [], N = [], R = [];
    for (let i = 0; i < n; i++) {
      const t = P[(i + 1) % n].clone().sub(P[(i - 1 + n) % n]).normalize();
      const inward = center.clone().sub(P[i]).normalize();
      const nn = inward.addScaledVector(t, -inward.dot(t)).normalize();
      T.push(t);
      N.push(nn);
      R.push(new THREE.Vector3().crossVectors(t, nn).normalize());
    }
    return { T, N, R };
  };
  let F = frames(base);

  const dist = (a, b) => Math.min(Math.abs(a - b), n - Math.abs(a - b)) * STEP;

  // Crossings: pairs of passes that come close on the sphere
  const crossings = [];
  for (let i = 0; i < n; i += 2) {
    for (let j = i + 2; j < n; j += 2) {
      if (dist(i, j) < 150) continue;
      const d = base[i].distanceTo(base[j]);
      if (d > width * 2) continue;
      const near = crossings.find((c) => dist(c.i, i) < 90 && dist(c.j, j) < 90);
      if (near) {
        if (d < near.d) Object.assign(near, { i, j, d });
      } else crossings.push({ i, j, d });
    }
  }

  // Start line: the flattest floor spot well away from any crossing
  let start = 0, best = -2;
  for (let i = 0; i < n; i++) {
    if (crossings.some((c) => dist(c.i, i) < 70 || dist(c.j, i) < 70)) continue;
    if (F.N[i].y > best) (best = F.N[i].y), (start = i);
  }
  const rot = (arr) => arr.slice(start).concat(arr.slice(0, start));
  const P = rot(base);
  F = { T: rot(F.T), N: rot(F.N), R: rot(F.R) };
  for (const c of crossings) {
    c.i = (c.i - start + n) % n;
    c.j = (c.j - start + n) % n;
  }

  // Radial offset (toward the centre is +): over/under bumps at crossings
  const off = new Float32Array(n);
  const sigma = 22; // samples (~66 units)
  // Every other crossing is a flat, through crossing: the roads meet, and the
  // walls open up across the junction. The rest are over/unders.
  const norail = new Uint8Array(n);
  crossings.forEach((c, k) => {
    c.through = k % 2 === 0;
    if (!c.through) return;
    const ang = Math.acos(Math.min(1, Math.abs(F.T[c.i].dot(F.T[c.j]))));
    const reach = Math.ceil((width / 2 + 4) / Math.max(0.35, Math.sin(ang)) / STEP) + 2;
    for (let d = -reach; d <= reach; d++) {
      norail[(c.i + d + n) % n] = 1;
      norail[(c.j + d + n) % n] = 1;
      // A hair apart so the two surfaces don't flicker
      const g = Math.exp(-(d * d) / (2 * reach * reach));
      off[(c.i + d + n) % n] += 0.08 * g;
      off[(c.j + d + n) % n] -= 0.08 * g;
    }
  });
  crossings.forEach((c, k) => {
    if (c.through) return;
    const h = clearance / 2;
    const sgn = k % 4 === 1 ? 1 : -1;
    for (let d = -3 * sigma; d <= 3 * sigma; d++) {
      const g = Math.exp(-(d * d) / (2 * sigma * sigma));
      off[(c.i + d + n) % n] += sgn * h * g;
      off[(c.j + d + n) % n] -= sgn * h * g;
    }
  });

  // Feature placement
  const busy = new Uint8Array(n);
  const claim = (i, before, after) => {
    for (let d = -before; d <= after; d++) busy[(i + d + n) % n] = 1;
  };
  claim(0, 40, 40); // keep the start straight-ish... well, clean
  for (const c of crossings) {
    claim(c.i, 14, 14);
    claim(c.j, 14, 14);
  }
  const pick = (count, test, before, after, spacing) => {
    const got = [];
    const cands = [];
    for (let i = 0; i < n; i++) if (test(i)) cands.push(i);
    cands.sort((a, b) => test(b, true) - test(a, true));
    for (const i of cands) {
      if (got.length >= count) break;
      let free = true;
      for (let d = -before; d <= after && free; d++) if (busy[(i + d + n) % n]) free = false;
      if (!free || got.some((g) => dist(g, i) < spacing)) continue;
      got.push(i);
      claim(i, before, after);
    }
    return got.sort((a, b) => a - b);
  };
  const floor = (i, score) => (score ? F.N[i].y : F.N[i].y > 0.62);
  const wall = (i, score) => (score ? 1 - Math.abs(F.N[i].y) : Math.abs(F.N[i].y) < 0.35);
  const LOOP_R = 26, LOOP_LAT = width + 11, LOOP_BLEND = 18; // samples of lateral blend each side
  const loopAt = pick(loops, (i, score) => (score ? F.N[i].y : F.N[i].y > 0.45), LOOP_BLEND + 2, LOOP_BLEND + 2, 400);
  const jumpAt = pick(jumps, floor, 8, 20, 250);
  const CORK = 34; // samples (~100 units)
  const corkAt = pick(corkscrews, wall, 4, CORK + 4, 300);

  // Lateral offset: loops shift the road sideways by LOOP_LAT across the loop
  const lat = new Float32Array(n);
  for (const i0 of loopAt) {
    for (let d = 1; d <= LOOP_BLEND; d++) {
      const e = 1 - d / LOOP_BLEND, s = e * e * (3 - 2 * e);
      lat[(i0 - d + n) % n] += (-LOOP_LAT / 2) * s;
      lat[(i0 + d) % n] += (LOOP_LAT / 2) * s;
    }
  }

  const pts = [];
  const col = { road: colors.road || '#c9cdd4', loop: colors.loop || '#ff8a1e', cork: colors.cork || '#2d7bff', jump: colors.jump || '#ffd000' };
  const emit = (p, up, extra = {}) => pts.push({ p, roll: 0, gap: false, boost: false, kick: false, loop: false, norail: false, color: col.road, up, ...extra });

  for (let i = 0; i < n; i++) {
    const T = F.T[i], N = F.N[i], R = F.R[i];
    const p0 = P[i].clone().addScaledVector(N, off[i]);

    if (loopAt.includes(i)) {
      // A full vertical loop, starting on the left of the line and ending on its right
      const m = Math.ceil((Math.PI * 2 * LOOP_R) / STEP);
      for (let k = 0; k < m; k++) {
        const th = (k / m) * Math.PI * 2;
        const l = -LOOP_LAT / 2 + (LOOP_LAT * (th - Math.sin(th))) / (Math.PI * 2);
        const p = p0.clone().addScaledVector(T, LOOP_R * Math.sin(th)).addScaledVector(N, LOOP_R * (1 - Math.cos(th))).addScaledVector(R, l);
        const up = N.clone().multiplyScalar(Math.cos(th)).addScaledVector(T, -Math.sin(th));
        emit(p, up, { loop: true, color: col.loop });
      }
      emit(p0.clone().addScaledVector(R, LOOP_LAT / 2), N.clone(), { color: col.loop });
      continue;
    }

    let p = p0.addScaledVector(R, lat[i]);
    let up = N.clone();
    const extra = norail[i] ? { norail: true } : {};

    // Corkscrew: a full barrel roll around a small tube along the line
    for (const c of corkAt) {
      const k = (i - c + n) % n;
      if (k <= CORK) {
        const u = k / CORK, e = u * u * (3 - 2 * u), ph = e * Math.PI * 2, r = 3;
        p.addScaledVector(N, r * (1 - Math.cos(ph))).addScaledVector(R, -r * Math.sin(ph));
        up = N.clone().multiplyScalar(Math.cos(ph)).addScaledVector(R, Math.sin(ph));
        extra.color = col.cork;
      }
    }

    // Jump: a short kicker lip, then a gap
    for (const j of jumpAt) {
      const k = (i - j + n) % n;
      if (k < 6) {
        const u = (k + 1) / 6;
        p.addScaledVector(N, 2.2 * u * u);
        Object.assign(extra, { kick: true, color: col.jump });
      } else if (k < 17) {
        const u = (k - 5) / 11;
        p.addScaledVector(N, 2.2 * (1 - u));
        extra.gap = k < 16;
      } else if (k < 20 && k >= 17) {
        extra.color = col.jump;
      }
      if (k >= n - 8) extra.boost = true; // boost pad into each jump
    }
    emit(p, up, extra);
  }

  return { pts, marks: {}, info: { length: L, crossings: crossings.length, through: crossings.filter((c) => c.through).length, loops: loopAt.length, jumps: jumpAt.length, corkscrews: corkAt.length, center, radius } };
}
