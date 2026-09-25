import * as THREE from 'three';
import { TRACKS } from './trackdefs.js';

const DS = 1; // physics sample spacing along the track (world units)

function wrapAngle(a) {
  return Math.atan2(Math.sin(a), Math.cos(a));
}

/**
 * A closed 3D track. The centerline is sampled every DS units into
 * position (P), tangent (T), up (N) and right (R) frames. Frames use
 * parallel transport so loops and corkscrews keep the road "up" pointing
 * at the driver, plus automatic banking in corners.
 */
export class Track {
  constructor(id) {
    const def = (this.def = TRACKS[id] || TRACKS.orange);
    this.id = TRACKS[id] ? id : 'orange';
    this.hw = def.width / 2;
    const turtle = def.build();
    const pts = turtle.pts;
    const curve = new THREE.CatmullRomCurve3(pts.map((p) => p.p), true, 'centripetal');
    curve.arcLengthDivisions = pts.length * 12;
    const L = curve.getLength();
    const n = Math.round(L / DS);
    this.n = n;
    this.ds = L / n;
    this.L = L;

    const P = (this.P = new Float32Array(n * 3));
    const T = (this.T = new Float32Array(n * 3));
    const N = (this.N = new Float32Array(n * 3));
    const R = (this.R = new Float32Array(n * 3));
    this.k = new Float32Array(n); // curvature toward +R (1/units)
    this.gap = new Uint8Array(n);
    this.boost = new Uint8Array(n);
    this.color = [];

    const np = pts.length;
    const roll = new Float32Array(n);
    const v = new THREE.Vector3(), t = new THREE.Vector3();
    for (let i = 0; i < n; i++) {
      const u = i / n;
      curve.getPointAt(u, v);
      curve.getTangentAt(u, t);
      P.set([v.x, v.y, v.z], i * 3);
      T.set([t.x, t.y, t.z], i * 3);
      // Map to control point index to fetch per-point attributes
      const f = curve.getUtoTmapping(u) * np;
      const i0 = Math.floor(f) % np, i1 = (i0 + 1) % np, fr = f - Math.floor(f);
      const a = pts[i0], b = pts[i1];
      roll[i] = a.roll + wrapAngle(b.roll - a.roll) * fr;
      this.gap[i] = a.gap && b.gap ? 1 : a.gap && fr < 0.5 ? 1 : b.gap && fr >= 0.5 ? 1 : 0;
      this.boost[i] = (fr < 0.5 ? a.boost : b.boost) ? 1 : 0;
      this.color.push((fr < 0.5 ? a.color : b.color) || '#ff7a00');
    }

    // Parallel-transport the up vector along the curve
    const Ti = new THREE.Vector3(), Tp = new THREE.Vector3(), Nv = new THREE.Vector3(0, 1, 0), axis = new THREE.Vector3();
    const q = new THREE.Quaternion();
    Tp.fromArray(T, 0);
    Nv.addScaledVector(Tp, -Nv.dot(Tp)).normalize();
    const N0 = Nv.clone();
    const Nt = [];
    for (let i = 0; i < n; i++) {
      Ti.fromArray(T, i * 3);
      if (i > 0) {
        axis.crossVectors(Tp, Ti);
        const s = axis.length();
        if (s > 1e-8) {
          const ang = Math.atan2(s, Tp.dot(Ti));
          q.setFromAxisAngle(axis.divideScalar(s), ang);
          Nv.applyQuaternion(q);
        }
        Nv.addScaledVector(Ti, -Nv.dot(Ti)).normalize();
      }
      Nt.push(Nv.clone());
      Tp.copy(Ti);
    }
    // Close the frame: remove accumulated twist so the seam lines up
    Ti.fromArray(T, 0);
    axis.crossVectors(Tp, Ti);
    const endN = Nv.clone();
    if (axis.length() > 1e-8) endN.applyQuaternion(q.setFromAxisAngle(axis.normalize(), Math.atan2(axis.length(), Tp.dot(Ti))));
    const cr = new THREE.Vector3().crossVectors(endN, N0);
    const twist = Math.atan2(cr.dot(Ti), endN.dot(N0));

    // Base frames (with twist correction and explicit roll)
    const Rv = new THREE.Vector3();
    const baseR = [];
    for (let i = 0; i < n; i++) {
      Ti.fromArray(T, i * 3);
      const nv = Nt[i].applyAxisAngle(Ti, (twist * i) / n + roll[i]);
      Rv.crossVectors(Ti, nv).normalize();
      baseR.push(Rv.clone());
    }

    // Auto banking from curvature in the road plane, smoothed
    const bank = new Float32Array(n);
    const tA = new THREE.Vector3(), tB = new THREE.Vector3();
    for (let i = 0; i < n; i++) {
      tA.fromArray(T, ((i - 2 + n) % n) * 3);
      tB.fromArray(T, ((i + 2) % n) * 3);
      const kR = tB.sub(tA).divideScalar(4 * this.ds).dot(baseR[i]);
      bank[i] = THREE.MathUtils.clamp(kR * 16, -0.7, 0.7) * Math.max(0, Nt[i].y);
    }
    const sm = new Float32Array(n);
    const W = 18;
    for (let i = 0; i < n; i++) {
      let acc = 0;
      for (let j = -W; j <= W; j++) acc += bank[(i + j + n) % n];
      sm[i] = acc / (2 * W + 1);
    }

    for (let i = 0; i < n; i++) {
      Ti.fromArray(T, i * 3);
      const nv = Nt[i].applyAxisAngle(Ti, sm[i]);
      Rv.crossVectors(Ti, nv).normalize();
      N.set([nv.x, nv.y, nv.z], i * 3);
      R.set([Rv.x, Rv.y, Rv.z], i * 3);
    }
    for (let i = 0; i < n; i++) {
      tA.fromArray(T, ((i - 1 + n) % n) * 3);
      tB.fromArray(T, ((i + 1) % n) * 3);
      Rv.fromArray(R, i * 3);
      this.k[i] = tB.sub(tA).divideScalar(2 * this.ds).dot(Rv);
    }

    // Useful markers
    this.gaps = [];
    for (let i = 0; i < n; i++) {
      if (this.gap[i] && !this.gap[(i - 1 + n) % n]) {
        let j = i;
        while (this.gap[j % n]) j++;
        this.gaps.push({ start: i * this.ds, end: j * this.ds });
      }
    }
  }

  idx(s) {
    let i = Math.floor(s / this.ds) % this.n;
    if (i < 0) i += this.n;
    return i;
  }

  wrap(s) {
    s %= this.L;
    return s < 0 ? s + this.L : s;
  }

  /** Signed shortest distance from a to b along the loop. */
  delta(a, b) {
    let d = b - a;
    if (d > this.L / 2) d -= this.L;
    if (d < -this.L / 2) d += this.L;
    return d;
  }

  /** Interpolated frame at arc length s. Writes into out {P,T,N,R}. */
  frame(s, out) {
    s = this.wrap(s);
    const f = s / this.ds;
    const i = Math.floor(f) % this.n, j = (i + 1) % this.n, t = f - Math.floor(f);
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

  /** World position of a point in track coordinates. */
  toWorld(s, d, h, out, fr = Track.newFrame()) {
    this.frame(s, fr);
    return out.copy(fr.P).addScaledVector(fr.R, d).addScaledVector(fr.N, h);
  }

  // ---------------- rendering ----------------

  build(scene) {
    const theme = this.def.theme;
    buildEnvironment(scene, theme, this);
    this.buildRoad(scene, theme);
  }

  buildRoad(scene, theme) {
    const n = this.n, hw = this.hw;
    const STEP = 2; // mesh every 2 samples
    const rows = [];
    for (let i = 0; i <= n; i += STEP) rows.push(i % n);
    if (rows[rows.length - 1] !== 0) rows.push(0);

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
    const build = (list, uvScale, useColor) => {
      const pos = [], uv = [], colors = [];
      for (let r = 0; r < rows.length - 1; r++) {
        const i0 = rows[r], i1 = rows[r + 1];
        if (this.gap[i0] || this.gap[i1]) continue;
        for (const [a, b] of list) {
          const quad = [];
          for (const [ii, pt, uu] of [[i0, a, 0], [i0, b, 1], [i1, b, 1], [i1, a, 0]]) {
            P.fromArray(this.P, ii * 3);
            N.fromArray(this.N, ii * 3);
            R.fromArray(this.R, ii * 3);
            P.addScaledVector(R, pt[0]).addScaledVector(N, pt[1]);
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
    });
    const railMat = neon
      ? new THREE.MeshStandardMaterial({ color: '#ffe600', emissive: '#b8a000', emissiveIntensity: 0.8, side: THREE.DoubleSide })
      : new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.4, side: THREE.DoubleSide });
    const underMat = new THREE.MeshStandardMaterial({ color: neon ? '#101428' : '#c55e00', side: THREE.DoubleSide });

    const roadMesh = new THREE.Mesh(build(strips.road, 16, true), roadMat);
    roadMesh.receiveShadow = true;
    const railMesh = new THREE.Mesh(build(strips.rail, 16, !neon), railMat);
    railMesh.castShadow = true;
    const underMesh = new THREE.Mesh(build(strips.under, 16, false), underMat);
    underMesh.castShadow = true;
    scene.add(roadMesh, railMesh, underMesh);

    // Boost pads
    const padTex = chevronTexture();
    const padMat = new THREE.MeshBasicMaterial({ map: padTex, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide });
    this.padMats = [padMat];
    for (let i = 0; i < n; i++) {
      if (!this.boost[i] || this.boost[(i - 1 + n) % n]) continue;
      let j = i;
      while (this.boost[j % n]) j++;
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

    // Start / finish line + arch
    const fr = Track.newFrame();
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
    banner.quaternion.setFromRotationMatrix(new THREE.Matrix4().makeBasis(fr.R.clone().negate(), fr.N, fr.T.clone().negate()));
    scene.add(banner);

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
    placeProps(track, 90, 60, 700, (x, z) => {
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
    scene.background = new THREE.Color('#8fd3ff');
    scene.fog = new THREE.Fog('#bfe6ff', 300, 1100);
    scene.add(new THREE.HemisphereLight('#e6f6ff', '#5b8a3a', 1.5));
    const sun = new THREE.DirectionalLight('#fff4e0', 2.4);
    sun.position.set(120, 220, 80);
    sun.castShadow = true;
    sun.shadow.mapSize.set(2048, 2048);
    const sc = sun.shadow.camera;
    sc.left = sc.bottom = -260;
    sc.right = sc.top = 260;
    sc.near = 10;
    sc.far = 700;
    sun.shadow.bias = -0.0008;
    // Aim the shadow box at the middle of the track
    const c = trackCenter(track);
    sun.position.add(c);
    sun.target.position.copy(c);
    scene.add(sun, sun.target);
    const ground = new THREE.Mesh(
      new THREE.PlaneGeometry(3000, 3000),
      new THREE.MeshLambertMaterial({
        map: canvasTex(256, 256, (g, w, h) => {
          g.fillStyle = '#6fbf4a';
          g.fillRect(0, 0, w, h);
          for (let i = 0; i < 3000; i++) {
            g.fillStyle = Math.random() < 0.5 ? '#63b041' : '#7bcc55';
            g.fillRect(Math.random() * w, Math.random() * h, 3, 3);
          }
        }),
      }),
    );
    ground.material.map.repeat.set(120, 120);
    ground.rotation.x = -Math.PI / 2;
    ground.receiveShadow = true;
    scene.add(ground);
    // Mountains + trees + clouds
    for (let i = 0; i < 26; i++) {
      const a = (i / 26) * Math.PI * 2;
      const r = 700 + Math.random() * 200;
      const h = 120 + Math.random() * 180;
      const m = new THREE.Mesh(new THREE.ConeGeometry(h * 0.9, h, 6), new THREE.MeshLambertMaterial({ color: i % 2 ? '#7a8fa6' : '#8ea3b8' }));
      m.position.set(c.x + Math.cos(a) * r, h / 2 - 5, c.z + Math.sin(a) * r);
      scene.add(m);
    }
    const leaf = new THREE.MeshLambertMaterial({ color: '#2f7a34' });
    const trunk = new THREE.MeshLambertMaterial({ color: '#6b4a2b' });
    placeProps(track, 26, 140, 420, (x, z) => {
      const s = 4 + Math.random() * 5;
      const t = new THREE.Mesh(new THREE.ConeGeometry(s, s * 3, 7), leaf);
      t.position.set(x, s * 1.5 + 3, z);
      t.castShadow = true;
      scene.add(t);
      const tr = new THREE.Mesh(new THREE.CylinderGeometry(0.6, 0.9, 3.2), trunk);
      tr.position.set(x, 1.6, z);
      scene.add(tr);
    });
    const cloudMat = new THREE.MeshLambertMaterial({ color: '#ffffff', transparent: true, opacity: 0.9 });
    for (let i = 0; i < 18; i++) {
      const g = new THREE.Group();
      for (let j = 0; j < 4; j++) {
        const b = new THREE.Mesh(new THREE.SphereGeometry(14 + Math.random() * 10, 10, 8), cloudMat);
        b.position.set(j * 16 - 24, Math.random() * 6, Math.random() * 10);
        g.add(b);
      }
      g.position.set(c.x + (Math.random() - 0.5) * 1200, 140 + Math.random() * 80, c.z + (Math.random() - 0.5) * 1200);
      scene.add(g);
    }
  }
}

function trackCenter(track) {
  const c = new THREE.Vector3();
  for (let i = 0; i < track.n; i++) c.add(new THREE.Vector3().fromArray(track.P, i * 3));
  return c.divideScalar(track.n).setY(0);
}

/** Scatter props around the track, avoiding the track footprint. */
function placeProps(track, count, minDist, spread, place) {
  const c = trackCenter(track);
  let tries = 0, placed = 0;
  while (placed < count && tries++ < count * 30) {
    const x = c.x + (Math.random() - 0.5) * spread * 2;
    const z = c.z + (Math.random() - 0.5) * spread * 2;
    let ok = true;
    for (let i = 0; i < track.n; i += 4) {
      const dx = track.P[i * 3] - x, dz = track.P[i * 3 + 2] - z;
      if (dx * dx + dz * dz < (minDist * 0.35) ** 2) {
        ok = false;
        break;
      }
    }
    if (ok) {
      place(x, z);
      placed++;
    }
  }
}
