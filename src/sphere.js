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
  corkscrews = 2,
  helixes = 2,
  chords = 3,
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


  const ss = (x) => (x <= 0 ? 0 : x >= 1 ? 1 : x * x * (3 - 2 * x));
  const at = (i) => ((i % n) + n) % n;
  // Road centre before stunts (over/under offsets included), for footprint checks
  const P0 = P.map((p, i) => p.clone().addScaledVector(F.N[i], off[i]));

  // Feature placement
  const busy = new Uint8Array(n);
  const claim = (i, before, after) => {
    for (let d = -before; d <= after; d++) busy[at(i + d)] = 1;
  };
  claim(0, 40, 40); // a clean start
  for (const c of crossings) {
    claim(c.i, 14, 14);
    claim(c.j, 14, 14);
  }
  const isFree = (i, before, after) => {
    for (let d = -before; d <= after; d++) if (busy[at(i + d)]) return false;
    return true;
  };
  const pick = (count, test, before, after, spacing, fits = () => true) => {
    const got = [];
    const cands = [];
    for (let i = 0; i < n; i++) if (test(i)) cands.push(i);
    cands.sort((a, b) => test(b, true) - test(a, true));
    for (const i of cands) {
      if (got.length >= count) break;
      if (!isFree(i, before, after) || got.some((g) => dist(g.i ?? g, i) < spacing)) continue;
      const f = fits(i);
      if (!f) continue;
      got.push(f === true ? i : { i, ...f });
      claim(i, before, after);
    }
    return got.sort((a, b) => (a.i ?? a) - (b.i ?? b));
  };
  const floor = (i, score) => (score ? F.N[i].y : F.N[i].y > 0.62);
  const wall = (i, score) => (score ? 1 - Math.abs(F.N[i].y) : Math.abs(F.N[i].y) < 0.35);

  // 1. Vertical loops, where the road crosses the floor
  const LOOP_R = 26, LOOP_LAT = width + 11, LOOP_BLEND = 18; // samples of lateral blend each side
  const loopAt = pick(loops, (i, score) => (score ? F.N[i].y : F.N[i].y > 0.45), LOOP_BLEND + 2, LOOP_BLEND + 2, 400);
  // (Jumps and corkscrews are placed after the chords, which need more room)
  let jumpAt = [], corkAt = [];

  // 3. Helixes: a banked sideways loop, a full flat turn that climbs over itself
  const HX_R = 34, HX_H = 8, HX_HOLD = 12, HX_BLEND = 26, HX_BANK = THREE.MathUtils.degToRad(55);
  const hxPoint = (i0, side, th) => {
    const T = F.T[i0], R = F.R[i0];
    const q = P0[i0].clone().addScaledVector(T, HX_R * Math.sin(th)).addScaledVector(R, side * HX_R * (1 - Math.cos(th)));
    const rr = radius - off[i0] - (-HX_H + 2 * HX_H * ss(th / (Math.PI * 2)));
    return q.sub(center).normalize().multiplyScalar(rr).add(center);
  };
  const helixFits = (i0) => {
    for (const side of [1, -1]) {
      let ok = true;
      for (let k = 1; k < 40 && ok; k++) {
        const q = hxPoint(i0, side, (k / 40) * Math.PI * 2);
        for (let j = 0; j < n && ok; j += 2) if (dist(i0, j) > 140 && q.distanceTo(P0[j]) < width * 1.6 + 8) ok = false;
      }
      if (ok) return { side };
    }
    return false;
  };
  const HX_REACH = HX_HOLD + HX_BLEND + 2;
  const helixAt = pick(helixes, (i, score) => (score ? 1 - Math.abs(F.N[i].y + 0.2) : true), HX_REACH, HX_REACH, 350, helixFits);
  for (const h of helixAt) {
    // Road dips below the surface on the way in and runs above it on the way out
    for (let d = 1; d <= HX_HOLD + HX_BLEND; d++) {
      const e = d <= HX_HOLD ? 1 : ss((HX_HOLD + HX_BLEND - d) / HX_BLEND);
      off[at(h.i - d)] -= HX_H * e;
      off[at(h.i + d)] += HX_H * e;
    }
  }

  const CORK = 34; // corkscrew length, samples (~100 units)

  // Lateral offset: loops shift the road sideways by LOOP_LAT across the loop
  const lat = new Float32Array(n);
  for (const i0 of loopAt) {
    for (let d = 1; d <= LOOP_BLEND; d++) {
      const e = 1 - d / LOOP_BLEND, s = e * e * (3 - 2 * e);
      lat[at(i0 - d)] += (-LOOP_LAT / 2) * s;
      lat[at(i0 + d)] += (LOOP_LAT / 2) * s;
    }
  }

  let pts = [];
  const col = {
    road: colors.road || '#e8e3d8',
    loop: colors.loop || '#ff3d7f',
    cork: colors.cork || '#2d7bff',
    helix: colors.helix || '#39d353',
    jump: colors.jump || '#ffd000',
    roller: colors.roller || '#ff8a1e',
  };
  const tint = new Array(n).fill(null); // section colour (roller bumps)
  const baseOf = []; // base sample each emitted point came from
  let cur = 0;
  const emit = (p, up, extra = {}) => baseOf.push(cur) && pts.push({ p, roll: 0, gap: false, boost: false, kick: false, loop: false, norail: false, color: col.road, up, ...extra });
  const road = []; // plain per-sample road frames, for chords to fork from

  const build = () => {
  pts = [];
  baseOf.length = 0;
  road.length = 0;
  for (let i = 0; i < n; i++) {
    cur = i;
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

    const hx = helixAt.find((h) => h.i === i);
    if (hx) {
      // One full banked turn, rising from below the entry road to above the exit road
      const m = Math.ceil((Math.PI * 2 * HX_R) / STEP);
      const hub = P0[i].clone().addScaledVector(R, hx.side * HX_R);
      for (let k = 0; k < m; k++) {
        const th = (k / m) * Math.PI * 2;
        const p = hxPoint(i, hx.side, th);
        const radial = center.clone().sub(p).normalize();
        const inward = hub.clone().sub(p);
        inward.addScaledVector(radial, -inward.dot(radial)).normalize();
        const kb = Math.min(1, (th / (Math.PI * 2)) / 0.25, (1 - th / (Math.PI * 2)) / 0.25);
        const b = HX_BANK * ss(kb);
        emit(p, radial.multiplyScalar(Math.cos(b)).addScaledVector(inward, Math.sin(b)), { color: col.helix });
      }
      continue;
    }

    let p = p0.addScaledVector(R, lat[i]);
    let up = N.clone();
    const extra = norail[i] ? { norail: true } : {};
    if (tint[i]) extra.color = tint[i];

    // Corkscrew: a full barrel roll around a small tube along the line
    for (const c of corkAt) {
      const k = at(i - c);
      if (k <= CORK) {
        const u = k / CORK, e = u * u * (3 - 2 * u), ph = e * Math.PI * 2, r = 3;
        p.addScaledVector(N, r * (1 - Math.cos(ph))).addScaledVector(R, -r * Math.sin(ph));
        up = N.clone().multiplyScalar(Math.cos(ph)).addScaledVector(R, Math.sin(ph));
        extra.color = col.cork;
      }
    }

    // Jump: a short kicker lip, then a gap
    for (const j of jumpAt) {
      const k = at(i - j);
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
    for (const h of helixAt) if (Math.abs(at(i - h.i + HX_REACH) - HX_REACH) <= HX_REACH) extra.color = col.helix;
    road[i] = { p: p.clone(), T, N: up.clone(), R };
    emit(p, up, extra);
  }
  };
  build();

  // 5. Chords: routes that fork off one side of the road, leave the sphere's
  // skin and cut straight through the middle to another part of the course,
  // with a loop or a double corkscrew on the way across
  const kinds = [
    { kind: 'loop', name: 'LOOP CHORD', color: colors.chordA || '#ff2bd6' },
    { kind: 'cork', name: 'TWIST CHORD', color: colors.chordB || '#00d2ff' },
    { kind: 'plain', name: 'SKY CHORD', color: colors.chordC || '#b400ff' },
  ];
  const FL = 20; // samples of flare beside the main road at each end
  const W = width + 9; // centre spacing once fully flared
  const mainPts = pts.map((q, k) => ({ p: q.p, k }));
  const chordPts = (a, b, side, kind) => {
    const out = [];
    for (let k = 0; k <= FL; k++) {
      const r = road[a + k];
      out.push({ p: r.p.clone().addScaledVector(r.R, side * W * ss(k / FL)), up: r.N.clone(), flare: true });
    }
    const A = road[a + FL], B = road[b - FL];
    const A1 = out[out.length - 1].p, B1 = B.p.clone().addScaledVector(B.R, side * W);
    const D = A1.distanceTo(B1), kk = D * 0.42;
    const c1 = A1.clone().addScaledVector(A.T, kk), c2 = B1.clone().addScaledVector(B.T, -kk);
    const bez = (t) => {
      const u = 1 - t;
      return A1.clone().multiplyScalar(u * u * u).addScaledVector(c1, 3 * u * u * t).addScaledVector(c2, 3 * u * t * t).addScaledVector(B1, t * t * t);
    };
    const dense = [A1.clone()], cl = [0];
    for (let k = 1; k <= 400; k++) {
      dense.push(bez(k / 400));
      cl.push(cl[k - 1] + dense[k].distanceTo(dense[k - 1]));
    }
    const m = Math.max(8, Math.round(cl[400] / STEP));
    const Q = [];
    for (let k = 1, j = 0; k < m; k++) {
      const s = (k / m) * cl[400];
      while (cl[j + 1] < s) j++;
      Q.push(dense[j].clone().lerp(dense[j + 1], (s - cl[j]) / (cl[j + 1] - cl[j])));
    }
    // Frames along the chord: transport the fork's up, then spread the
    // mismatch with the join's up over the whole chord
    const Ts = Q.map((q, k) => (k + 1 < Q.length ? Q[k + 1] : B1).clone().sub(k > 0 ? Q[k - 1] : A1).normalize());
    const U = [];
    let u = A.N.clone();
    let tp = A.T.clone();
    for (const t of Ts) {
      u.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(tp, t));
      u.addScaledVector(t, -u.dot(t)).normalize();
      U.push(u.clone());
      tp = t;
    }
    const tEnd = B.T, uEnd = u.clone().applyQuaternion(new THREE.Quaternion().setFromUnitVectors(tp, tEnd));
    const mis = Math.atan2(new THREE.Vector3().crossVectors(uEnd, B.N).dot(tEnd), uEnd.dot(B.N));
    const spin = kind === 'cork' ? (mis >= 0 ? 1 : -1) * Math.PI * 4 : 0;
    const mid = Math.floor(Q.length / 2);
    const BL = 18;
    for (let k = 0; k < Q.length; k++) {
      const t = Ts[k], e = ss((k + 1) / (Q.length + 1));
      const base = U[k].clone().applyAxisAngle(t, mis * e);
      const right = new THREE.Vector3().crossVectors(t, base).normalize();
      let p = Q[k].clone();
      let up = base;
      if (kind === 'cork') {
        // Two barrel rolls round a small tube, in the middle of the chord
        const ph = spin * ss((k / Q.length - 0.25) / 0.5), r = 3;
        up = base.clone().multiplyScalar(Math.cos(ph)).addScaledVector(right, Math.sin(ph));
        p.addScaledVector(base, r).addScaledVector(up, -r);
      }
      if (kind === 'loop') {
        const d = k - mid;
        if (Math.abs(d) <= BL && d !== 0) p.addScaledVector(right, (d < 0 ? -1 : 1) * (LOOP_LAT / 2) * ss(1 - Math.abs(d) / BL));
        if (d === 0) {
          const lm = Math.ceil((Math.PI * 2 * LOOP_R) / STEP);
          for (let j = 0; j < lm; j++) {
            const th = (j / lm) * Math.PI * 2;
            const l = -LOOP_LAT / 2 + (LOOP_LAT * (th - Math.sin(th))) / (Math.PI * 2);
            const lp = p.clone().addScaledVector(t, LOOP_R * Math.sin(th)).addScaledVector(base, LOOP_R * (1 - Math.cos(th))).addScaledVector(right, l);
            out.push({ p: lp, up: base.clone().multiplyScalar(Math.cos(th)).addScaledVector(t, -Math.sin(th)), loop: true });
          }
          p.addScaledVector(right, LOOP_LAT / 2);
        }
      }
      out.push({ p, up });
    }
    for (let k = FL; k >= 0; k--) {
      const r = road[b - k];
      out.push({ p: r.p.clone().addScaledVector(r.R, side * W * ss(k / FL)), up: r.N.clone(), flare: true });
    }
    return out;
  };

  const chordAt = [];
  {
    // Chords keep their own, lighter spacing: clear of the start, loops,
    // helixes and the crossings themselves, and of each other
    const cbusy = new Uint8Array(n);
    const cclaim = (i, before, after) => {
      for (let d = -before; d <= after; d++) cbusy[at(i + d)] = 1;
    };
    cclaim(0, 40, 40);
    for (const c of crossings) {
      cclaim(c.i, 6, 6);
      cclaim(c.j, 6, 6);
    }
    for (const i0 of loopAt) cclaim(i0, LOOP_BLEND + 2, LOOP_BLEND + 2);
    for (const h of helixAt) cclaim(h.i, HX_REACH, HX_REACH);
    const isFreeC = (i, before, after) => {
      for (let d = -before; d <= after; d++) if (cbusy[at(i + d)]) return false;
      return true;
    };
    const free = (i) => road[i] && isFreeC(i, 6, FL + 14);
    const cands = [];
    for (let a = 45; a < n - 45; a += 3) {
      if (!free(a)) continue;
      for (let b = a + 100; b < n - 45; b += 3) {
        if (!road[b] || !isFreeC(b, FL + 14, 6)) continue;
        const arc = (b - a) * STEP;
        if (arc < 450 || arc > 2400) continue;
        const A = road[a], B = road[b];
        const dir = B.p.clone().sub(A.p);
        const D = dir.length();
        if (D < 200) continue;
        const side = Math.sign(dir.dot(A.R));
        if (Math.sign(A.p.clone().sub(B.p).dot(B.R)) !== side) continue;
        cands.push({ a, b, side, D, score: D - Math.abs(arc - 1000) * 0.1 });
      }
    }
    cands.sort((x, y) => y.score - x.score);
    if (globalThis.SPH_DEBUG) {
      const fa = [], fb = [];
      for (let i = 45; i < n - 45; i += 3) { if (free(i)) fa.push(i); if (road[i] && isFreeC(i, FL + 14, 6)) fb.push(i); }
      globalThis.SPH_DEBUG.push('cands ' + cands.length + ' n ' + n + ' freeA ' + JSON.stringify(fa) + ' busy% ' + Math.round(100 * busy.reduce((x, y) => x + y) / n));
    }
    const taken = [];
    for (const c of cands) {
      if (chordAt.length >= Math.min(chords, kinds.length)) break;
      if (!isFreeC(c.a, 6, FL + 14) || !isFreeC(c.b, FL + 14, 6)) continue;
      const kd = kinds[chordAt.length];
      const cp = chordPts(c.a, c.b, c.side, kd.kind);
      // Stays inside the sphere, clear of the main road and of other chords
      const near = (k) => (k >= c.a - 6 && k <= c.a + FL + 26) || (k >= c.b - FL - 26 && k <= c.b + 6);
      let ok = true;
      for (const q of cp) {
        if (!q.flare && q.p.distanceTo(center) > radius + 1.5) ok = false;
        for (let j = 0; j < mainPts.length && ok; j += 2) if (!near(baseOf[j]) && q.p.distanceTo(mainPts[j].p) < 20) ok = false;
        for (const o of taken) for (let j = 0; j < o.length && ok; j += 2) if (q.p.distanceTo(o[j].p) < 24) ok = false;
        if (!ok) break;
      }
      if (globalThis.SPH_DEBUG) globalThis.SPH_DEBUG.push([c.a, c.b, Math.round(c.D), ok]);
      if (!ok) continue;
      taken.push(cp);
      chordAt.push({ ...c, ...kd, pts: cp });
      for (const f of [claim, cclaim]) {
        f(c.a, 6, FL + 14);
        f(c.b, FL + 14, 6);
      }
    }
  }
  // Jumps on the floor (flight uses real gravity), corkscrews on the walls
  jumpAt = pick(jumps, (i, score) => (score ? F.N[i].y : F.N[i].y > 0.5), 8, 20, 150);
  corkAt = pick(corkscrews, (i, score) => (score ? 1 - Math.abs(F.N[i].y) : Math.abs(F.N[i].y) < 0.6), 4, CORK + 4, 150);

  // 6. Hills and rollers in the stretches that are left. They fade out near
  // crossings, so over/unders keep their clearance and junctions stay level.
  const calm = new Float32Array(n).fill(1);
  for (const c of crossings) {
    for (const j of [c.i, c.j]) {
      for (let d = -3 * sigma; d <= 3 * sigma; d++) calm[at(j + d)] = Math.min(calm[at(j + d)], 1 - Math.exp(-(d * d) / (2 * sigma * sigma)));
    }
  }
  // Only real features block them (crossings are handled by `calm`)
  const fbusy = new Uint8Array(n);
  const fclaim = (i, before, after) => {
    for (let d = -before; d <= after; d++) fbusy[at(i + d)] = 1;
  };
  fclaim(0, 40, 40);
  for (const i0 of loopAt) fclaim(i0, LOOP_BLEND + 2, LOOP_BLEND + 2);
  for (const h of helixAt) fclaim(h.i, HX_REACH, HX_REACH);
  for (const j of jumpAt) fclaim(j, 10, 22);
  for (const c of corkAt) fclaim(c, 4, CORK + 4);
  for (const c of chordAt) {
    fclaim(c.a, 6, FL + 14);
    fclaim(c.b, FL + 14, 6);
  }
  for (let i = 0; i < n; i++) if (norail[i]) fclaim(i, 2, 2);
  const runs = [];
  for (let i = 0; i < n; ) {
    if (fbusy[i]) {
      i++;
      continue;
    }
    let j = i;
    while (j < n && !fbusy[j]) j++;
    runs.push([i, j - i]);
    i = j;
  }
  let hills = 0, rollers = 0;
  if (globalThis.SPH_DEBUG) globalThis.SPH_DEBUG.push("runs " + JSON.stringify(runs));
  runs.forEach(([r0, len], k) => {
    if (len < 26) return;
    const hill = len >= 65 && hills <= rollers;
    const lam = hill ? 55 : 13; // wavelength, samples
    const A = hill ? 6 : 1.4;
    const waves = Math.max(1, Math.floor((len - 6) / lam));
    const span = len - 6;
    for (let q = 0; q <= span; q++) {
      const i = at(r0 + 3 + q);
      const env = ss(Math.min(q, span - q) / (hill ? 14 : 5));
      off[i] += A * Math.sin((Math.PI * 2 * waves * q) / span) * env * calm[i];
      if (!hill && env * calm[i] > 0.5) tint[i] = col.roller;
    }
    if (hill) hills++;
    else rollers++;
  });
  build();

  const marks = {};
  const branches = chordAt.map((c, k) => {
    marks[`c${k}a`] = { pos: road[c.a].p.clone() };
    marks[`c${k}b`] = { pos: road[c.b].p.clone() };
    const color = c.color;
    return {
      from: `c${k}a`,
      to: `c${k}b`,
      side: c.side,
      name: c.name,
      color,
      pts: c.pts.map((q) => ({ p: q.p, roll: 0, gap: false, boost: false, kick: false, loop: !!q.loop, norail: false, color: q.loop ? col.loop : color, up: q.up })),
    };
  });

  return {
    pts,
    marks,
    branches,
    info: {
      length: L,
      crossings: crossings.length,
      through: crossings.filter((c) => c.through).length,
      loops: loopAt.length,
      jumps: jumpAt.length,
      corkscrews: corkAt.length,
      helixes: helixAt.length,
      hills,
      rollers,
      chords: chordAt.map((c) => `${c.name} ${Math.round((c.b - c.a) * STEP)}→${Math.round(c.pts.length * STEP)}`),
      center,
      radius,
    },
  };
}
