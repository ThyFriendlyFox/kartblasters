import * as THREE from 'three';

const STEP = 3; // spacing of generated control points
const UP = new THREE.Vector3(0, 1, 0);

/**
 * "Turtle" track builder. Commands append control points along a path;
 * each point carries extra per-point data (roll, jump gap, boost pad, color).
 */
export class TrackTurtle {
  constructor(x, y, z, yaw = 0, width = 15) {
    this.width = width;
    this.marks = {};
    this.pos = new THREE.Vector3(x, y, z);
    this.yaw = yaw;
    this.start = { pos: this.pos.clone(), yaw };
    this.roll = 0;
    this.color = null;
    this.pts = [];
    this.emit(this.pos, {});
  }

  dir() {
    return new THREE.Vector3(Math.sin(this.yaw), 0, Math.cos(this.yaw));
  }

  right() {
    return new THREE.Vector3(-Math.cos(this.yaw), 0, Math.sin(this.yaw));
  }

  emit(p, { gap = false, boost = false, kick = false, up = null } = {}) {
    this.pts.push({ p: p.clone(), roll: this.roll, gap, boost, kick, color: this.col, up });
  }

  paint(color) {
    this.col = color;
    return this;
  }

  straight(len, dy = 0, flags = {}) {
    const p0 = this.pos.clone(), d = this.dir();
    const n = Math.max(1, Math.ceil(len / STEP));
    for (let i = 1; i <= n; i++) {
      const t = i / n;
      const e = t * t * (3 - 2 * t);
      this.pos.copy(p0).addScaledVector(d, len * t);
      this.pos.y = p0.y + dy * e;
      this.emit(this.pos, flags);
    }
    return this;
  }

  /** Kicker ramp: gets steeper toward the lip so cars launch into the air. */
  ramp(len, rise) {
    const p0 = this.pos.clone(), d = this.dir();
    const n = Math.max(2, Math.ceil(len / STEP));
    for (let i = 1; i <= n; i++) {
      const t = i / n;
      this.pos.copy(p0).addScaledVector(d, len * t);
      this.pos.y = p0.y + rise * t * t;
      this.emit(this.pos, { kick: true });
    }
    return this;
  }

  boost(len, dy = 0) {
    return this.straight(len, dy, { boost: true });
  }

  /** Jump: road disappears for `len` units, landing `dy` lower. */
  gap(len, dy = 0) {
    const p0 = this.pos.clone(), d = this.dir();
    const n = Math.max(2, Math.ceil(len / STEP));
    for (let i = 1; i <= n; i++) {
      const t = i / n;
      this.pos.copy(p0).addScaledVector(d, len * t);
      this.pos.y = p0.y + dy * t;
      this.emit(this.pos, { gap: i < n });
    }
    return this;
  }

  /** Horizontal arc. Positive degrees turn left. dy makes it a helix. */
  turn(deg, radius, dy = 0, flags = {}) {
    const a = THREE.MathUtils.degToRad(deg);
    const side = Math.sign(a);
    const center = this.pos.clone().addScaledVector(this.right(), -side * radius);
    this.lastCenter = { x: center.x, z: center.z, r: radius };
    const off0 = this.pos.clone().sub(center);
    const y0 = this.pos.y, yaw0 = this.yaw;
    const n = Math.max(2, Math.ceil((Math.abs(a) * radius) / STEP));
    for (let i = 1; i <= n; i++) {
      const t = i / n;
      const ang = a * t;
      const c = Math.cos(ang), s = Math.sin(ang);
      this.pos.set(center.x + off0.x * c + off0.z * s, y0 + dy * t, center.z - off0.x * s + off0.z * c);
      this.yaw = yaw0 + ang;
      this.emit(this.pos, flags);
    }
    return this;
  }

  /**
   * Vertical loop. The exit is shifted sideways by more than the road width
   * (dir = +1 right, -1 left) so the two ends never overlap.
   */
  loop(radius, dir = 1) {
    const side = dir * (this.width + 6);
    const p0 = this.pos.clone(), d = this.dir(), r = this.right();
    const n = Math.ceil((Math.PI * 2 * radius) / STEP);
    for (let i = 1; i <= n; i++) {
      const th = (i / n) * Math.PI * 2;
      const lat = side * (th - Math.sin(th)) / (Math.PI * 2);
      this.pos.copy(p0)
        .addScaledVector(d, radius * Math.sin(th))
        .addScaledVector(UP, radius * (1 - Math.cos(th)))
        .addScaledVector(r, lat);
      this.emit(this.pos, {});
    }
    return this;
  }

  /** Barrel-roll the road around its own centerline. */
  corkscrew(len, turns = 1, dir = 1, radius = 7) {
    const p0 = this.pos.clone(), d = this.dir(), r = this.right();
    const r0 = this.roll;
    const n = Math.ceil(len / STEP);
    for (let i = 1; i <= n; i++) {
      const t = i / n;
      const e = t * t * (3 - 2 * t);
      const phi = dir * turns * Math.PI * 2 * e;
      this.roll = r0 + phi;
      // Road wraps around the inside of an imaginary tube
      this.pos.copy(p0).addScaledVector(d, len * t)
        .addScaledVector(UP, radius * (1 - Math.cos(phi)))
        .addScaledVector(r, -radius * Math.sin(phi));
      // The road's up points at the tube's axis
      const up = UP.clone().multiplyScalar(Math.cos(phi)).addScaledVector(r, Math.sin(phi));
      this.emit(this.pos, { up });
    }
    return this;
  }

  /**
   * Lane-change S-curve: shift sideways by `lateral` (+ = right) and end up
   * heading the same way. Used to peel a route cleanly away from the main road.
   */
  sOut(lateral, angleDeg = 35) {
    const a = THREE.MathUtils.degToRad(angleDeg);
    const r = Math.abs(lateral) / (2 * (1 - Math.cos(a)));
    const sgn = Math.sign(lateral) || 1;
    return this.turn(-sgn * angleDeg, r).turn(sgn * angleDeg, r);
  }

  /**
   * Finish a route: run straight (absorbing any height change), then a mirror
   * S-curve that lands exactly on the target point and heading.
   */
  closeS(p1, yaw1, angleDeg = 35) {
    const d = this.dir(), r = this.right();
    const rel = p1.clone().sub(this.pos);
    const fwd = rel.x * d.x + rel.z * d.z, lat = rel.x * r.x + rel.z * r.z;
    // Use the gentlest S-curve that fits the room left
    let run = -1, sLen = 0;
    for (const deg of [angleDeg, 40, 45]) {
      const a = THREE.MathUtils.degToRad(deg);
      const rad = Math.abs(lat) / (2 * (1 - Math.cos(a)));
      sLen = Math.abs(lat) < 0.5 ? 0 : 2 * rad * Math.sin(a);
      run = fwd - sLen;
      angleDeg = deg;
      if (run >= 4) break;
    }
    if (run < 4) throw new Error(`closeS: route is ${(4 - run).toFixed(1)} units too long for the main road it rejoins`);
    this.straight(run, rel.y);
    if (sLen) this.sOut(lat, angleDeg);
    return this.closeTo(p1, yaw1);
  }

  /** Name the current point (forks, joins and key pickups refer to marks). */
  mark(name) {
    this.marks[name] = { pos: this.pos.clone(), yaw: this.yaw, idx: this.pts.length - 1 };
    return this;
  }

  /**
   * Finish the loop. Any small mismatch between where the path ended and
   * where it should end (straight behind the start line) is spread evenly
   * over the whole lap, so the road runs into the start line perfectly
   * straight instead of kinking there.
   */
  close() {
    const p0 = this.start.pos;
    const d0 = new THREE.Vector3(Math.sin(this.start.yaw), 0, Math.cos(this.start.yaw));
    const back = Math.max(35, -this.pos.clone().sub(p0).dot(d0));
    const want = p0.clone().addScaledVector(d0, -back);
    const err = this.pos.clone().sub(want);
    const cum = [0];
    for (let i = 1; i < this.pts.length; i++) cum.push(cum[i - 1] + this.pts[i].p.distanceTo(this.pts[i - 1].p));
    const total = cum[cum.length - 1] || 1;
    for (let i = 1; i < this.pts.length; i++) this.pts[i].p.addScaledVector(err, -cum[i] / total);
    for (const m of Object.values(this.marks)) if (m.idx != null) m.pos = this.pts[m.idx].p.clone();
    this.pos.copy(want);
    // Straight run-in to the start line
    const n = Math.ceil(back / STEP);
    for (let i = 1; i < n; i++) this.emit(want.clone().addScaledVector(d0, (back * i) / n), {});
    return this;
  }

  /** Smooth Hermite curve to a point and heading (includes the end point unless closing a loop). */
  closeTo(p0, yaw0, includeEnd = true) {
    const pE = this.pos.clone(), dE = this.dir();
    const d0 = new THREE.Vector3(Math.sin(yaw0), 0, Math.cos(yaw0));
    const dist = pE.distanceTo(p0);
    const n = Math.max(2, Math.ceil((dist * 1.2) / STEP));
    const m0 = dE.clone().multiplyScalar(dist), m1 = d0.clone().multiplyScalar(dist);
    const p = new THREE.Vector3();
    for (let i = 1; i < (includeEnd ? n + 1 : n); i++) {
      const t = i / n, t2 = t * t, t3 = t2 * t;
      p.set(0, 0, 0)
        .addScaledVector(pE, 2 * t3 - 3 * t2 + 1)
        .addScaledVector(m0, t3 - 2 * t2 + t)
        .addScaledVector(p0, -2 * t3 + 3 * t2)
        .addScaledVector(m1, t3 - t2);
      this.emit(p, {});
    }
    this.pos.copy(p0);
    this.yaw = yaw0;
    return this;
  }
}

// Leg lengths chosen so each circuit closes back on its start line
const LEG = { twin2: 60, twin3: 176, twin4: 186, junc2: 60, junc3: 118, junc4: 170 };

export const TRACKS = {
  orange: {
    name: 'Orange Loop',
    desc: 'Classic plastic track: loop, helix, jump',
    theme: 'toy',
    width: 15,
    build() {
      const t = new TrackTurtle(0, 4, 0, 0, this.width).paint('#ff7a00');
      t.straight(40).boost(12).straight(24);
      t.turn(-90, 38, 4);
      t.straight(36, 8);
      t.paint('#1e90ff').loop(24, 1).paint('#ff7a00');
      t.straight(30, -4);
      t.paint('#39d353').turn(-360, 30, 20).paint('#ff7a00');
      t.turn(-90, 46);
      t.straight(50, -16);
      t.boost(12).straight(16, 2.5).gap(22, -3).straight(24, -2);
      t.turn(-90, 40, -6).boost(12).straight(58);
      t.turn(-90, 40, -3);
      t.straight(20);
      return t.close();
    },
  },
  neon: {
    name: 'Neon Highway',
    desc: 'Floating sky-city circuit: corkscrew, loop, jump',
    theme: 'neon',
    width: 16,
    build() {
      const t = new TrackTurtle(0, 26, 0, 0, this.width).paint('#1f4bff');
      t.straight(36).boost(12).straight(20);
      t.turn(55, 55).turn(-55, 55);
      t.paint('#b400ff').corkscrew(90, 1).paint('#1f4bff');
      t.straight(20);
      t.turn(-120, 38, -8);
      t.straight(8).boost(12).straight(14, 2.5).gap(26, -4).straight(26);
      t.paint('#00d2ff').loop(28, -1).paint('#1f4bff');
      t.straight(80);
      t.paint('#ff2bd6').straight(30, 6).straight(30, -6).straight(30, 6).straight(30, -6).paint('#1f4bff');
      t.straight(66);
      t.turn(-120, 42, 8);
      t.boost(12).straight(40);
      t.straight(40, 8);
      t.straight(14, 2.5).gap(26, -4).straight(26);
      t.straight(40, -8).boost(12).straight(76);
      t.turn(-120, 48);
      t.straight(10);
      return t.close();
    },
  },
  canyon: {
    name: 'Mega Loop Canyon',
    desc: 'Desert stunt run: giant loop, double loop, big jump',
    theme: 'desert',
    width: 15,
    build() {
      const t = new TrackTurtle(0, 8, 0, 0, this.width).paint('#ffd000');
      t.straight(40).boost(14).straight(30);
      t.paint('#ff3b3b').loop(36, 1).paint('#ffd000');
      t.straight(40);
      t.turn(-90, 45, 6);
      t.straight(40).boost(12).straight(10);
      t.paint('#ff7a00').loop(24, 1).straight(12).loop(24, 1).paint('#ffd000');
      t.straight(30);
      t.turn(-90, 42, -4);
      t.straight(18).boost(12).straight(16, 3).gap(26, -6).straight(34, -2);
      t.turn(-90, 42);
      t.straight(128);
      t.turn(-90, 42, -2);
      return t.close();
    },
  },
  volcano: {
    name: 'Volcano Spiral',
    desc: 'Climb a double helix round a volcano, then drop into a mega loop',
    theme: 'volcano',
    width: 15,
    build() {
      const t = new TrackTurtle(0, 4, 0, 0, this.width).paint('#ff7a00');
      t.straight(40).boost(12).straight(20);
      t.turn(-90, 40);
      t.straight(30);
      t.paint('#39d353').turn(-720, 48, 52).paint('#ff7a00');
      t.marks.volcano = { ...t.lastCenter };
      t.straight(30);
      t.straight(90, -48).boost(14);
      t.paint('#1e90ff').loop(38, 1).paint('#ff7a00');
      t.straight(40);
      t.turn(-90, 42);
      t.straight(8).boost(12).straight(16, 3).gap(26, -5).straight(32, -2);
      t.turn(-90, 42);
      t.boost(12).straight(190);
      t.turn(-90, 42);
      return t.close();
    },
  },
  twin: {
    name: 'Twin Peaks',
    desc: 'Two routes and a key-locked shortcut: pick your path',
    theme: 'toy',
    width: 15,
    build() {
      const t = new TrackTurtle(0, 4, 0, 0, this.width).paint('#ff7a00');
      t.straight(40).boost(12).straight(20).mark('f1');
      // Low road: flat and fast
      t.straight(95).boost(12).straight(120).boost(12).straight(91).mark('j1');
      t.straight(20);
      t.turn(-90, 45);
      t.straight(20).mark('k1').straight(30);
      // Trick kicker
      t.paint('#ffd000').ramp(14, 1.6).gap(40, -2).straight(34, -3).paint('#ff7a00');
      t.straight(LEG.twin2);
      t.turn(-90, 45);
      t.straight(20).mark('f2');
      // Long way round: a wide S-bend (the shortcut cuts straight through)
      t.straight(62).turn(80, 40).turn(-160, 40).turn(80, 40).straight(62).mark('j2');
      t.straight(LEG.twin3);
      t.turn(-90, 45);
      t.boost(12).straight(LEG.twin4);
      t.turn(-90, 45);
      return t.close();
    },
    branches: [
      {
        from: 'f1', to: 'j1', side: 1, name: 'HIGH ROAD', color: '#39d353',
        build(b) {
          // Peel off flat, climb, jump, come back down, merge back in
          b.sOut(36).straight(22, 7).paint('#ffd000').ramp(14, 1.6).gap(34, -4).paint('#39d353').straight(24, -4.6);
        },
      },
      {
        from: 'f2', to: 'j2', side: 1, name: 'SHORTCUT', color: '#b400ff', lock: 'k1',
        build(b) {
          b.sOut(36).straight(8).corkscrew(54, 1).boost(10);
        },
      },
    ],
    keys: [{ id: 'k1', at: 'k1', d: 4.5 }],
  },
  junction: {
    name: 'Neon Junction',
    desc: 'Split-level sky highway with a locked express lane',
    theme: 'neon',
    width: 16,
    build() {
      const t = new TrackTurtle(0, 26, 0, 0, this.width).paint('#1f4bff');
      t.straight(40).boost(12).straight(20).mark('f1');
      // Upper deck: rolling waves
      t.straight(105).paint('#ff2bd6').straight(30, 6).straight(30, -6).straight(30, 6).straight(30, -6).paint('#1f4bff').straight(105).mark('j1');
      t.straight(20);
      t.turn(-90, 50);
      t.straight(30);
      t.paint('#ffe600').ramp(14, 1.6).gap(40, -2).straight(16, -3).paint('#1f4bff').mark('k1').straight(30);
      t.straight(LEG.junc2);
      t.turn(-90, 50);
      t.straight(20).mark('f2');
      // Long way round: zig-zag with a loop
      t.straight(80).turn(70, 38).paint('#00d2ff').loop(26, 1).paint('#1f4bff').turn(-140, 38).turn(70, 38).straight(80).mark('j2');
      t.straight(LEG.junc3);
      t.turn(-90, 50);
      t.boost(12).straight(LEG.junc4);
      t.turn(-90, 50);
      return t.close();
    },
    branches: [
      {
        from: 'f1', to: 'j1', side: -1, name: 'LOWER DECK', color: '#00d2ff',
        build(b) {
          b.sOut(-36).straight(6).straight(24, -10).boost(12).straight(16).boost(12).straight(24, 10);
        },
      },
      {
        from: 'f2', to: 'j2', side: 1, name: 'EXPRESS', color: '#ffe600', lock: 'k1',
        build(b) {
          b.sOut(36).straight(8).straight(26, 10).boost(12).straight(26, -10);
        },
      },
    ],
    keys: [{ id: 'k1', at: 'k1', d: -5 }],
  },
};
export const TRACK_IDS = Object.keys(TRACKS);
