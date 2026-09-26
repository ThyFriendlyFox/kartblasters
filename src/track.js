import * as THREE from 'three';
import { TRACKS, TrackTurtle } from './trackdefs.js';

const DS = 1; // physics sample spacing along the track (world units)

function wrapAngle(a) {
  return Math.atan2(Math.sin(a), Math.cos(a));
}

/**
 * A 3D road centerline sampled every DS units into position (P), tangent (T),
 * up (N) and right (R) frames. Frames use parallel transport so loops and
 * corkscrews keep "up" pointing at the driver, plus automatic banking.
 * The main circuit is a closed Path; alternate routes are open Paths.
 */
export class Path {
  constructor(pts, { closed = true, hw = 7.5, N0 = null, N1 = null, level = [] } = {}) {
    this.closed = closed;
    this.hw = hw;
    const curve = new THREE.CatmullRomCurve3(pts.map((p) => p.p), closed, 'centripetal');
    curve.arcLengthDivisions = pts.length * 12;
    const L = curve.getLength();
    const n = closed ? Math.round(L / DS) : Math.round(L / DS) + 1;
    this.n = n;
    this.ds = closed ? L / n : L / (n - 1);
    this.L = L;
    const nb = (i) => (closed ? ((i % n) + n) % n : Math.max(0, Math.min(n - 1, i)));

    const P = (this.P = new Float32Array(n * 3));
    const T = (this.T = new Float32Array(n * 3));
    const N = (this.N = new Float32Array(n * 3));
    const R = (this.R = new Float32Array(n * 3));
    this.k = new Float32Array(n); // curvature toward +R (1/units)
    this.gap = new Uint8Array(n);
    this.boost = new Uint8Array(n);
    this.kick = new Uint8Array(n);
    this.railL = new Uint8Array(n).fill(1);
    this.railR = new Uint8Array(n).fill(1);
    // Lateral extent of the drawn road surface (a branch trims away the part
    // that lies inside the main road at a fork or join)
    this.clipL = new Float32Array(n).fill(-hw);
    this.clipR = new Float32Array(n).fill(hw);
    this.color = [];

    const np = pts.length;
    const roll = new Float32Array(n);
    const upAt = new Array(n).fill(null); // explicit up (corkscrews)
    const v = new THREE.Vector3(), t = new THREE.Vector3();
    for (let i = 0; i < n; i++) {
      const u = closed ? i / n : i / (n - 1);
      curve.getPointAt(u, v);
      curve.getTangentAt(u, t);
      P.set([v.x, v.y, v.z], i * 3);
      T.set([t.x, t.y, t.z], i * 3);
      // Map to control point index to fetch per-point attributes
      const f = curve.getUtoTmapping(u) * (closed ? np : np - 1);
      const i0 = Math.min(Math.floor(f), np - 1) % np, i1 = closed ? (i0 + 1) % np : Math.min(i0 + 1, np - 1), fr = f - Math.floor(f);
      const a = pts[i0], b = pts[i1];
      roll[i] = a.roll + wrapAngle(b.roll - a.roll) * fr;
      if (a.up && b.up) upAt[i] = a.up.clone().lerp(b.up, fr).normalize();
      this.gap[i] = a.gap && b.gap ? 1 : a.gap && fr < 0.5 ? 1 : b.gap && fr >= 0.5 ? 1 : 0;
      this.boost[i] = (fr < 0.5 ? a.boost : b.boost) ? 1 : 0;
      this.kick[i] = a.kick || b.kick ? 1 : 0;
      this.color.push((fr < 0.5 ? a.color : b.color) || '#ff7a00');
    }

    // Parallel-transport the up vector along the curve
    const Ti = new THREE.Vector3(), Tp = new THREE.Vector3(), Nv = N0 ? N0.clone() : new THREE.Vector3(0, 1, 0), axis = new THREE.Vector3();
    const q = new THREE.Quaternion();
    Tp.fromArray(T, 0);
    Nv.addScaledVector(Tp, -Nv.dot(Tp)).normalize();
    const Nstart = Nv.clone();
    const Nt = [];
    for (let i = 0; i < n; i++) {
      Ti.fromArray(T, i * 3);
      if (i > 0) {
        axis.crossVectors(Tp, Ti);
        const sn = axis.length();
        if (sn > 1e-8) {
          q.setFromAxisAngle(axis.divideScalar(sn), Math.atan2(sn, Tp.dot(Ti)));
          Nv.applyQuaternion(q);
        }
        Nv.addScaledVector(Ti, -Nv.dot(Ti)).normalize();
      }
      Nt.push(Nv.clone());
      Tp.copy(Ti);
    }
    // Closed loops: remove accumulated twist so the seam lines up
    let twist = 0;
    if (closed) {
      Ti.fromArray(T, 0);
      axis.crossVectors(Tp, Ti);
      const endN = Nv.clone();
      const sn = axis.length();
      if (sn > 1e-8) endN.applyQuaternion(q.setFromAxisAngle(axis.divideScalar(sn), Math.atan2(sn, Tp.dot(Ti))));
      const cr = new THREE.Vector3().crossVectors(endN, Nstart);
      twist = Math.atan2(cr.dot(Ti), endN.dot(Nstart));
    }

    // Parallel transport through a corkscrew leaves an open route rolled at
    // its far end. Undo that inside the stunt itself, so the route rejoins
    // the main road level.
    const twistAt = new Float32Array(n);
    // Corkscrews give their up explicitly (toward the tube's axis); parallel
    // transport alone drifts through a helix. Steer the frame onto it there,
    // and carry the correction on past the corkscrew.
    const corr = new Float32Array(n);
    if (upAt.some(Boolean)) {
      let c = 0;
      const nv = new THREE.Vector3(), tgt = new THREE.Vector3(), cr = new THREE.Vector3();
      for (let i = 0; i < n; i++) {
        if (upAt[i]) {
          Ti.fromArray(T, i * 3);
          nv.copy(Nt[i]).applyAxisAngle(Ti, roll[i]);
          tgt.copy(upAt[i]).addScaledVector(Ti, -upAt[i].dot(Ti));
          if (tgt.lengthSq() > 1e-6) {
            tgt.normalize();
            const raw = Math.atan2(cr.crossVectors(nv, tgt).dot(Ti), nv.dot(tgt));
            c += wrapAngle(raw - c);
          }
        }
        corr[i] = c;
      }
    }
    // (The main circuit keeps its seam twist spread over the whole lap: that
    // lean is part of its character.)
    // (Minus whatever the corkscrew correction already covers at the seam.)
    const seam = wrapAngle(twist - corr[n - 1]);
    if (closed) for (let i = 0; i < n; i++) twistAt[i] = (seam * i) / n;
    for (let i = 0; i < n; i++) twistAt[i] += corr[i];
    let need = 0;
    if (!closed && N1) {
      Ti.fromArray(T, (n - 1) * 3);
      const endN = Nt[n - 1].clone().applyAxisAngle(Ti, roll[n - 1] + corr[n - 1]);
      const target = N1.clone().addScaledVector(Ti, -N1.dot(Ti)).normalize();
      const cr = new THREE.Vector3().crossVectors(endN, target);
      need = Math.atan2(cr.dot(Ti), endN.dot(target));
    }
    if (need) {
      // Transport twist builds up where the road climbs/dives while turning
      const w = new Float32Array(n);
      let tot = 0;
      for (let i = 0; i < n; i++) {
        const ty = T[i * 3 + 1];
        tot += w[i] = upAt[i] ? 0 : ty ** 4 + 0.0005;
      }
      let acc = 0;
      for (let i = 0; i < n; i++) {
        twistAt[i] += (need * acc) / tot;
        acc += w[i];
      }
    }

    // Around each fork and join the main road is brought level (no lean and
    // no banking), so it and the branch meet flat...
    const lvl = new Float32Array(n).fill(1);
    const RAMP = 30;
    for (const z of level) {
      let best = 0, bd = Infinity;
      for (let i = 0; i < n; i++) {
        const dd = v.fromArray(P, i * 3).distanceToSquared(z.pos);
        if (dd < bd) (bd = dd), (best = i);
      }
      for (let j = -z.before - RAMP; j <= z.after + RAMP; j++) {
        const out = j < -z.before ? -z.before - j : j > z.after ? j - z.after : 0;
        const i = nb(best + Math.round(j / this.ds));
        lvl[i] = Math.min(lvl[i], out / RAMP);
      }
    }
    if (level.length) {
      const up = new THREE.Vector3(), nv = new THREE.Vector3(), cr = new THREE.Vector3();
      for (let i = 0; i < n; i++) {
        if (lvl[i] >= 1) continue;
        Ti.fromArray(T, i * 3);
        up.set(0, 1, 0).addScaledVector(Ti, -Ti.y);
        if (up.lengthSq() < 1e-4) continue;
        up.normalize();
        nv.copy(Nt[i]).applyAxisAngle(Ti, twistAt[i] + roll[i]);
        const lean = Math.atan2(cr.crossVectors(nv, up).dot(Ti), nv.dot(up));
        twistAt[i] += lean * (1 - lvl[i]);
      }
    }

    // Base frames (with twist correction and explicit roll)
    const Rv = new THREE.Vector3();
    const baseR = [];
    for (let i = 0; i < n; i++) {
      Ti.fromArray(T, i * 3);
      const nv = Nt[i].applyAxisAngle(Ti, twistAt[i] + roll[i]);
      Rv.crossVectors(Ti, nv).normalize();
      baseR.push(Rv.clone());
    }

    // Auto banking from curvature in the road plane, smoothed
    const bank = new Float32Array(n);
    const tA = new THREE.Vector3(), tB = new THREE.Vector3();
    for (let i = 0; i < n; i++) {
      tA.fromArray(T, nb(i - 2) * 3);
      tB.fromArray(T, nb(i + 2) * 3);
      const kR = tB.sub(tA).divideScalar(4 * this.ds).dot(baseR[i]);
      bank[i] = upAt[i] ? 0 : THREE.MathUtils.clamp(kR * 16, -0.7, 0.7) * Math.max(0, Nt[i].y);
    }
    const W = 18;
    for (let i = 0; i < n; i++) {
      let acc = 0;
      for (let j = -W; j <= W; j++) acc += bank[nb(i + j)];
      // ...and open routes don't bank through their S-bends at either end
      const EDGE = 110;
      const edge = closed ? lvl[i] : Math.min(1, (i * this.ds) / EDGE, ((n - 1 - i) * this.ds) / EDGE);
      Ti.fromArray(T, i * 3);
      const nv = Nt[i].applyAxisAngle(Ti, (acc / (2 * W + 1)) * edge);
      Rv.crossVectors(Ti, nv).normalize();
      N.set([nv.x, nv.y, nv.z], i * 3);
      R.set([Rv.x, Rv.y, Rv.z], i * 3);
    }
    for (let i = 0; i < n; i++) {
      tA.fromArray(T, nb(i - 1) * 3);
      tB.fromArray(T, nb(i + 1) * 3);
      Rv.fromArray(R, i * 3);
      this.k[i] = tB.sub(tA).divideScalar(2 * this.ds).dot(Rv);
    }

    this.gaps = [];
    for (let i = 0; i < n; i++) {
      if (this.gap[i] && !(i > 0 || closed ? this.gap[nb(i - 1)] : 0)) {
        let j = i;
        while (j < n * 2 && this.gap[nb(j)]) j++;
        this.gaps.push({ start: i * this.ds, end: j * this.ds });
      }
    }
  }

  idx(s) {
    if (!this.closed) return Math.max(0, Math.min(this.n - 1, Math.floor(s / this.ds)));
    let i = Math.floor(s / this.ds) % this.n;
    if (i < 0) i += this.n;
    return i;
  }

  wrap(s) {
    if (!this.closed) return Math.max(0, Math.min(this.L, s));
    s %= this.L;
    return s < 0 ? s + this.L : s;
  }

  /** Signed shortest distance from a to b along the path. */
  delta(a, b) {
    let d = b - a;
    if (!this.closed) return d;
    if (d > this.L / 2) d -= this.L;
    if (d < -this.L / 2) d += this.L;
    return d;
  }

  /** Interpolated frame at arc length s. Writes into out {P,T,N,R}. */
  frame(s, out) {
    s = this.wrap(s);
    const f = s / this.ds;
    let i = Math.floor(f), t = f - i;
    let j;
    if (this.closed) {
      i %= this.n;
      j = (i + 1) % this.n;
    } else {
      if (i >= this.n - 1) {
        i = this.n - 2;
        t = 1;
      }
      j = i + 1;
    }
    for (const key of ['P', 'T', 'N', 'R']) {
      const a = this[key];
      out[key].set(
        a[i * 3] + (a[j * 3] - a[i * 3]) * t,
        a[i * 3 + 1] + (a[j * 3 + 1] - a[i * 3 + 1]) * t,
        a[i * 3 + 2] + (a[j * 3 + 2] - a[i * 3 + 2]) * t,
      );
    }
    out.T.normalize();
    out.N.normalize();
    out.R.normalize();
    out.k = this.k[i];
    out.gap = this.gap[i];
    out.boost = this.boost[i];
    out.i = i;
    return out;
  }

  static newFrame() {
    return { P: new THREE.Vector3(), T: new THREE.Vector3(), N: new THREE.Vector3(), R: new THREE.Vector3(), k: 0, gap: 0, boost: 0, i: 0 };
  }

  /** World position of a point in path coordinates. */
  toWorld(s, d, h, out, fr = Path.newFrame()) {
    this.frame(s, fr);
    return out.copy(fr.P).addScaledVector(fr.R, d).addScaledVector(fr.N, h);
  }

  /** Nearest sample index to a world point (used to locate route marks). */
  nearest(p) {
    let best = 0, bd = Infinity;
    for (let i = 0; i < this.n; i++) {
      const d = (this.P[i * 3] - p.x) ** 2 + (this.P[i * 3 + 1] - p.y) ** 2 + (this.P[i * 3 + 2] - p.z) ** 2;
      if (d < bd) {
        bd = d;
        best = i;
      }
    }
    return best;
  }

  buildRoad(scene, theme, { startLine = false, lift = 0, beneath = false } = {}) {
    const n = this.n, hw = this.hw;
    const STEP = 2; // mesh every 2 samples
    const rows = [];
    if (this.closed) {
      for (let i = 0; i <= n; i += STEP) rows.push(i % n);
      if (rows[rows.length - 1] !== 0) rows.push(0);
    } else {
      for (let i = 0; i < n; i += STEP) rows.push(i);
      if (rows[rows.length - 1] !== n - 1) rows.push(n - 1);
    }

    // Cross-section: [lateral, normal] pairs; each strip is a quad band
    const railH = 1.0, railW = 0.6, thick = 0.6;
    const road = [[-hw, 0.02], [hw, 0.02]];
    const strips = {
      road: [road],
      rail: [
        [[-hw - railW, -thick], [-hw - railW, railH]],
        [[-hw - railW, railH], [-hw, railH]],
        [[-hw, railH], [-hw, 0]],
        [[hw, 0], [hw, railH]],
        [[hw, railH], [hw + railW, railH]],
        [[hw + railW, railH], [hw + railW, -thick]],
      ],
      under: [[[hw + railW, -thick], [-hw - railW, -thick]]],
    };

    const P = new THREE.Vector3(), N = new THREE.Vector3(), R = new THREE.Vector3();
    const col = new THREE.Color();
    const build = (list, uvScale, useColor, isRail = false, isRoad = false) => {
      const pos = [], uv = [], colors = [];
      for (let r = 0; r < rows.length - 1; r++) {
        const i0 = rows[r], i1 = rows[r + 1];
        if (this.gap[i0] || this.gap[i1]) continue;
        for (let li = 0; li < list.length; li++) {
          const [a, b] = list[li];
          if (isRail && !(li < 3 ? this.railL[i0] && this.railL[i1] : this.railR[i0] && this.railR[i1])) continue;
          const quad = [];
          for (const [ii, pt, uu] of [[i0, a, 0], [i0, b, 1], [i1, b, 1], [i1, a, 0]]) {
            P.fromArray(this.P, ii * 3);
            N.fromArray(this.N, ii * 3);
            R.fromArray(this.R, ii * 3);
            let lat = pt[0];
            if (isRoad && this.clipL[ii] > -hw) lat = Math.max(lat, this.clipL[ii]);
            if (isRoad && this.clipR[ii] < hw) lat = Math.min(lat, this.clipR[ii]);
            P.addScaledVector(R, lat).addScaledVector(N, pt[1] + lift);
            const vv = ((ii === 0 && r > 0 ? n : ii) * this.ds) / uvScale;
            quad.push([P.x, P.y, P.z, uu, vv, ii]);
          }
          for (const k of [0, 1, 2, 0, 2, 3]) {
            const q = quad[k];
            pos.push(q[0], q[1], q[2]);
            uv.push(q[3], q[4]);
            if (useColor) {
              col.set(this.color[q[5]]);
              colors.push(col.r, col.g, col.b);
            }
          }
        }
      }
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
      g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
      if (useColor) g.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
      g.computeVertexNormals();
      return g;
    };

    const neon = theme === 'neon';
    const roadMat = new THREE.MeshStandardMaterial({
      map: roadTexture(neon),
      vertexColors: true,
      roughness: neon ? 0.35 : 0.45,
      metalness: neon ? 0.3 : 0.05,
      side: THREE.DoubleSide,
      emissive: neon ? '#0a1440' : '#000000',
      // Where a branch road still overlaps the main road at a fork or join,
      // the main road wins: it stays whole and the branch only shows where it
      // flares out past the main road's edge
      polygonOffset: beneath,
      polygonOffsetFactor: beneath ? 1 : 0,
      polygonOffsetUnits: beneath ? 4 : 0,
    });
    const railMat = neon
      ? new THREE.MeshStandardMaterial({ color: '#ffe600', emissive: '#b8a000', emissiveIntensity: 0.8, side: THREE.DoubleSide })
      : new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.4, side: THREE.DoubleSide });
    const underMat = new THREE.MeshStandardMaterial({ color: neon ? '#101428' : '#c55e00', side: THREE.DoubleSide });

    const roadMesh = new THREE.Mesh(build(strips.road, 16, true, false, true), roadMat);
    roadMesh.receiveShadow = true;
    const railMesh = new THREE.Mesh(build(strips.rail, 16, !neon, true), railMat);
    railMesh.castShadow = true;
    const underMesh = new THREE.Mesh(build(strips.under, 16, false, false, true), underMat);
    underMesh.castShadow = true;
    scene.add(roadMesh, railMesh, underMesh);

    // Boost pads
    const padTex = chevronTexture();
    const padMat = new THREE.MeshBasicMaterial({ map: padTex, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide });
    this.padMats = [padMat];
    for (let i = 0; i < n; i++) {
      if (!this.boost[i] || (i > 0 || this.closed ? this.boost[(i - 1 + n) % n] : 0)) continue;
      let j = i;
      while (j < i + n && this.boost[j % n] && (this.closed || j < n - 1)) j++;
      const len = j - i;
      const pos = [], uv = [];
      for (let k = i; k < j; k++) {
        for (const [kk, lat, u] of [[k, -hw * 0.6, 0], [k, hw * 0.6, 1], [k + 1, hw * 0.6, 1], [k, -hw * 0.6, 0], [k + 1, hw * 0.6, 1], [k + 1, -hw * 0.6, 0]]) {
          const m = kk % n;
          P.fromArray(this.P, m * 3).addScaledVector(R.fromArray(this.R, m * 3), lat).addScaledVector(N.fromArray(this.N, m * 3), 0.08);
          pos.push(P.x, P.y, P.z);
          uv.push(u, ((kk - i) / len) * (len / 6));
        }
      }
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
      g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
      scene.add(new THREE.Mesh(g, padMat));
    }

    const fr = Path.newFrame();
    if (startLine) this.buildStart(scene, neon, fr);
    this.buildStands(scene, neon);
  }

  buildStart(scene, neon, fr) {
    const hw = this.hw;
    this.frame(0, fr);
    const line = new THREE.Mesh(new THREE.PlaneGeometry(hw * 2, 3), new THREE.MeshBasicMaterial({ map: checkerTexture() }));
    line.position.copy(fr.P).addScaledVector(fr.N, 0.06);
    line.quaternion.setFromRotationMatrix(new THREE.Matrix4().makeBasis(fr.R, fr.T, fr.N));
    scene.add(line);
    const archMat = new THREE.MeshStandardMaterial({ color: neon ? '#ff2bd6' : '#e11d48', emissive: neon ? '#7a0066' : '#000' });
    for (const side of [-1, 1]) {
      const post = new THREE.Mesh(new THREE.BoxGeometry(1, 9, 1), archMat);
      post.position.copy(fr.P).addScaledVector(fr.R, side * (hw + 1.5)).addScaledVector(fr.N, 4.5);
      post.quaternion.copy(line.quaternion);
      scene.add(post);
    }
    const banner = new THREE.Mesh(new THREE.BoxGeometry(hw * 2 + 4, 2.2, 0.6), new THREE.MeshBasicMaterial({ map: bannerTexture(neon) }));
    banner.position.copy(fr.P).addScaledVector(fr.N, 9);
    banner.quaternion.setFromRotationMatrix(new THREE.Matrix4().makeBasis(fr.R, fr.N, fr.T.clone().negate()));
    scene.add(banner);
  }

  buildStands(scene, neon) {
    const n = this.n;
    const P = new THREE.Vector3(), N = new THREE.Vector3();
    // Support stands under the track
    const standMat = new THREE.MeshStandardMaterial({ color: neon ? '#3b3f5c' : '#9aa3ad', metalness: neon ? 0.6 : 0.1, roughness: 0.5 });
    const glowMat = new THREE.MeshBasicMaterial({ color: '#00e5ff' });
    for (let i = 0; i < n; i += Math.round(24 / this.ds)) {
      if (this.gap[i]) continue;
      P.fromArray(this.P, i * 3);
      N.fromArray(this.N, i * 3);
      if (N.y < 0.85 || P.y < 1.5) continue;
      const top = P.clone().addScaledVector(N, -0.6);
      const h = top.y;
      const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.45, 0.6, h, 10), standMat);
      pole.position.set(top.x, h / 2, top.z);
      pole.castShadow = true;
      scene.add(pole);
      const foot = new THREE.Mesh(new THREE.CylinderGeometry(1.6, 1.8, 0.4, 16), neon ? glowMat : standMat);
      foot.position.set(top.x, 0.2, top.z);
      scene.add(foot);
    }
  }

  update(dt) {
    for (const m of this.padMats || []) m.map.offset.y -= dt * 2.5;
  }
}

/**
 * The race circuit: a closed main Path plus optional alternate routes
 * (branches) that fork off one side of the road and rejoin later, some
 * locked behind key pickups.
 */
export class Track extends Path {
  constructor(id) {
    const def = TRACKS[id] || TRACKS.orange;
    const turtle = def.build();
    const level = (def.branches || []).flatMap((bd) => [
      { pos: turtle.marks[bd.from].pos, before: 10, after: 130 },
      { pos: turtle.marks[bd.to].pos, before: 130, after: 10 },
    ]);
    super(turtle.pts, { closed: true, hw: def.width / 2, level });
    this.def = def;
    this.id = TRACKS[id] ? id : 'orange';
    this.marks = turtle.marks || {};
    this.branches = [];
    this.keys = [];
    const fr = Path.newFrame();
    const markS = (name) => {
      const m = this.marks[name];
      if (!m) throw new Error(`Track ${id}: missing mark ${name}`);
      return this.nearest(m.pos) * this.ds;
    };
    (def.branches || []).forEach((bd, bi) => {
      const a = markS(bd.from), b = markS(bd.to);
      const side = bd.side || 1;
      // The route leaves from the main road's own centerline and heading (a true Y),
      // and rejoins the same way (an inverse Y)
      this.frame(a, fr);
      const N0 = fr.N.clone();
      const bt = new TrackTurtle(fr.P.x, fr.P.y, fr.P.z, Math.atan2(fr.T.x, fr.T.z), def.width).paint(bd.color || '#ff7a00');
      bd.build(bt);
      this.frame(b, fr);
      try {
        bt.closeS(fr.P.clone(), Math.atan2(fr.T.x, fr.T.z));
      } catch (e) {
        throw new Error(`Track ${id}, route ${bd.name}: ${e.message}`);
      }
      const path = new Path(bt.pts, { closed: false, hw: this.hw, N0, N1: fr.N.clone() });
      const br = { id: bi + 1, path, from: a, to: b, side, name: bd.name || 'ALT ROUTE', lock: bd.lock || null };
      br.fork = this.splitZone(path, a, +1);
      br.join = this.splitZone(path, b, -1);
      this.trimBranchSurface(br);
      // Where the two roads overlap, the inner rails give way to one wide road...
      const mainRail = side > 0 ? this.railR : this.railL;
      for (let s = a - 1; s <= br.fork.gs + 0.5; s += this.ds) mainRail[this.idx(s)] = 0;
      for (let s = br.join.gs - 0.5; s <= b + 1; s += this.ds) mainRail[this.idx(s)] = 0;
      const inner = side > 0 ? path.railL : path.railR;
      // ...and the route's paint fades in from the main road's color after the
      // gore (and back out before the join) instead of switching at a hard line
      const FADE = 26;
      const ca = new THREE.Color(), cb = new THREE.Color();
      for (let i = 0; i < path.n; i++) {
        const bs = i * path.ds;
        if (bs <= br.fork.bs + 0.5 || bs >= br.join.bs - 0.5) inner[i] = 0;
        const fromFork = bs - br.fork.bs, toJoin = br.join.bs - bs;
        const near = fromFork < toJoin;
        const k = Math.min(1, Math.max(0, (near ? fromFork : toJoin) / FADE));
        if (k >= 1) continue;
        ca.set(this.color[this.idx(near ? a + bs : b - (path.L - bs))]);
        cb.set(path.color[i]);
        path.color[i] = '#' + ca.lerp(cb, k * k * (3 - 2 * k)).getHexString();
      }
      this.branches.push(br);
    });
    for (const k of def.keys || []) this.keys.push({ id: k.id, s: markS(k.at), d: k.d || 0 });
  }

  /**
   * Before the fork's gore (and after the join's), part of the branch lies
   * inside the main road. Trim the branch's drawn surface back to the main
   * road's edge, so the main road stays whole and the branch only appears
   * where it flares out beside it.
   */
  trimBranchSurface(br) {
    const path = br.path, fm = Path.newFrame(), fb = Path.newFrame(), rel = new THREE.Vector3();
    for (let i = 0; i < path.n; i++) {
      const bs = i * path.ds;
      const atFork = bs <= br.fork.bs + 1;
      if (!atFork && bs < br.join.bs - 1) continue;
      path.frame(bs, fb);
      // Main-road point alongside this branch sample
      let sm = atFork ? br.from + bs : br.to - (path.L - bs);
      for (let k = 0; k < 4; k++) {
        this.frame(sm, fm);
        sm += rel.copy(fb.P).sub(fm.P).dot(fm.T);
      }
      this.frame(sm, fm);
      const dm = rel.copy(fb.P).sub(fm.P).dot(fm.R);
      const cos = fb.R.dot(fm.R);
      if (cos < 0.2) continue;
      // Branch lateral where its cross-section meets the main road's edge
      const lam = THREE.MathUtils.clamp((br.side * this.hw - dm) / cos, -this.hw, this.hw);
      if (br.side > 0) path.clipL[i] = lam;
      else path.clipR[i] = lam;
    }
  }

  /**
   * Follow the branch alongside the main road from the fork (dir=+1) or back
   * from the join (dir=-1) until the two roads no longer overlap (the "gore").
   * Records the branch's lateral offset (in the main road's frame) per unit of
   * main-road distance so physics can let cars use the whole widening road.
   */
  splitZone(path, s0, dir) {
    const gap = 2 * this.hw + 1.0; // centerlines this far apart = rails just touch
    const fr = Path.newFrame(), bf = Path.newFrame();
    const offs = [];
    let j = dir > 0 ? 0 : path.L;
    const v = new THREE.Vector3();
    for (let k = 0; k < 400; k++) {
      const s = s0 + dir * k;
      this.frame(s, fr);
      // Step along the branch until it crosses the plane through this main-road point
      for (let it = 0; it < 400; it++) {
        path.frame(j, bf);
        const along = v.copy(bf.P).sub(fr.P).dot(fr.T) * dir;
        if (along >= 0 || (dir > 0 ? j >= path.L : j <= 0)) break;
        j += dir * 0.25;
      }
      path.frame(j, bf);
      v.copy(bf.P).sub(fr.P);
      const off = v.dot(fr.R), dy = v.y; // world height, so banked corners don't count
      offs.push(off);
      if (Math.abs(off) >= gap || Math.abs(dy) > 3) {
        // Heading of the branch relative to the main road at the gore
        const dpsi = Math.atan2(bf.T.dot(fr.R), bf.T.dot(fr.T));
        return { gs: s, bs: j, off, dpsi, offs, s0, dir };
      }
    }
    throw new Error(`Track ${this.id}: route never separates from the main road`);
  }

  /** If s is inside a fork/join overlap on the main road, the branch's offset there. */
  zoneAt(s) {
    for (const br of this.branches) {
      for (const z of [br.fork, br.join]) {
        const k = z.dir > 0 ? this.delta(z.s0, s) : this.delta(s, z.s0);
        const len = Math.abs(z.gs - z.s0);
        if (k >= 0 && k <= len) {
          const i = Math.floor(k), t = k - i;
          const o = z.offs[Math.min(i, z.offs.length - 1)] * (1 - t) + z.offs[Math.min(i + 1, z.offs.length - 1)] * t;
          return { br, zone: z, off: o, kind: z.dir > 0 ? 'fork' : 'join' };
        }
      }
    }
    return null;
  }

  /** The Path a car on `route` drives on (0 = main circuit). */
  pathOf(route) {
    return route ? this.branches[route - 1]?.path || this : this;
  }

  /** Race progress along the main circuit, mapping branch distance onto it. */
  progress(car) {
    const br = car.route ? this.branches[car.route - 1] : null;
    const s = br ? br.from + (car.s / br.path.L) * (br.to - br.from) : car.s;
    return car.lap * this.L + s;
  }

  build(scene) {
    const theme = this.def.theme;
    buildEnvironment(scene, theme, this);
    this.buildRoad(scene, theme, { startLine: true });
    for (const br of this.branches) br.path.buildRoad(scene, theme, { beneath: true });
    this.buildRouteProps(scene, theme);
  }

  /** Signs over each fork, lock gates on locked routes and key pickups. */
  buildRouteProps(scene, theme) {
    const fr = Path.newFrame();
    this.gates = new Map();
    this.keyMeshes = new Map();
    for (const br of this.branches) {
      for (const z of [br.fork, br.join]) this.buildSplitIsland(scene, theme, br, z);
      this.buildForkPortal(scene, theme, br);

      if (!br.lock) continue;
      // Locked: a force-field wall along the lane divider of the Y until you have the key
      const pos = [], uv = [];
      const P = new THREE.Vector3();
      const len = Math.abs(br.fork.gs - br.fork.s0);
      for (let k = 0; k < len; k += 2) {
        const k2 = Math.min(len, k + 2);
        for (const [kk, h, u] of [[k, 0, 0], [k2, 0, 1], [k2, 4, 1], [k, 0, 0], [k2, 4, 1], [k, 4, 0]]) {
          const lat = br.side * this.hw; // the main lane's edge
          this.frame(br.from + kk, fr);
          P.copy(fr.P).addScaledVector(fr.R, lat).addScaledVector(fr.N, h);
          pos.push(P.x, P.y, P.z);
          uv.push((kk / 8) + u * 0, h / 4);
        }
      }
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
      g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
      const gate = new THREE.Group();
      gate.add(new THREE.Mesh(g, new THREE.MeshBasicMaterial({ map: gateTexture(), transparent: true, opacity: 0.75, side: THREE.DoubleSide, depthWrite: false })));
      scene.add(gate);
      this.gates.set(br.lock, gate);
    }
    const keyMat = new THREE.MeshStandardMaterial({ color: '#ffd000', emissive: '#aa7a00', metalness: 0.8, roughness: 0.25 });
    for (const k of this.keys) {
      const g = new THREE.Group();
      const ring = new THREE.Mesh(new THREE.TorusGeometry(0.7, 0.22, 10, 20), keyMat);
      ring.position.y = 0.9;
      const shaft = new THREE.Mesh(new THREE.BoxGeometry(0.3, 1.8, 0.3), keyMat);
      shaft.position.y = -0.4;
      const tooth = new THREE.Mesh(new THREE.BoxGeometry(0.6, 0.25, 0.3), keyMat);
      tooth.position.set(0.35, -1.1, 0);
      g.add(ring, shaft, tooth);
      const glow = new THREE.Mesh(new THREE.SphereGeometry(1.6, 16, 12), new THREE.MeshBasicMaterial({ color: '#ffe066', transparent: true, opacity: 0.18, depthWrite: false }));
      g.add(glow);
      this.toWorld(k.s, k.d, 2.6, g.position, fr);
      g.userData.base = g.position.clone();
      g.userData.up = fr.N.clone();
      scene.add(g);
      this.keyMeshes.set(k.id, g);
    }
  }

  /**
   * The divider between the two roads after they part (and before they meet
   * again): a narrow hazard-striped wall with a rounded nose at the gore.
   */
  buildSplitIsland(scene, theme, br, z) {
    const fm = Path.newFrame(), fb = Path.newFrame();
    const H = 2.4, e = this.hw + 0.05;
    const A = [], B = [], NA = [], NB = [], gap = [];
    for (let k = 0; k <= 60; k += 2) {
      this.frame(z.gs + z.dir * k, fm);
      br.path.frame(z.bs + z.dir * k, fb);
      if (fb.gap || fm.gap || fb.N.dot(fm.N) < 0.9) break;
      const a = fm.P.clone().addScaledVector(fm.R, br.side * e);
      const b2 = fb.P.clone().addScaledVector(fb.R, -br.side * e);
      if (k > 0 && a.distanceTo(b2) > 24) break;
      // Stop once one road climbs or dives away: no slab between two levels
      if (Math.abs(b2.clone().sub(a).dot(fm.N)) > 1.2) break;
      // A narrow wall down the middle of the gap, not a slab filling it
      const mid = a.clone().lerp(b2, 0.5), u = b2.clone().sub(a);
      gap.push(u.length());
      const half = Math.min(u.length() / 2, 1.2);
      u.normalize();
      A.push(mid.clone().addScaledVector(u, -half));
      B.push(mid.clone().addScaledVector(u, half));
      NA.push(fm.N.clone());
      NB.push(fb.N.clone());
    }
    if (A.length < 2) return;
    const side = [], top = [], sUv = [], tUv = [];
    const up = (p, n, h) => p.clone().addScaledVector(n, h);
    const quad = (arr, uvs, p0, p1, p2, p3, u0, u1) => {
      for (const [p, u, v] of [[p0, u0, 0], [p1, u1, 0], [p2, u1, 1], [p0, u0, 0], [p2, u1, 1], [p3, u0, 1]]) {
        arr.push(p.x, p.y, p.z);
        uvs.push(u, v);
      }
    };
    for (let i = 0; i < A.length - 1; i++) {
      const u0 = i / 2, u1 = (i + 1) / 2;
      quad(side, sUv, up(A[i], NA[i], -0.4), up(A[i + 1], NA[i + 1], -0.4), up(A[i + 1], NA[i + 1], H), up(A[i], NA[i], H), u0, u1);
      quad(side, sUv, up(B[i], NB[i], -0.4), up(B[i + 1], NB[i + 1], -0.4), up(B[i + 1], NB[i + 1], H), up(B[i], NB[i], H), u0, u1);
      quad(top, tUv, up(A[i], NA[i], H), up(A[i + 1], NA[i + 1], H), up(B[i + 1], NB[i + 1], H), up(B[i], NB[i], H), 0, 1);
    }
    const n = A.length - 1; // square cap at the far end
    quad(top, tUv, up(A[n], NA[n], -0.4), up(B[n], NB[n], -0.4), up(B[n], NB[n], H), up(A[n], NA[n], H), 0, 1);
    const neon = theme === 'neon';
    const mk = (arr, uvs, mat) => {
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.Float32BufferAttribute(arr, 3));
      g.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
      g.computeVertexNormals();
      scene.add(new THREE.Mesh(g, mat));
    };
    mk(side, sUv, new THREE.MeshStandardMaterial({ map: hazardTex(), emissive: neon ? '#443300' : '#000', side: THREE.DoubleSide }));
    mk(top, tUv, new THREE.MeshStandardMaterial({ color: neon ? '#1c2140' : '#3a3f4a', side: THREE.DoubleSide }));
    // Rounded nose where the lanes part
    const nose = new THREE.Mesh(new THREE.CylinderGeometry(0.9, 0.9, H + 0.4, 16), new THREE.MeshStandardMaterial({ map: stripeTex(), emissive: neon ? '#443300' : '#221600' }));
    nose.position.copy(A[0]).lerp(B[0], 0.5).addScaledVector(NA[0], H / 2 - 0.2);
    nose.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), NA[0]);
    scene.add(nose);
    z.island = { A, B, NA, NB, gap };
  }

  /**
   * A twin-tunnel portal just past the fork: posts on both outer edges and on
   * the island, one lintel per lane carrying that lane's sign, and a big
   * double-arrow marker over the divider.
   */
  buildForkPortal(scene, theme, br) {
    const isl = br.fork.island;
    if (!isl) return;
    // Stand it where the divider is wide enough to read as a central pier
    let i = isl.gap.findIndex((w) => w >= 5);
    if (i < 0) i = Math.min(3, isl.A.length - 1);
    const k = i * 2;
    const fm = Path.newFrame(), fb = Path.newFrame();
    this.frame(br.fork.gs + k, fm);
    // Branch point straight across from the main road, so the three posts
    // stand in one line square to the main road
    let bsx = br.fork.bs + k;
    const rel = new THREE.Vector3();
    for (let it = 0; it < 6; it++) {
      br.path.frame(bsx, fb);
      bsx -= rel.copy(fb.P).sub(fm.P).dot(fm.T) / Math.max(0.3, fb.T.dot(fm.T));
    }
    br.path.frame(bsx, fb);
    const neon = theme === 'neon';
    const H = 8;
    const postMat = new THREE.MeshStandardMaterial({ color: neon ? '#2a2f55' : '#5b6474', metalness: 0.3, roughness: 0.5 });
    const trimMat = new THREE.MeshStandardMaterial({ color: neon ? '#00e5ff' : '#c8f000', emissive: neon ? '#00a0c0' : '#3a4a00' });
    const bar = (p, q, w, h, mat) => {
      const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, p.distanceTo(q) + w), mat);
      m.position.copy(p).lerp(q, 0.5);
      // lookAt needs an "up" that isn't parallel to the bar (posts are vertical)
      if (Math.abs(q.y - p.y) > 0.99 * p.distanceTo(q)) m.up.set(0, 0, 1);
      m.lookAt(q);
      scene.add(m);
      return m;
    };
    const outM = fm.P.clone().addScaledVector(fm.R, -br.side * (this.hw + 0.9));
    const mid = fm.P.clone().addScaledVector(fm.R, br.side * this.hw).lerp(fb.P.clone().addScaledVector(fb.R, -br.side * this.hw), 0.5);
    const outB = fb.P.clone().addScaledVector(fb.R, br.side * (this.hw + 0.9));
    const tops = [];
    const pier = THREE.MathUtils.clamp(isl.gap[i] - 1, 1.2, 4);
    // A level gantry: upright posts with their tops at one height, even when
    // one lane has already started to climb or dive
    const UP = new THREE.Vector3(0, 1, 0);
    const topY = Math.max(outM.y, mid.y, outB.y) + H;
    for (const [p, w] of [[outM, 1.2], [mid, pier], [outB, 1.2]]) {
      const t = new THREE.Vector3(p.x, topY, p.z);
      bar(p.clone().addScaledVector(UP, -0.5), t, w, w, postMat);
      tops.push(t);
    }
    // Faces the oncoming cars (+z toward them), reading left to right (+x to
    // the driver's right) along a lintel
    const faceBasis = (from, to) => {
      const xs = to.clone().sub(from).setY(0).normalize();
      if (xs.dot(fm.R) < 0) xs.negate();
      const zs = new THREE.Vector3().crossVectors(xs, UP).normalize();
      return [xs, zs];
    };
    // Lintels over each tunnel mouth, with that lane's sign hung on the front
    const lanes = [
      [tops[0], tops[1], br.side > 0 ? '⬅ MAIN' : 'MAIN ➜', '#ffffff'],
      [tops[1], tops[2], `${br.lock ? '🔒 ' : ''}${br.name} ${br.side > 0 ? '➜' : '⬅'}`, br.lock ? '#ffd000' : '#00e5ff'],
    ];
    for (const [p, q, text, color] of lanes) {
      bar(p, q, 1.6, 1.6, postMat);
      bar(p.clone().addScaledVector(UP, -1.3), q.clone().addScaledVector(UP, -1.3), 0.35, 0.35, trimMat);
      // Centre the sign on the open part of the lintel, clear of the pier
      const cut = pier / 2 / p.distanceTo(q);
      const a = p === tops[1] ? p.clone().lerp(q, cut) : p, b2 = q === tops[1] ? q.clone().lerp(p, cut) : q;
      const sign = new THREE.Mesh(new THREE.BoxGeometry(Math.min(this.hw * 1.3, a.distanceTo(b2) - 2), 2.4, 0.3), new THREE.MeshBasicMaterial({ map: signTexture(text, color) }));
      const [xs, zs] = faceBasis(a, b2);
      sign.position.copy(a).lerp(b2, 0.5).addScaledVector(UP, -0.2).addScaledVector(zs, 1.1);
      sign.quaternion.setFromRotationMatrix(new THREE.Matrix4().makeBasis(xs, UP, zs));
      scene.add(sign);
    }
    // Glowing double arrow on the pier
    const arrow = new THREE.Mesh(new THREE.PlaneGeometry(5, 2.5), new THREE.MeshBasicMaterial({ map: splitArrowTex(), transparent: true, side: THREE.DoubleSide }));
    const [ax, az] = faceBasis(tops[0], tops[1]);
    arrow.position.copy(tops[1]).addScaledVector(UP, -2.2).addScaledVector(az, pier / 2 + 0.3);
    arrow.quaternion.setFromRotationMatrix(new THREE.Matrix4().makeBasis(ax, UP, az));
    scene.add(arrow);
  }

  /** Show only the gates / keys this player still needs. */
  setOwnedKeys(owned) {
    for (const [id, gate] of this.gates || []) gate.visible = !owned.has(id);
    for (const [id, mesh] of this.keyMeshes || []) mesh.visible = !owned.has(id);
  }

  update(dt) {
    super.update(dt);
    for (const br of this.branches) br.path.update(dt);
    const t = performance.now() * 0.003;
    for (const m of this.keyMeshes?.values() || []) {
      m.rotation.y += dt * 2.5;
      m.position.copy(m.userData.base).addScaledVector(m.userData.up, Math.sin(t) * 0.3);
    }
    for (const g of this.gates?.values() || []) g.children[0].material.map.offset.x = (t * 0.2) % 1;
  }
}

// ---------------- textures & environments ----------------

function canvasTex(w, h, draw) {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  draw(c.getContext('2d'), w, h);
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 8;
  return t;
}

function roadTexture(neon) {
  return canvasTex(256, 256, (g, w, h) => {
    if (neon) {
      g.fillStyle = '#6b7cff';
      g.fillRect(0, 0, w, h);
      g.fillStyle = '#4a58d6';
      for (let i = 0; i < 8; i++) g.fillRect(0, i * 32, w, 3);
      g.fillStyle = '#ffffff';
      g.fillRect(w / 2 - 3, 0, 6, h * 0.5);
      g.fillStyle = '#ffe600';
      g.fillRect(8, 0, 6, h);
      g.fillRect(w - 14, 0, 6, h);
    } else {
      // Plastic track: white base tinted by vertex color, with grooves
      g.fillStyle = '#ffffff';
      g.fillRect(0, 0, w, h);
      g.fillStyle = 'rgba(0,0,0,0.12)';
      for (const x of [0.25, 0.5, 0.75]) g.fillRect(w * x - 2, 0, 4, h);
      g.fillStyle = 'rgba(255,255,255,0.5)';
      for (let i = 0; i < 4; i++) g.fillRect(w / 2 - 6, i * 64 + 8, 12, 32);
      g.fillStyle = 'rgba(0,0,0,0.08)';
      for (let i = 0; i < 16; i++) g.fillRect(0, i * 16, w, 1);
    }
  });
}

function chevronTexture() {
  return canvasTex(128, 128, (g, w, h) => {
    g.clearRect(0, 0, w, h);
    g.strokeStyle = '#ffe600';
    g.lineWidth = 18;
    g.lineCap = 'round';
    g.beginPath();
    g.moveTo(16, 96);
    g.lineTo(64, 40);
    g.lineTo(112, 96);
    g.stroke();
  });
}

function checkerTexture() {
  const t = canvasTex(256, 32, (g) => {
    for (let x = 0; x < 16; x++) for (let y = 0; y < 2; y++) {
      g.fillStyle = (x + y) % 2 ? '#111' : '#fff';
      g.fillRect(x * 16, y * 16, 16, 16);
    }
  });
  return t;
}

function stripeTex() {
  const t = canvasTex(64, 64, (g, w, h) => {
    for (let i = 0; i < 8; i++) {
      g.fillStyle = i % 2 ? '#111' : '#ffd000';
      g.fillRect(0, (i * h) / 8, w, h / 8);
    }
  });
  return t;
}

function hazardTex() {
  return canvasTex(128, 64, (g, w, h) => {
    g.fillStyle = '#ffd000';
    g.fillRect(0, 0, w, h);
    g.fillStyle = '#15171c';
    for (let x = -h; x < w + h; x += 32) {
      g.beginPath();
      g.moveTo(x, h);
      g.lineTo(x + 16, h);
      g.lineTo(x + 16 + h, 0);
      g.lineTo(x + h, 0);
      g.fill();
    }
  });
}

function splitArrowTex() {
  return canvasTex(256, 128, (g, w, h) => {
    g.fillStyle = 'rgba(8,20,12,0.85)';
    g.fillRect(8, 8, w - 16, h - 16);
    g.strokeStyle = '#39ff88';
    g.fillStyle = '#39ff88';
    g.lineWidth = 6;
    g.strokeRect(8, 8, w - 16, h - 16);
    const c = h / 2;
    for (const s of [-1, 1]) {
      g.beginPath(); // chevron pointing out to each lane
      g.moveTo(w / 2 + s * 36, c - 30);
      g.lineTo(w / 2 + s * 90, c);
      g.lineTo(w / 2 + s * 36, c + 30);
      g.lineTo(w / 2 + s * 52, c);
      g.fill();
    }
    g.beginPath(); // diamond in the middle
    g.moveTo(w / 2, c - 22);
    g.lineTo(w / 2 + 20, c);
    g.lineTo(w / 2, c + 22);
    g.lineTo(w / 2 - 20, c);
    g.fill();
  });
}

function signTexture(text, color) {
  return canvasTex(512, 96, (g, w, h) => {
    g.fillStyle = '#10131c';
    g.fillRect(0, 0, w, h);
    g.strokeStyle = color;
    g.lineWidth = 8;
    g.strokeRect(4, 4, w - 8, h - 8);
    g.font = 'bold 50px system-ui, sans-serif';
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.fillStyle = color;
    g.fillText(text, w / 2, h / 2 + 2, w - 48);
  });
}

function gateTexture() {
  return canvasTex(256, 128, (g, w, h) => {
    g.fillStyle = 'rgba(255,40,90,0.35)';
    g.fillRect(0, 0, w, h);
    g.strokeStyle = 'rgba(255,120,160,0.9)';
    g.lineWidth = 4;
    for (let x = -h; x < w; x += 24) {
      g.beginPath();
      g.moveTo(x, h);
      g.lineTo(x + h, 0);
      g.stroke();
    }
    g.font = 'bold 44px system-ui, sans-serif';
    g.textAlign = 'center';
    g.fillStyle = '#fff';
    g.fillText('🔒 KEY', w / 2, h / 2 + 15);
  });
}

function bannerTexture(neon) {
  return canvasTex(512, 64, (g, w, h) => {
    g.fillStyle = neon ? '#14002b' : '#e11d48';
    g.fillRect(0, 0, w, h);
    g.font = 'bold 44px system-ui, sans-serif';
    g.textAlign = 'center';
    g.fillStyle = neon ? '#ff2bd6' : '#ffe600';
    g.fillText('START  ·  FINISH', w / 2, 48);
  });
}

function buildEnvironment(scene, theme, track) {
  if (theme === 'neon') {
    scene.background = new THREE.Color('#070718');
    scene.fog = new THREE.Fog('#120a30', 200, 900);
    scene.add(new THREE.HemisphereLight('#8a7dff', '#1a0f3a', 1.6));
    const sun = new THREE.DirectionalLight('#c9d6ff', 1.6);
    sun.position.set(-80, 200, 60);
    scene.add(sun);
    // Glowing grid floor
    const grid = new THREE.GridHelper(2400, 120, '#ff2bd6', '#3a1f7a');
    grid.position.y = 0;
    scene.add(grid);
    const floor = new THREE.Mesh(new THREE.PlaneGeometry(2400, 2400), new THREE.MeshBasicMaterial({ color: '#0a0620' }));
    floor.rotation.x = -Math.PI / 2;
    floor.position.y = -0.1;
    scene.add(floor);
    // Stars
    const sv = [];
    for (let i = 0; i < 1500; i++) {
      const v = new THREE.Vector3().randomDirection();
      if (v.y < 0.05) v.y = Math.abs(v.y) + 0.05;
      v.multiplyScalar(1100);
      sv.push(v.x, v.y, v.z);
    }
    const sg = new THREE.BufferGeometry();
    sg.setAttribute('position', new THREE.Float32BufferAttribute(sv, 3));
    scene.add(new THREE.Points(sg, new THREE.PointsMaterial({ color: '#ffffff', size: 2, sizeAttenuation: false, fog: false })));
    // Planet
    const planet = new THREE.Mesh(new THREE.SphereGeometry(160, 32, 24), new THREE.MeshBasicMaterial({ color: '#2b6cff', fog: false }));
    planet.position.set(-600, 380, -700);
    scene.add(planet);
    const ring = new THREE.Mesh(new THREE.RingGeometry(200, 260, 64), new THREE.MeshBasicMaterial({ color: '#ffb703', side: THREE.DoubleSide, transparent: true, opacity: 0.6, fog: false }));
    ring.position.copy(planet.position);
    ring.rotation.set(1.2, 0.3, 0);
    scene.add(ring);
    // City towers with lit windows, kept away from the track
    const winTex = canvasTex(64, 128, (g, w, h) => {
      g.fillStyle = '#0c0f24';
      g.fillRect(0, 0, w, h);
      for (let y = 4; y < h; y += 8) for (let x = 4; x < w; x += 10) {
        if (Math.random() < 0.55) {
          g.fillStyle = ['#00e5ff', '#ff2bd6', '#ffe600', '#7df9ff'][Math.floor(Math.random() * 4)];
          g.fillRect(x, y, 5, 3);
        }
      }
    });
    placeProps(track, 90, 24 + track.hw + 6, 700, (x, z) => {
      const h = 40 + Math.random() * 160, w = 14 + Math.random() * 20;
      const t = winTex.clone();
      t.needsUpdate = true;
      t.repeat.set(w / 16, h / 30);
      const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, w), new THREE.MeshBasicMaterial({ map: t }));
      m.position.set(x, h / 2, z);
      scene.add(m);
      const cap = new THREE.Mesh(new THREE.BoxGeometry(w + 1, 1, w + 1), new THREE.MeshBasicMaterial({ color: '#ff2bd6' }));
      cap.position.set(x, h, z);
      scene.add(cap);
    });
  } else {
    buildDaylight(scene, theme, track);
  }
}

const DAY_THEMES = {
  toy: {
    sky: '#8fd3ff', fog: ['#bfe6ff', 300, 1100], hemi: ['#e6f6ff', '#5b8a3a', 1.5], sun: ['#fff4e0', 2.4],
    ground: ['#6fbf4a', '#63b041', '#7bcc55'], hills: ['#7a8fa6', '#8ea3b8'], clouds: 18,
  },
  desert: {
    sky: '#ffc58f', fog: ['#ffd9b0', 320, 1200], hemi: ['#fff1dc', '#b07a45', 1.5], sun: ['#ffd8a8', 2.6],
    ground: ['#e3b778', '#d6a865', '#edc88e'], hills: ['#c2623a', '#a94f2e'], clouds: 6,
  },
  volcano: {
    sky: '#2a0f14', fog: ['#4a1a12', 220, 950], hemi: ['#ff9a6a', '#2a1010', 1.3], sun: ['#ffb07a', 1.9],
    ground: ['#2b2224', '#221a1c', '#352a2b'], hills: ['#241a1b', '#301f1d'], clouds: 0,
  },
};

function buildDaylight(scene, theme, track) {
  const T = DAY_THEMES[theme] || DAY_THEMES.toy;
  scene.background = new THREE.Color(T.sky);
  scene.fog = new THREE.Fog(...T.fog);
  scene.add(new THREE.HemisphereLight(...T.hemi));
  const sun = new THREE.DirectionalLight(...T.sun);
  sun.position.set(120, 220, 80);
  sun.castShadow = true;
  sun.shadow.mapSize.setScalar(document.body.classList.contains('touch') ? 1024 : 2048);
  const sc = sun.shadow.camera;
  sc.left = sc.bottom = -280;
  sc.right = sc.top = 280;
  sc.near = 10;
  sc.far = 800;
  sun.shadow.bias = -0.0008;
  // Aim the shadow box at the middle of the track
  const c = trackCenter(track);
  sun.position.add(c);
  sun.target.position.copy(c);
  scene.add(sun, sun.target);

  const groundTex = canvasTex(256, 256, (g, w, h) => {
    g.fillStyle = T.ground[0];
    g.fillRect(0, 0, w, h);
    for (let i = 0; i < 3000; i++) {
      g.fillStyle = Math.random() < 0.5 ? T.ground[1] : T.ground[2];
      g.fillRect(Math.random() * w, Math.random() * h, 3, 3);
    }
  });
  groundTex.repeat.set(120, 120);
  const groundMat = new THREE.MeshLambertMaterial({ map: groundTex });
  if (theme === 'volcano') {
    // Glowing lava cracks
    const cracks = canvasTex(512, 512, (g, w, h) => {
      g.fillStyle = '#000';
      g.fillRect(0, 0, w, h);
      g.strokeStyle = '#ff5a1f';
      g.lineCap = 'round';
      for (let i = 0; i < 26; i++) {
        let x = Math.random() * w, y = Math.random() * h;
        g.lineWidth = 1 + Math.random() * 3;
        g.beginPath();
        g.moveTo(x, y);
        for (let k = 0; k < 8; k++) {
          x += (Math.random() - 0.5) * 70;
          y += (Math.random() - 0.5) * 70;
          g.lineTo(x, y);
        }
        g.stroke();
      }
    });
    cracks.repeat.set(30, 30);
    groundMat.emissive = new THREE.Color('#ffffff');
    groundMat.emissiveMap = cracks;
  }
  const ground = new THREE.Mesh(new THREE.PlaneGeometry(3000, 3000), groundMat);
  ground.rotation.x = -Math.PI / 2;
  ground.receiveShadow = true;
  scene.add(ground);

  // Distant hills / mesas / volcanic peaks
  for (let i = 0; i < 26; i++) {
    const a = (i / 26) * Math.PI * 2;
    const r = 720 + Math.random() * 220;
    const h = 120 + Math.random() * 180;
    const mat = new THREE.MeshLambertMaterial({ color: T.hills[i % 2] });
    const geo = theme === 'desert'
      ? new THREE.CylinderGeometry(h * 0.55, h * 0.75, h * 0.7, 7)
      : new THREE.ConeGeometry(h * 0.9, h, 6);
    const m = new THREE.Mesh(geo, mat);
    m.position.set(c.x + Math.cos(a) * r, (theme === 'desert' ? h * 0.35 : h / 2) - 5, c.z + Math.sin(a) * r);
    scene.add(m);
  }

  if (theme === 'toy') {
    const leaf = new THREE.MeshLambertMaterial({ color: '#2f7a34' });
    const trunk = new THREE.MeshLambertMaterial({ color: '#6b4a2b' });
    placeProps(track, 26, 49, 420, (x, z) => {
      const s = 4 + Math.random() * 5;
      const t = new THREE.Mesh(new THREE.ConeGeometry(s, s * 3, 7), leaf);
      t.position.set(x, s * 1.5 + 3, z);
      t.castShadow = true;
      scene.add(t);
      const tr = new THREE.Mesh(new THREE.CylinderGeometry(0.6, 0.9, 3.2), trunk);
      tr.position.set(x, 1.6, z);
      scene.add(tr);
    });
  } else if (theme === 'desert') {
    const cactus = new THREE.MeshLambertMaterial({ color: '#3f8f3a' });
    const rock = new THREE.MeshLambertMaterial({ color: '#b5653a' });
    placeProps(track, 40, 42, 440, (x, z) => {
      if (Math.random() < 0.55) {
        const h = 6 + Math.random() * 6;
        const trunk = new THREE.Mesh(new THREE.CylinderGeometry(0.9, 1, h, 8), cactus);
        trunk.position.set(x, h / 2, z);
        trunk.castShadow = true;
        scene.add(trunk);
        for (const side of [-1, 1]) {
          if (Math.random() < 0.3) continue;
          const arm = new THREE.Mesh(new THREE.CylinderGeometry(0.6, 0.6, h * 0.4, 8), cactus);
          arm.position.set(x + side * 1.8, h * (0.45 + Math.random() * 0.2), z);
          arm.castShadow = true;
          scene.add(arm);
        }
      } else {
        const s = 6 + Math.random() * 14;
        const m = new THREE.Mesh(new THREE.DodecahedronGeometry(s, 0), rock);
        m.position.set(x, s * 0.4, z);
        m.scale.y = 0.5 + Math.random() * 0.6;
        m.rotation.y = Math.random() * 3;
        m.castShadow = true;
        scene.add(m);
      }
    });
  } else if (theme === 'volcano') {
    const rock = new THREE.MeshLambertMaterial({ color: '#2d2224' });
    const glow = new THREE.MeshBasicMaterial({ color: '#ff5a1f' });
    const v = track.marks.volcano;
    if (v) {
      // The helix wraps around this cone
      const base = v.r - track.hw - 6, h = 78;
      const cone = new THREE.Mesh(new THREE.CylinderGeometry(9, base, h, 20, 1, true), rock);
      cone.position.set(v.x, h / 2, v.z);
      cone.castShadow = true;
      scene.add(cone);
      const lava = new THREE.Mesh(new THREE.CircleGeometry(9, 20), glow);
      lava.rotation.x = -Math.PI / 2;
      lava.position.set(v.x, h - 2, v.z);
      scene.add(lava);
      const light = new THREE.PointLight('#ff6a2a', 3, 200, 1.2);
      light.position.set(v.x, h + 10, v.z);
      scene.add(light);
      for (let i = 0; i < 6; i++) {
        const a = (i / 6) * Math.PI * 2 + Math.random();
        const stream = new THREE.Mesh(new THREE.PlaneGeometry(2.2, h * 0.75), glow);
        const rr = (base + 9) / 2 + 0.5;
        stream.position.set(v.x + Math.cos(a) * rr, h * 0.55, v.z + Math.sin(a) * rr);
        stream.lookAt(v.x + Math.cos(a) * rr * 3, h * 0.55 + 20, v.z + Math.sin(a) * rr * 3);
        scene.add(stream);
      }
      track.smokeAt = new THREE.Vector3(v.x, h, v.z);
    }
    placeProps(track, 34, 42, 440, (x, z) => {
      const h = 10 + Math.random() * 30;
      const m = new THREE.Mesh(new THREE.ConeGeometry(3 + Math.random() * 5, h, 5), rock);
      m.position.set(x, h / 2, z);
      m.castShadow = true;
      scene.add(m);
    });
  }

  const cloudMat = new THREE.MeshLambertMaterial({ color: '#ffffff', transparent: true, opacity: 0.9 });
  for (let i = 0; i < T.clouds; i++) {
    const g = new THREE.Group();
    for (let j = 0; j < 4; j++) {
      const b = new THREE.Mesh(new THREE.SphereGeometry(14 + Math.random() * 10, 10, 8), cloudMat);
      b.position.set(j * 16 - 24, Math.random() * 6, Math.random() * 10);
      g.add(b);
    }
    g.position.set(c.x + (Math.random() - 0.5) * 1200, 150 + Math.random() * 80, c.z + (Math.random() - 0.5) * 1200);
    scene.add(g);
  }
}

function trackCenter(track) {
  const c = new THREE.Vector3();
  for (let i = 0; i < track.n; i++) c.add(new THREE.Vector3().fromArray(track.P, i * 3));
  return c.divideScalar(track.n).setY(0);
}

/**
 * Scatter props around the track. `clear` is how far a prop's centre must stay
 * from the centreline of the main road and of every alternate route.
 */
function placeProps(track, count, clear, spread, place) {
  const c = trackCenter(track);
  const paths = [track, ...(track.branches || []).map((b) => b.path)];
  let tries = 0, placed = 0;
  while (placed < count && tries++ < count * 30) {
    const x = c.x + (Math.random() - 0.5) * spread * 2;
    const z = c.z + (Math.random() - 0.5) * spread * 2;
    let ok = true;
    for (const p of paths) {
      for (let i = 0; ok && i < p.n; i += 2) {
        const dx = p.P[i * 3] - x, dz = p.P[i * 3 + 2] - z;
        if (dx * dx + dz * dz < clear * clear) ok = false;
      }
      if (!ok) break;
    }
    if (ok) {
      place(x, z);
      placed++;
    }
  }
}
