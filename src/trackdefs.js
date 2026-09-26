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

  emit(p, { gap = false, boost = false } = {}) {
    this.pts.push({ p: p.clone(), roll: this.roll, gap, boost, color: this.col });
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
      this.emit(this.pos, {});
    }
    return this;
  }

  /** Smooth Hermite curve back to the start point and heading. */
  close() {
    const pE = this.pos.clone(), dE = this.dir();
    const p0 = this.start.pos, d0 = new THREE.Vector3(Math.sin(this.start.yaw), 0, Math.cos(this.start.yaw));
    const dist = pE.distanceTo(p0);
    const n = Math.max(2, Math.ceil((dist * 1.2) / STEP));
    const m0 = dE.clone().multiplyScalar(dist), m1 = d0.clone().multiplyScalar(dist);
    const p = new THREE.Vector3();
    for (let i = 1; i < n; i++) {
      const t = i / n, t2 = t * t, t3 = t2 * t;
      p.set(0, 0, 0)
        .addScaledVector(pE, 2 * t3 - 3 * t2 + 1)
        .addScaledVector(m0, t3 - 2 * t2 + t)
        .addScaledVector(p0, -2 * t3 + 3 * t2)
        .addScaledVector(m1, t3 - t2);
      this.emit(p, {});
    }
    return this;
  }
}

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
};
export const TRACK_IDS = Object.keys(TRACKS);
