import * as THREE from 'three';
import { Track, Path } from './track.js';
import { buildCar, CARS, CAR_IDS } from './cars.js';
import { Fx } from './fx.js';
import { BOT_NAMES } from './bots.js';
import { Hud } from './hud.js';
import { COLORS } from './game.js';

const G = 34;
const BASE_TOP = 58;
const GRIPC = 60;
const CAR_HALF_W = 1.15;
const SNAP_MS = 50;
const FINISH_GRACE_MS = 30000;

const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const r2 = (n) => Math.round(n * 100) / 100;
const r3 = (n) => Math.round(n * 1000) / 1000;
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const ord = (n) => n + (['th', 'st', 'nd', 'rd'][((n % 100) - 20) % 10] || ['th', 'st', 'nd', 'rd'][n % 100] || 'th');

function fmtTime(ms) {
  if (!(ms >= 0)) return '--:--.--';
  const m = Math.floor(ms / 60000), s = Math.floor((ms % 60000) / 1000), c = Math.floor((ms % 1000) / 10);
  return `${m}:${String(s).padStart(2, '0')}.${String(c).padStart(2, '0')}`;
}

const _m = new THREE.Matrix4();
const _r = new THREE.Vector3();

/** Ring buffer of tire-mark quads laid on the road while cars drift. */
class SkidMarks {
  constructor(scene, max = 3000) {
    this.max = max;
    this.i = 0;
    this.count = 0;
    this.pos = new Float32Array(max * 18);
    this.geo = new THREE.BufferGeometry();
    this.attr = new THREE.BufferAttribute(this.pos, 3);
    this.attr.setUsage(THREE.DynamicDrawUsage);
    this.geo.setAttribute('position', this.attr);
    this.geo.setDrawRange(0, 0);
    const mesh = new THREE.Mesh(
      this.geo,
      new THREE.MeshBasicMaterial({ color: '#0d0d10', transparent: true, opacity: 0.55, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2, side: THREE.DoubleSide }),
    );
    mesh.frustumCulled = false;
    mesh.renderOrder = 1;
    scene.add(mesh);
  }

  add(a, b, right, w = 0.24) {
    if (a.distanceToSquared(b) > 25) return; // teleported (respawn / fork), skip
    const q = [
      a.x - right.x * w, a.y - right.y * w, a.z - right.z * w,
      a.x + right.x * w, a.y + right.y * w, a.z + right.z * w,
      b.x + right.x * w, b.y + right.y * w, b.z + right.z * w,
      b.x - right.x * w, b.y - right.y * w, b.z - right.z * w,
    ];
    const o = this.i * 18;
    for (const [k, v] of [0, 1, 2, 0, 2, 3].entries()) this.pos.set(q.slice(v * 3, v * 3 + 3), o + k * 3);
    this.i = (this.i + 1) % this.max;
    this.count = Math.min(this.max, this.count + 1);
    this.geo.setDrawRange(0, this.count * 6);
    this.attr.needsUpdate = true;
  }
}
const _x = new THREE.Vector3();
const _v = new THREE.Vector3();

// ------------------------------------------------------------------ car

export class RaceCar {
  constructor(scene, { id, name, color, car, local = false, bot = false }) {
    this.id = id;
    this.name = name;
    this.color = color;
    this.carType = CARS[car] ? car : 'hyper';
    this.stats = CARS[this.carType];
    this.local = local;
    this.bot = bot;
    this.scene = scene;

    this.s = 0;
    this.d = 0;
    this.v = 0;
    this.psi = 0;
    this.flying = false;
    this.flyT = 0;
    this.crashT = 0;
    this.wpos = new THREE.Vector3();
    this.wvel = new THREE.Vector3();
    this.fwd = new THREE.Vector3(0, 0, 1);
    this.up = new THREE.Vector3(0, 1, 0);
    this.lap = 0;
    this.finished = 0;
    this.inRace = false;
    this.boost = 0.6;
    this.boosting = false;
    this.drifting = false;
    this.padT = 0;
    this.steerVis = 0;
    this.wheelSpin = 0;
    this.safeProg = 0;
    this.topMul = 1;
    this.route = 0; // 0 = main circuit, n = alternate route n
    this.keys = new Set();
    this.spin = 0;
    this.spinT = 0;
    this.flip = 0;
    this.flipT = 0;
    this.driftT = 0;
    this.bodyYaw = 0;

    this.hasNet = false;
    this.net = null;
    this.netTime = 0;

    const m = buildCar(this.carType, color);
    this.model = m;
    this.root = new THREE.Group();
    // Tricks rotate the car around its middle, not its wheels
    this.pivot = new THREE.Group();
    this.pivot.position.y = 0.9;
    this.pivot.rotation.order = 'YXZ';
    m.group.position.y = -0.9;
    this.pivot.add(m.group);
    this.root.add(this.pivot);
    if (!local) {
      const c = document.createElement('canvas');
      c.width = 256;
      c.height = 48;
      const g = c.getContext('2d');
      g.font = 'bold 30px system-ui, sans-serif';
      g.textAlign = 'center';
      g.lineWidth = 6;
      g.strokeStyle = 'rgba(0,0,0,0.75)';
      g.strokeText(name, 128, 34);
      g.fillStyle = color;
      g.fillText(name, 128, 34);
      const tex = new THREE.CanvasTexture(c);
      tex.colorSpace = THREE.SRGBColorSpace;
      const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, depthTest: false, transparent: true }));
      sp.scale.set(5, 0.95, 1);
      sp.position.y = m.roofY + 1.3;
      sp.renderOrder = 10;
      this.root.add(sp);
    }
    this.root.visible = false;
    scene.add(this.root);
  }

  get progress() {
    return this.lap * 1e6 + this.s;
  }

  placeAt(track, s, d, fr) {
    this.route = 0;
    this.s = track.wrap(s);
    this.d = d;
    this.v = 0;
    this.psi = 0;
    this.flying = false;
    this.crashT = 0;
    this.padT = 0;
    this.boost = 0.6;
    this.resetTricks();
    this.syncWorld(track, fr);
  }

  resetTricks() {
    this.spin = this.spinT = this.flip = this.flipT = 0;
  }

  syncWorld(track, fr) {
    track.pathOf(this.route).frame(this.s, fr);
    this.wpos.copy(fr.P).addScaledVector(fr.R, this.d);
    this.fwd.copy(fr.T).multiplyScalar(Math.cos(this.psi)).addScaledVector(fr.R, Math.sin(this.psi)).normalize();
    this.up.copy(fr.N);
    this.wvel.copy(this.fwd).multiplyScalar(this.v);
  }

  yawMax(spd) {
    return Math.min(2.2, (GRIPC * this.stats.grip) / Math.max(spd, 1)) * (this.drifting ? 1.6 : 1) * Math.min(1, spd / 5);
  }

  /** Track-space arcade physics; cars stick to the road through loops. */
  step(dt, input, track, others, fr) {
    const ev = { bump: 0, launched: false, landed: false, crashed: false, respawned: false, pad: false };
    const st = this.stats;
    if (this.crashT > 0) {
      this.crashT -= dt;
      if (this.crashT <= 0) {
        this.respawn(track, fr);
        ev.respawned = true;
      }
      return ev;
    }

    this.boosting = input.boost && input.throttle > 0 && this.boost > 0.02;
    if (this.boosting) this.boost = Math.max(0, this.boost - dt * 0.4);
    else this.boost = Math.min(1, this.boost + dt * (this.drifting ? 0.3 : 0.05));

    if (!this.flying) {
      let path = track.pathOf(this.route);
      path.frame(this.s, fr);
      if (fr.boost) {
        if (this.padT <= 0) ev.pad = true;
        this.padT = 1.3;
      }
      this.padT -= dt;
      const padded = this.padT > 0;
      const top = BASE_TOP * st.speed * this.topMul * (this.boosting ? 1.3 : 1) * (padded ? 1.3 : 1);

      if (input.throttle > 0) {
        if (this.v < top) this.v += 30 * st.accel * (1 - 0.5 * Math.max(0, this.v) / top) * input.throttle * dt * (this.boosting || padded ? 2 : 1);
      } else if (input.throttle < 0) {
        this.v -= (this.v > 0 ? 55 : 22) * dt;
        this.v = Math.max(this.v, -16);
      } else {
        this.v -= Math.sign(this.v) * Math.min(Math.abs(this.v), 7 * dt);
      }
      if (this.v > top) this.v -= (this.v - top) * 1.2 * dt;
      if (fr.N.y > 0.4) this.v -= G * fr.T.y * dt * 0.7; // hills

      this.drifting = input.drift && this.v > 18 && Math.abs(input.steer) > 0.1;
      if (this.drifting) this.v -= this.v * 0.18 * dt;

      const spd = Math.abs(this.v);
      this.psi -= input.steer * this.yawMax(spd) * dt * (this.v < 0 ? -1 : 1);
      this.psi -= fr.k * this.v * Math.cos(this.psi) * dt;
      this.psi = clamp(this.psi, -1.3, 1.3);
      if (!input.steer) this.psi *= Math.exp(-0.6 * dt);
      this.steerVis += (input.steer - this.steerVis) * Math.min(1, dt * 10);

      const prevS = this.s;
      this.s += this.v * Math.cos(this.psi) * dt;
      this.d += this.v * Math.sin(this.psi) * dt;

      const lim = path.hw - CAR_HALF_W;
      if (Math.abs(this.d) > lim) {
        const hit = Math.abs(this.v * Math.sin(this.psi));
        this.d = Math.sign(this.d) * lim;
        if (Math.sign(this.psi) === Math.sign(this.d)) this.psi *= 0.15;
        this.v -= Math.min(hit * 0.35, Math.max(0, this.v) * 0.3);
        this.v *= 1 - 0.4 * dt;
        ev.bump = hit;
      }

      if (this.route === 0) {
        if (this.s >= track.L) {
          this.s -= track.L;
          this.lap++;
        } else if (this.s < 0) {
          this.s += track.L;
          this.lap--;
        }
        // Forks: whoever is on the branch side of the road (and holds its key) takes the other route
        for (const br of track.branches) {
          if (prevS < br.from && this.s >= br.from && Math.sign(this.d) === br.side && Math.abs(this.d) > 0.4) {
            if (br.lock && !this.keys.has(br.lock)) {
              ev.locked = br;
              continue;
            }
            this.route = br.id;
            this.s -= br.from;
            this.d -= br.off;
            ev.route = br;
            break;
          }
        }
        for (const k of track.keys) {
          if (!this.keys.has(k.id) && Math.abs(track.delta(this.s, k.s)) < 3 && Math.abs(this.d - k.d) < 3) {
            this.keys.add(k.id);
            ev.key = k;
          }
        }
      } else {
        const br = track.branches[this.route - 1];
        // Ease toward the half of the road that merges back into the main circuit
        if (path.L - this.s < 45) {
          const mlim = track.hw - CAR_HALF_W;
          const lo = Math.max(-lim, -mlim - br.off), hi = Math.min(lim, mlim - br.off);
          if (this.d > hi) this.d -= Math.min(this.d - hi, 10 * dt);
          if (this.d < lo) this.d += Math.min(lo - this.d, 10 * dt);
        }
        if (this.s >= path.L) {
          this.route = 0;
          this.s = br.to + (this.s - path.L);
          this.d = clamp(this.d + br.off, -track.hw + CAR_HALF_W, track.hw - CAR_HALF_W);
          ev.merged = br;
        } else if (this.s < 0) {
          this.route = 0;
          this.s = br.from + this.s;
          this.d = clamp(this.d + br.off, -track.hw + CAR_HALF_W, track.hw - CAR_HALF_W);
        }
      }
      path = track.pathOf(this.route);

      for (const o of others) {
        if (o === this || !o.inRace || o.flying || o.crashT > 0 || !o.root.visible || o.route !== this.route) continue;
        const ds = path.delta(this.s, o.s);
        const dd = o.d - this.d;
        if (Math.abs(ds) < 4.4 && Math.abs(dd) < 2.2) {
          this.d -= Math.sign(dd || 1) * (2.2 - Math.abs(dd)) * 0.5;
          if (ds > 0 && this.v > o.v) {
            const rel = this.v - o.v;
            this.v -= rel * 0.6;
            ev.bump = Math.max(ev.bump, rel);
          } else if (ds < 0 && o.v > this.v) {
            this.v += (o.v - this.v) * 0.3;
          }
        }
      }

      path.frame(this.s, fr);
      if (fr.gap) {
        this.launch(fr, path);
        ev.launched = true;
      } else {
        if (this.route === 0) this.safeProg = this.lap * track.L + this.s;
        this.wpos.copy(fr.P).addScaledVector(fr.R, this.d);
        this.fwd.copy(fr.T).multiplyScalar(Math.cos(this.psi)).addScaledVector(fr.R, Math.sin(this.psi)).normalize();
        this.up.copy(fr.N);
        this.wvel.copy(this.fwd).multiplyScalar(this.v);
      }
    } else {
      this.flyT += dt;
      this.drifting = false;
      // Tricks: A/D queue a spin, Space queues a flip
      if (input.spin) this.spinT += Math.PI * 2 * Math.sign(input.spin);
      if (input.flip) this.flipT += Math.PI * 2;
      this.spin += clamp(this.spinT - this.spin, -17 * dt, 17 * dt);
      this.flip += clamp(this.flipT - this.flip, -15 * dt, 15 * dt);
      this.wvel.y -= G * dt;
      const yaw = input.steer * 0.9 * dt;
      const c = Math.cos(yaw), sn = Math.sin(yaw);
      const vx = this.wvel.x, vz = this.wvel.z;
      this.wvel.x = vx * c + vz * sn;
      this.wvel.z = -vx * sn + vz * c;
      this.wpos.addScaledVector(this.wvel, dt);
      _v.copy(this.wvel).normalize();
      this.fwd.lerp(_v, Math.min(1, dt * 3)).normalize();
      this.up.lerp(_x.set(0, 1, 0), Math.min(1, dt * 3)).normalize();
      this.tryLand(track, fr, ev);
      if (ev.landed) {
        ev.air = this.flyT;
        this.scoreTricks(ev);
      }
      if (this.flying && (this.wpos.y < 0.8 || this.flyT > 5)) {
        this.flying = false;
        this.crashT = 1.4;
        this.v = 0;
        this.resetTricks();
        ev.crashed = true;
      }
    }
    return ev;
  }

  /** Landing: finished tricks give a speed boost, landing mid-trick costs speed. */
  scoreTricks(ev) {
    const count = Math.round(Math.abs(this.spinT) / (Math.PI * 2)) + Math.round(this.flipT / (Math.PI * 2));
    if (count > 0) {
      const clean = Math.abs(this.spinT - this.spin) < 0.45 && Math.abs(this.flipT - this.flip) < 0.45;
      if (clean) {
        ev.trick = { count, spins: Math.round(Math.abs(this.spinT) / (Math.PI * 2)), flips: Math.round(this.flipT / (Math.PI * 2)) };
        this.padT = 0.9 + 0.5 * count;
        this.v += 7 * count;
        this.boost = Math.min(1, this.boost + 0.15 * count);
      } else {
        ev.sloppy = true;
        this.v *= 0.55;
      }
    }
    this.resetTricks();
  }

  launch(fr, path) {
    this.flying = true;
    this.flyT = 0;
    this.resetTricks();
    this.wpos.copy(fr.P).addScaledVector(fr.R, this.d);
    const T = _x.copy(fr.T), N = _r.copy(fr.N);
    const kicker = path.kick[path.idx(this.s - 3)];
    if (kicker) this.psi *= 0.4; // kickers straighten you up so you can land it
    // Kickers: leave along the steepest bit of the ramp (the spline rounds off the very lip)
    const lip = (this.lipFr ||= Path.newFrame());
    let best = -Infinity;
    for (let k = 1; kicker && k <= 8; k++) {
      path.frame(this.s - k, lip);
      if (lip.T.y > best) {
        best = lip.T.y;
        T.copy(lip.T);
        N.copy(lip.N);
      }
    }
    this.fwd.copy(T).multiplyScalar(Math.cos(this.psi)).addScaledVector(fr.R, Math.sin(this.psi)).normalize();
    this.wvel.copy(this.fwd).multiplyScalar(this.v).addScaledVector(N, 2.5);
    this.up.copy(N);
  }

  tryLand(track, fr, ev) {
    const path = track.pathOf(this.route);
    const n = path.n;
    const i0 = path.idx(this.s);
    let best = -1, bestAlong = 0;
    for (let j = 0; j < 160; j++) {
      if (!path.closed && i0 + j >= n) break;
      const i = (i0 + j) % n;
      _v.fromArray(path.P, i * 3);
      _x.fromArray(path.T, i * 3);
      const along = (this.wpos.x - _v.x) * _x.x + (this.wpos.y - _v.y) * _x.y + (this.wpos.z - _v.z) * _x.z;
      if (along < 0) break;
      best = i;
      bestAlong = along;
    }
    if (best < 0) return;
    let s = best * path.ds + bestAlong;
    if (path.closed) {
      if (s >= path.L) s -= path.L;
      if (s < this.s - path.L / 2) this.lap++;
    }
    this.s = s;
    if (path.gap[best]) return;
    path.frame(s, fr);
    _v.copy(this.wpos).sub(fr.P);
    const h = _v.dot(fr.N), d = _v.dot(fr.R);
    if (h <= 0.4 && h > -5 && Math.abs(d) < path.hw + 2) {
      this.flying = false;
      this.d = clamp(d, -path.hw + CAR_HALF_W, path.hw - CAR_HALF_W);
      this.v = Math.max(0, this.wvel.dot(fr.T));
      this.psi = clamp(Math.atan2(this.wvel.dot(fr.R), this.wvel.dot(fr.T)), -0.6, 0.6);
      ev.landed = true;
    }
  }

  respawn(track, fr) {
    const path = track.pathOf(this.route);
    this.resetTricks();
    // Fell short of a jump: put the car down just past the landing so it can't get stuck retrying
    for (const g of path.gaps) {
      const into = path.delta(g.start, this.s);
      if (into >= -5 && into <= g.end - g.start + 60) {
        const s = path.wrap(g.end + 14);
        if (path.closed && s < this.s - path.L / 2) this.lap++;
        this.s = s;
        this.d = 0;
        this.psi = 0;
        this.v = 26;
        this.flying = false;
        if (this.route === 0) this.safeProg = this.lap * track.L + s;
        this.syncWorld(track, fr);
        return;
      }
    }
    this.route = 0;
    const prog = Math.max(0, this.safeProg - 30);
    this.lap = Math.floor(prog / track.L);
    this.s = prog - this.lap * track.L;
    // Make sure we don't respawn inside a gap
    for (let k = 0; k < 200 && track.gap[track.idx(this.s)]; k++) this.s = track.wrap(this.s - 5);
    this.d = 0;
    this.psi = 0;
    this.v = 22;
    this.flying = false;
    this.syncWorld(track, fr);
  }

  setNet(e, now) {
    // [id, s, d, v, psi, flying, x, y, z, vx, vy, vz, lap, finished, boosting, inRace, route, spin, flip, drifting, steer]
    this.net = {
      s: e[1], d: e[2], v: e[3], psi: e[4], flying: !!e[5],
      x: e[6], y: e[7], z: e[8], vx: e[9], vy: e[10], vz: e[11],
      route: e[16] || 0, spin: e[17] || 0, flip: e[18] || 0, steer: e[20] || 0,
    };
    this.lap = e[12];
    this.finished = e[13];
    this.boosting = !!e[14];
    this.inRace = !!e[15];
    this.drifting = !!e[19];
    this.netTime = now;
    if (!this.hasNet || this.net.route !== this.route) {
      this.route = this.net.route;
      this.s = e[1];
      this.d = e[2];
      this.psi = e[4];
      this.wpos.set(e[6], e[7], e[8]);
    }
    this.hasNet = true;
  }

  updateRemote(dt, now, track, fr) {
    const n = this.net;
    if (!n) return;
    const age = Math.min((now - this.netTime) / 1000, 0.3);
    const k = 1 - Math.exp(-12 * dt);
    const path = track.pathOf(this.route);
    this.v = n.v;
    this.flying = n.flying;
    this.spin += (n.spin - this.spin) * k;
    this.flip += (n.flip - this.flip) * k;
    this.steerVis += (n.steer - this.steerVis) * k;
    if (!n.flying) {
      const target = n.s + n.v * Math.cos(n.psi) * age;
      const ds = path.delta(this.s, target);
      this.s = Math.abs(ds) > 30 ? path.wrap(target) : path.wrap(this.s + ds * k);
      this.d += (n.d - this.d) * k;
      this.psi += (n.psi - this.psi) * k;
      this.syncWorld(track, fr);
    } else {
      _v.set(n.x + n.vx * age, n.y + n.vy * age - 0.5 * G * age * age, n.z + n.vz * age);
      if (this.wpos.distanceTo(_v) > 20) this.wpos.copy(_v);
      else this.wpos.lerp(_v, k);
      this.wvel.set(n.vx, n.vy, n.vz);
      _v.copy(this.wvel).normalize();
      this.fwd.lerp(_v, k).normalize();
      this.up.lerp(_x.set(0, 1, 0), k).normalize();
    }
  }

  updateVisual(dt, visible) {
    this.root.visible = visible && this.crashT <= 0;
    if (!this.root.visible) return;
    this.root.position.copy(this.wpos);
    _x.crossVectors(this.up, this.fwd).normalize();
    const up = _v.crossVectors(this.fwd, _x).normalize();
    _m.makeBasis(_x, up, this.fwd);
    this.root.quaternion.setFromRotationMatrix(_m);
    this.pivot.rotation.set(-this.flip, this.spin, 0);
    const b = this.model;
    this.wheelSpin += (this.v * dt) / b.wheelRadius;
    for (const w of b.wheels) w.rotation.x = this.wheelSpin;
    for (const p of b.frontPivots) p.rotation.y = (this.drifting ? -this.steerVis * 0.35 : this.steerVis * 0.4); // counter-steer while drifting
    // Drifting: swing the tail out hard and lean onto the outside wheels
    this.driftT = this.drifting ? this.driftT + dt : 0;
    const yawTarget = this.drifting ? this.steerVis * 0.65 : 0;
    this.bodyYaw += (yawTarget - this.bodyYaw) * Math.min(1, dt * (this.drifting ? 7 : 5));
    b.body.rotation.y = this.bodyYaw;
    b.body.rotation.z = -this.steerVis * Math.min(1, Math.abs(this.v) / 40) * (this.drifting ? 0.14 : 0.06);
    const flame = this.boosting || this.padT > 0;
    for (const f of b.flames) {
      f.visible = flame;
      if (flame) f.scale.set(1, 0.7 + Math.random() * 0.9, 1);
    }
  }

  dispose() {
    this.scene.remove(this.root);
    this.root.traverse((o) => {
      o.geometry?.dispose();
      if (o.material) {
        o.material.map?.dispose();
        o.material.dispose();
      }
    });
  }
}

// ------------------------------------------------------------------ AI

class RaceBrain {
  constructor() {
    this.lane = (Math.random() - 0.5) * 4;
    this.fr = Track.newFrame();
    this.laneT = 0;
    this.routeRoll = new Map();
    this.trickDone = false;
  }

  think(dt, car, track, cars, fr) {
    const input = { throttle: 1, steer: 0, boost: false, drift: false, spin: 0, flip: false };
    if (car.crashT > 0) return input;
    if (car.flying) {
      // One trick per jump, most of the time
      if (!this.trickDone && car.flyT > 0.05) {
        this.trickDone = true;
        const r = Math.random();
        if (r < 0.45) input.spin = Math.random() < 0.5 ? -1 : 1;
        else if (r < 0.7) input.flip = true;
      }
      return input;
    }
    this.trickDone = false;
    const path = track.pathOf(car.route);
    this.laneT -= dt;
    if (this.laneT <= 0) {
      this.laneT = 3 + Math.random() * 4;
      this.lane = (Math.random() - 0.5) * 5;
    }
    let kMax = 0, kAvg = 0, cnt = 0;
    for (let a = 6; a <= 70; a += 4) {
      path.frame(car.s + a, this.fr);
      kMax = Math.max(kMax, Math.abs(this.fr.k));
      if (a <= 34) {
        kAvg += this.fr.k;
        cnt++;
      }
    }
    kAvg /= cnt;
    const hw = path.hw;
    let target = clamp(kAvg * 280, -hw * 0.5, hw * 0.5) + this.lane;
    for (const o of cars) {
      if (o === car || !o.inRace || o.flying || o.route !== car.route) continue;
      const ds = path.delta(car.s, o.s);
      if (ds > 0 && ds < 16 && Math.abs(o.d - car.d) < 2.8 && car.v > o.v - 3) {
        target = o.d + (o.d > 0 ? -3.6 : 3.6);
      }
    }
    if (car.route === 0) {
      // Grab keys, and pick a route at each fork (always use unlocked shortcuts)
      for (const k of track.keys) {
        const ahead = track.delta(car.s, k.s);
        if (!car.keys.has(k.id) && ahead > 0 && ahead < 70) target = k.d;
      }
      for (const br of track.branches) {
        const ahead = track.delta(car.s, br.from);
        if (ahead < 0 || ahead > 80) continue;
        if (!this.routeRoll.has(br.id) || this.routeRoll.get(br.id).lap !== car.lap) {
          this.routeRoll.set(br.id, { lap: car.lap, take: br.lock ? true : Math.random() < 0.5 });
        }
        const take = this.routeRoll.get(br.id).take && (!br.lock || car.keys.has(br.lock));
        target = take ? br.side * hw * 0.55 : -br.side * 2.5;
      }
    }
    target = clamp(target, -hw + 2, hw - 2);
    path.frame(car.s, fr);
    const want = clamp((target - car.d) * 0.1, -0.35, 0.35);
    const vmax = Math.sqrt((GRIPC * car.stats.grip) / Math.max(kMax, 1e-4));
    input.drift = car.v > vmax * 1.02 && car.v > 25;
    car.drifting = input.drift && car.v > 18;
    const ym = car.yawMax(Math.abs(car.v));
    input.steer = clamp(-((want - car.psi) * 4 + fr.k * car.v) / Math.max(ym, 0.05), -1, 1);
    if (car.v > vmax * 1.6) input.throttle = -1;
    else if (car.v > vmax * 1.35) input.throttle = 0;
    input.boost = kMax < 0.012 && car.boost > 0.35;
    return input;
  }
}

// ------------------------------------------------------------------ game

export class RaceGame {
  constructor({ net, name, color, car, botCount = 0, sfx, code, map, laps = 3, welcome, mobile = null }) {
    this.mobile = mobile;
    this.net = net;
    this.sfx = sfx;
    this.code = code;
    this.laps = laps;
    this.hud = new Hud();
    document.body.classList.add('mode-race');

    const renderer = (this.renderer = new THREE.WebGLRenderer({ antialias: true }));
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, mobile ? 1.5 : 2));
    renderer.setSize(window.innerWidth, window.innerHeight);
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFShadowMap;
    document.getElementById('game').appendChild(renderer.domElement);

    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(72, window.innerWidth / window.innerHeight, 0.3, 3000);
    this.mapId = welcome?.map || map;
    this.track = new Track(this.mapId);
    this.track.build(this.scene);
    this.fx = new Fx(this.scene);
    this.skids = new SkidMarks(this.scene);
    this.fr = Track.newFrame();

    this.cars = new Map();
    this.players = new Map();
    this.bots = [];
    this.results = new Map();
    this.keys = new Set();
    this.phase = 'lobby';
    this.goAt = 0;
    this.firstFinish = 0;
    this.lastSnap = 0;
    this.lastCount = -1;
    this.paused = false;
    this.lastHostMsg = performance.now();

    this.me = this.addCar(net.myId, name, color, car, { local: true });
    this.me.inRace = false;

    this.bindInput();
    this.bindNet();
    this.buildMinimap();

    if (net.isHost) {
      for (let i = 0; i < botCount; i++) this.addBot(i);
      this.lobbyPlace();
    } else if (welcome) {
      this.onMsg(welcome, welcome.i);
    }

    this.hud.show();
    window.addEventListener('resize', () => this.onResize());
    this.last = performance.now();
    requestAnimationFrame((t) => this.frame(t));
  }

  addCar(id, name, color, car, { local = false, bot = false, wins = 0 } = {}) {
    name = String(name || 'Racer').slice(0, 16);
    color = /^#[0-9a-f]{6}$/i.test(color) ? color : '#ffffff';
    car = CARS[car] ? car : 'hyper';
    this.players.set(id, { name, color, car, bot, wins });
    let c = this.cars.get(id);
    if (!c) {
      c = new RaceCar(this.scene, { id, name, color, car, local, bot });
      this.cars.set(id, c);
    }
    return c;
  }

  addBot(i) {
    const id = `bot-${i}`;
    const palette = COLORS.filter((c) => c !== this.me.color);
    const c = this.addCar(id, BOT_NAMES[i % BOT_NAMES.length], palette[(i + 2) % palette.length], CAR_IDS[i % CAR_IDS.length], { bot: true });
    c.topMul = 0.9 + Math.random() * 0.08;
    this.bots.push({ car: c, brain: new RaceBrain() });
  }

  removeCar(id) {
    const p = this.players.get(id);
    if (p) this.hud.feed(`<span style="color:${esc(p.color)}">${esc(p.name)}</span> left`);
    this.players.delete(id);
    const c = this.cars.get(id);
    if (c) {
      c.dispose();
      this.cars.delete(id);
    }
  }

  gridSlot(k) {
    return { s: -10 - Math.floor(k / 2) * 8, d: k % 2 ? 3.2 : -3.2 };
  }

  /** In the lobby everyone free-drives; spread cars along the start straight. */
  lobbyPlace() {
    let k = 0;
    for (const c of this.cars.values()) {
      if (c.local || c.bot) {
        const g = this.gridSlot(k);
        c.placeAt(this.track, g.s, g.d, this.fr);
        c.lap = 0;
        c.finished = 0;
      }
      k++;
    }
  }

  // ---------------- input ----------------

  bindInput() {
    const overlay = document.getElementById('clickToPlay');
    overlay.querySelector('p').textContent = 'Game paused. Your car keeps rolling!';
    document.getElementById('resume').addEventListener('click', () => {
      this.paused = false;
      overlay.classList.add('hidden');
      if (this.mobile) {
        this.mobile.setVisible(true);
        this.mobile.calibrate();
      }
    });
    if (this.mobile) {
      overlay.querySelector('p').textContent = 'Tilt to steer, tilt forward for gas and back to brake. In the air, tap the left/right side of the screen to spin or DRIFT to flip. Hold the phone how you like to drive, then tap Play.';
      this.mobile.onPause = () => {
        this.paused = true;
        this.mobile.setVisible(false);
        overlay.classList.remove('hidden');
      };
    }
    document.getElementById('leave').addEventListener('click', () => this.exit());
    document.getElementById('startRace').addEventListener('click', () => this.hostStart());
    document.addEventListener('keydown', (e) => {
      if (e.target instanceof HTMLInputElement) return;
      if (['Tab', 'Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.code)) e.preventDefault();
      this.sfx.init();
      this.keys.add(e.code);
      // Trick buttons act on the press, not while held
      if (!e.repeat) {
        if (e.code === 'KeyA' || e.code === 'ArrowLeft') this.edgeSpin = 1;
        if (e.code === 'KeyD' || e.code === 'ArrowRight') this.edgeSpin = -1;
        if (e.code === 'Space') this.edgeFlip = true;
      }
      if (e.code === 'Escape') {
        this.paused = !this.paused;
        overlay.classList.toggle('hidden', !this.paused);
      }
      if (e.code === 'Enter') this.hostStart();
      if (e.code === 'KeyR' && this.me.inRace && !this.me.flying && this.me.crashT <= 0) {
        this.me.d = 0;
        this.me.psi = 0;
        this.me.v = Math.min(this.me.v, 10);
      }
      if (e.code === 'KeyM') {
        this.sfx.setMuted(!this.sfx.muted);
        this.hud.toast(this.sfx.muted ? 'Sound off' : 'Sound on');
      }
    });
    document.addEventListener('keyup', (e) => this.keys.delete(e.code));
    window.addEventListener('blur', () => this.keys.clear());
    document.addEventListener('mousedown', () => this.sfx.init());
    document.addEventListener('click', (e) => {
      if (e.target?.id === 'lobbyStart') this.hostStart();
      if (e.target?.id === 'copyLink') {
        const url = `${location.origin}${location.pathname}?room=${this.code}`;
        navigator.clipboard?.writeText(url).then(() => this.hud.toast('Invite link copied!'), () => this.hud.toast(url));
      }
    });
  }

  readInput() {
    const on = (...c) => c.some((k) => this.keys.has(k));
    const spin = this.edgeSpin || 0, flip = !!this.edgeFlip;
    this.edgeSpin = 0;
    this.edgeFlip = false;
    if (this.paused) return { throttle: 0, steer: 0, boost: false, drift: false, spin: 0, flip: false };
    if (this.mobile) return this.mobile.read();
    return {
      throttle: (on('KeyW', 'ArrowUp') ? 1 : 0) - (on('KeyS', 'ArrowDown') ? 1 : 0),
      steer: (on('KeyA', 'ArrowLeft') ? 1 : 0) - (on('KeyD', 'ArrowRight') ? 1 : 0),
      boost: on('ShiftLeft', 'ShiftRight'),
      drift: on('Space'),
      spin,
      flip,
    };
  }

  // ---------------- networking ----------------

  bindNet() {
    const net = this.net;
    net.on('msg', (m, from) => {
      this.lastHostMsg = performance.now();
      this.onMsg(m, from);
    });
    net.on('leave', (id) => this.removeCar(id));
    net.on('closed', () => this.endGame('Host left the game', 'The room has closed.'));
    if (net.offline) return;
    setInterval(() => {
      if (net.isHost) net.send({ t: 'ping' });
      else if (performance.now() - this.lastHostMsg > 10000) this.endGame('Lost connection to host', 'The host left or their connection dropped.');
    }, 1000);
  }

  welcomeMsg() {
    return {
      t: 'welcome',
      mode: 'race',
      map: this.mapId,
      laps: this.laps,
      phase: this.phase,
      players: [...this.players.entries()].map(([id, p]) => [id, p.name, p.color, p.car, p.bot ? 1 : 0, p.wins]),
    };
  }

  onMsg(m, from) {
    const now = performance.now();
    const host = this.net.isHost;
    switch (m.t) {
      case 'hello': {
        if (!host) return;
        const c = this.addCar(from, m.name, m.color, m.car);
        c.inRace = false;
        this.net.sendTo(from, this.welcomeMsg());
        const p = this.players.get(from);
        this.net.sendExcept(from, { t: 'pj', id: from, name: p.name, color: p.color, car: p.car });
        this.hud.feed(`<span style="color:${esc(p.color)}">${esc(p.name)}</span> joined`);
        break;
      }
      case 'welcome': {
        this.laps = m.laps;
        for (const [id, name, color, car, bot, wins] of m.players) {
          if (id === this.me.id) continue;
          this.addCar(id, name, color, car, { bot: false, wins }).inRace = false;
          this.players.get(id).bot = !!bot;
        }
        this.phase = m.phase === 'lobby' || m.phase === 'results' ? m.phase : 'spectate';
        const g = this.gridSlot(this.players.size - 1);
        this.me.placeAt(this.track, g.s - 8, g.d, this.fr);
        if (this.phase === 'spectate') this.hud.center('Race in progress', 'You will join the next race', 4000);
        break;
      }
      case 'pj':
        if (m.id !== this.me.id) {
          this.addCar(m.id, m.name, m.color, m.car).inRace = false;
          this.hud.feed(`<span style="color:${esc(m.color)}">${esc(this.players.get(m.id).name)}</span> joined`);
        }
        break;
      case 'leave':
        this.removeCar(m.id);
        break;
      case 's':
        for (const e of m.e) {
          if (e[0] === this.me.id) continue;
          if (e[0] !== m.i && !(this.players.get(e[0])?.bot && !host)) continue;
          const c = this.cars.get(e[0]);
          if (c && !c.bot) c.setNet(e, now);
        }
        break;
      case 'rs':
        if (!host && m.i) this.startRace(m, now);
        break;
      case 'fin':
        if (m.id !== m.i && !this.players.get(m.id)?.bot) return;
        this.onFinish(m.id, m.time);
        break;
      case 're':
        this.onRaceEnd(m.order);
        break;
    }
  }

  hostStart() {
    if (!this.net.isHost || !(this.phase === 'lobby' || this.phase === 'results')) return;
    const ids = [...this.cars.keys()];
    // Previous winners start at the back
    ids.sort((a, b) => (this.players.get(a)?.wins || 0) - (this.players.get(b)?.wins || 0) || Math.random() - 0.5);
    const m = { t: 'rs', grid: ids, laps: this.laps, in: 4000 };
    this.net.send(m);
    this.startRace(m, performance.now());
  }

  startRace(m, now) {
    this.phase = 'countdown';
    this.goAt = now + m.in;
    this.laps = m.laps;
    this.results.clear();
    this.firstFinish = 0;
    this.lastCount = -1;
    document.getElementById('results').classList.add('hidden');
    for (const c of this.cars.values()) c.keys.clear();
    this.track.setOwnedKeys(this.me.keys);
    m.grid.forEach((id, k) => {
      const c = this.cars.get(id);
      if (!c) return;
      c.inRace = true;
      c.finished = 0;
      c.lap = 0;
      if (c.local || c.bot) {
        const g = this.gridSlot(k);
        c.placeAt(this.track, g.s, g.d, this.fr);
      }
    });
    for (const c of this.cars.values()) if (!m.grid.includes(c.id)) c.inRace = false;
  }

  onFinish(id, time) {
    if (this.results.has(id)) return;
    this.results.set(id, time);
    const c = this.cars.get(id);
    if (c) c.finished = time;
    if (!this.firstFinish) this.firstFinish = performance.now();
    const p = this.players.get(id);
    const place = this.results.size;
    if (p) this.hud.feed(`🏁 <span style="color:${esc(p.color)}">${esc(p.name)}</span> finished ${ord(place)} · ${fmtTime(time)}`);
    if (id === this.me.id) {
      this.hud.center(place === 1 ? 'YOU WIN!' : `FINISHED ${ord(place).toUpperCase()}`, fmtTime(time), 4000);
      this.sfx.play(place === 1 ? 'kill' : 'lap');
    }
  }

  standings() {
    const racers = [...this.cars.values()].filter((c) => c.inRace);
    return racers.sort((a, b) => {
      const fa = this.results.get(a.id), fb = this.results.get(b.id);
      if (fa != null && fb != null) return fa - fb;
      if (fa != null) return -1;
      if (fb != null) return 1;
      return this.track.progress(b) - this.track.progress(a);
    });
  }

  onRaceEnd(order) {
    this.phase = 'results';
    const winner = order[0];
    if (winner && this.players.get(winner)) this.players.get(winner).wins++;
    const rows = order.map((id, i) => {
      const p = this.players.get(id);
      if (!p) return '';
      const t = this.results.get(id);
      return `<tr class="${id === this.me.id ? 'me' : ''}"><td>${ord(i + 1)}</td><td><span class="dot" style="background:${esc(p.color)}"></span>${esc(p.name)}${p.bot ? ' <small>BOT</small>' : ''}</td><td>${t != null ? fmtTime(t) : 'DNF'}</td></tr>`;
    });
    const el = document.getElementById('results');
    el.querySelector('tbody').innerHTML = rows.join('');
    el.querySelector('.hint').textContent = this.net.isHost ? 'Press Enter (or the button) to race again' : 'Waiting for the host to start the next race…';
    document.getElementById('startRace').classList.toggle('hidden', !this.net.isHost);
    el.classList.remove('hidden');
    for (const c of this.cars.values()) c.inRace = false;
  }

  sendSnapshot(now) {
    if (this.net.offline || now - this.lastSnap < SNAP_MS) return;
    this.lastSnap = now;
    const snap = (c) => [
      c.id, r2(c.s), r2(c.d), r2(c.v), r3(c.psi), c.flying ? 1 : 0,
      r2(c.wpos.x), r2(c.wpos.y), r2(c.wpos.z), r2(c.wvel.x), r2(c.wvel.y), r2(c.wvel.z),
      c.lap, c.finished || 0, c.boosting || c.padT > 0 ? 1 : 0, c.inRace ? 1 : 0,
      c.route, r2(c.spin), r2(c.flip), c.drifting ? 1 : 0, r2(c.steerVis),
    ];
    const e = [snap(this.me)];
    for (const b of this.bots) e.push(snap(b.car));
    this.net.send({ t: 's', e });
  }

  // ---------------- loop ----------------

  frame(t) {
    if (this.stopped) return;
    requestAnimationFrame((tt) => this.frame(tt));
    const now = performance.now();
    const dt = Math.min(0.05, (t - this.last) / 1000) || 0.016;
    this.last = t;
    this.update(dt, now);
    this.renderer.render(this.scene, this.camera);
  }

  update(dt, now) {
    const me = this.me;
    const all = [...this.cars.values()];
    const racing = this.phase === 'racing';
    const frozen = this.phase === 'countdown';

    if (frozen) {
      const left = Math.ceil((this.goAt - now) / 1000);
      if (left !== this.lastCount && left <= 3 && left > 0) {
        this.lastCount = left;
        this.hud.center(String(left), '', 900);
        this.sfx.play('beep');
      }
      if (now >= this.goAt) {
        this.phase = 'racing';
        this.hud.center('GO!', '', 900);
        this.sfx.play('go');
      }
    }

    // Local car (AI takes over after you finish)
    const canDrive = !frozen && this.phase !== 'spectate';
    if (canDrive) {
      const input = me.finished && racing ? (this.autopilot ||= new RaceBrain()).think(dt, me, this.track, all, this.fr) : this.readInput();
      const prevLap = me.lap;
      const ev = me.step(dt, input, this.track, all, this.fr);
      this.carEvents(me, ev, true);
      if (racing && me.inRace && me.lap > prevLap && !me.finished) {
        if (me.lap > this.laps) {
          const time = now - this.goAt;
          me.finished = time;
          this.net.send({ t: 'fin', id: me.id, time });
          this.onFinish(me.id, time);
        } else if (me.lap > 1) {
          this.hud.center(me.lap === this.laps ? 'FINAL LAP' : `LAP ${me.lap}`, '', 1200);
          this.sfx.play('lap');
        }
      }
    }

    for (const { car, brain } of this.bots) {
      if (frozen) continue;
      const prevLap = car.lap;
      const ev = car.step(dt, brain.think(dt, car, this.track, all, this.fr), this.track, all, this.fr);
      this.carEvents(car, ev, false);
      if (racing && car.inRace && car.lap > prevLap && car.lap > this.laps && !car.finished) {
        const time = now - this.goAt;
        car.finished = time;
        this.net.send({ t: 'fin', id: car.id, time });
        this.onFinish(car.id, time);
      }
    }

    for (const c of all) {
      if (!c.local && !c.bot) c.updateRemote(dt, now, this.track, this.fr);
      const open = this.phase === 'lobby' || this.phase === 'results';
      c.updateVisual(dt, open || c.inRace || (c.local && this.phase !== 'spectate'));
      this.driftFx(c);
    }
    this.sfx.screech(me.drifting && !me.flying ? Math.min(1, 0.5 + me.driftT) : 0);

    // Host ends the race when everyone is done (or after a grace period)
    if (this.net.isHost && racing) {
      const racers = all.filter((c) => c.inRace);
      const done = racers.every((c) => this.results.has(c.id));
      if (racers.length && (done || (this.firstFinish && now - this.firstFinish > FINISH_GRACE_MS))) {
        const order = this.standings().map((c) => c.id);
        const m = { t: 're', order };
        this.net.send(m);
        this.onRaceEnd(order);
      }
    }

    this.track.update(dt);
    if (this.track.smokeAt && Math.random() < dt * 5) {
      _v.copy(this.track.smokeAt).add(_x.set((Math.random() - 0.5) * 8, 0, (Math.random() - 0.5) * 8));
      this.fx.spawn({ color: '#3a3032', pos: _v, vel: _x.set((Math.random() - 0.5) * 3, 6 + Math.random() * 4, (Math.random() - 0.5) * 3), life: 5, size: 5, grow: 4, opacity: 0.5 });
    }
    this.fx.update(dt);
    this.sendSnapshot(now);
    this.updateCamera(dt);
    this.updateHud(now);
    this.sfx.engine(me.v * 0.8, me.boosting, true);
  }

  carEvents(c, ev, isMe) {
    const vol = isMe ? 1 : Math.max(0, 1 - this.camera.position.distanceTo(c.wpos) / 150);
    if (ev.bump > 6) {
      this.sfx.play('bump', vol * Math.min(1, ev.bump / 25));
      for (let i = 0; i < 6; i++) this.fx.spark(c.wpos, '#ffd166');
      if (isMe) this.shake = Math.min(0.6, ev.bump / 40);
    }
    if (ev.pad) this.sfx.play('pickup', vol * 0.7);
    if (ev.launched) this.sfx.play('jump', vol);
    if (ev.landed) {
      this.sfx.play('bump', vol * 0.8);
      if (isMe) this.shake = 0.4;
    }
    if (ev.crashed) {
      this.fx.explosion(c.wpos.clone(), c.color, 1.3);
      this.sfx.play('explode', vol);
      if (isMe) this.hud.center('WIPEOUT!', 'Respawning…', 1300);
    }
    if (!isMe) return;
    if (ev.key) {
      const br = this.track.branches.find((b) => b.lock === ev.key.id);
      this.track.setOwnedKeys(this.me.keys);
      this.hud.center('🔑 KEY!', `${br ? br.name : 'Shortcut'} unlocked`, 1800);
      this.sfx.play('pickup');
    }
    if (ev.locked) this.hud.toast(`🔒 ${ev.locked.name} is locked: find the golden key`);
    if (ev.route) this.hud.toast(`➜ ${ev.route.name}`);
    if (ev.trick) {
      const { spins, flips, count } = ev.trick;
      const name = [spins && `${spins > 1 ? `${spins}x ` : ''}SPIN`, flips && `${flips > 1 ? `${flips}x ` : ''}FLIP`].filter(Boolean).join(' + ');
      this.hud.center(`${name}!`, `+${count > 1 ? 'MEGA ' : ''}BOOST`, 1300);
      this.sfx.play('lap');
    }
    if (ev.sloppy) {
      this.hud.center('SLOPPY LANDING', 'finish your trick before you land', 1300);
      this.sfx.play('hurt', 0.5);
    }
  }

  /** Tire smoke, skid marks and sparks that heat up the longer you hold a drift. */
  driftFx(c) {
    if (!c.drifting || c.flying || !c.root.visible) {
      c.skid = null;
      return;
    }
    const right = _r.crossVectors(c.fwd, c.up).normalize();
    const wheels = [-1, 1].map((side) =>
      new THREE.Vector3().copy(c.wpos).addScaledVector(c.fwd, -1.35).addScaledVector(right, side * 1.05).addScaledVector(c.up, 0.05),
    );
    if (c.skid) for (let w = 0; w < 2; w++) this.skids.add(c.skid[w], wheels[w], right);
    c.skid = wheels;
    for (const w of wheels) if (Math.random() < 0.6) this.fx.puff(w, '#e2e2e2', 0.55);
    const t = c.driftT;
    const col = t < 0.8 ? '#7fdcff' : t < 1.8 ? '#ffb703' : '#ff4fd8';
    const n = t < 0.8 ? 1 : t < 1.8 ? 2 : 4;
    for (let i = 0; i < n; i++) this.fx.spark(wheels[i % 2], col);
  }

  followTarget() {
    if (this.phase !== 'spectate') return this.me;
    return this.standings()[0] || this.me;
  }

  /** Point on the road relative to car c (handles looking back past a fork onto the main road). */
  camPoint(c, ds, d, h, out) {
    const fr = (this.camFr ||= Track.newFrame());
    const br = c.route ? this.track.branches[c.route - 1] : null;
    if (br && c.s + ds < 0) return this.track.toWorld(br.from + c.s + ds, d + br.off, h, out, fr);
    if (br && c.s + ds > br.path.L) return this.track.toWorld(br.to + c.s + ds - br.path.L, d + br.off, h, out, fr);
    return this.track.pathOf(c.route).toWorld(c.s + ds, d, h, out, fr);
  }

  updateCamera(dt) {
    const c = this.followTarget();
    const cam = this.camera;
    const onTrack = !c.flying && c.crashT <= 0;
    const k = 1 - Math.exp(-(onTrack ? 14 : 7) * dt);
    const back = c.v < -2 ? -8.5 : 8.5;
    // Swing wide of the car while it drifts
    this.camSwing = (this.camSwing || 0) + ((c.drifting ? -c.steerVis * 2.6 : 0) - (this.camSwing || 0)) * Math.min(1, dt * 3);
    // On the road, follow the track's own curve so the camera stays inside loops
    if (onTrack) this.camPoint(c, -back, c.d * 0.75 + this.camSwing, 3.3, _v);
    else _v.copy(c.wpos).addScaledVector(c.fwd, -8.5).addScaledVector(c.up, 3.4);
    if (!this.camInit) {
      cam.position.copy(_v);
      this.camInit = true;
    } else cam.position.lerp(_v, k);
    cam.up.lerp(c.up, 1 - Math.exp(-6 * dt)).normalize();
    if (onTrack) this.camPoint(c, back > 0 ? 7 : -7, c.d, 1.5, _v);
    else _v.copy(c.wpos).addScaledVector(c.up, 1.6).addScaledVector(c.fwd, 7);
    cam.lookAt(_v);
    if (this.shake > 0.01) {
      cam.position.x += (Math.random() - 0.5) * this.shake;
      cam.position.y += (Math.random() - 0.5) * this.shake;
      this.shake *= Math.exp(-8 * dt);
    }
    const fov = 68 + Math.min(22, Math.abs(c.v) * 0.25) + (c.boosting || c.padT > 0 ? 8 : 0) + (c.drifting ? 4 : 0);
    if (Math.abs(cam.fov - fov) > 0.1) {
      cam.fov += (fov - cam.fov) * Math.min(1, dt * 4);
      cam.updateProjectionMatrix();
    }
  }

  // ---------------- HUD ----------------

  buildMinimap() {
    const tr = this.track;
    const paths = [tr, ...tr.branches.map((b) => b.path)];
    let minx = 1e9, maxx = -1e9, minz = 1e9, maxz = -1e9;
    for (const p of paths) {
      for (let i = 0; i < p.n; i++) {
        minx = Math.min(minx, p.P[i * 3]);
        maxx = Math.max(maxx, p.P[i * 3]);
        minz = Math.min(minz, p.P[i * 3 + 2]);
        maxz = Math.max(maxz, p.P[i * 3 + 2]);
      }
    }
    const S = 170, pad = 12;
    const scale = (S - pad * 2) / Math.max(maxx - minx, maxz - minz);
    const cx = (minx + maxx) / 2, cz = (minz + maxz) / 2;
    this.mapXY = (x, z) => [S / 2 - (x - cx) * scale, S / 2 - (z - cz) * scale];
    this.drawMapBg();
  }

  drawMapBg() {
    const tr = this.track, S = 170;
    const bg = (this.mapBg ||= document.createElement('canvas'));
    bg.width = bg.height = S;
    const g = bg.getContext('2d');
    g.fillStyle = 'rgba(20,24,32,0.7)';
    g.fillRect(0, 0, S, S);
    g.lineJoin = 'round';
    const line = (p, width, color, dash = []) => {
      g.lineWidth = width;
      g.strokeStyle = color;
      g.setLineDash(dash);
      g.beginPath();
      for (let i = 0; i <= p.n; i += 3) {
        const j = p.closed ? i % p.n : Math.min(i, p.n - 1);
        const [x, y] = this.mapXY(p.P[j * 3], p.P[j * 3 + 2]);
        if (i === 0) g.moveTo(x, y);
        else g.lineTo(x, y);
      }
      if (p.closed) g.closePath();
      g.stroke();
      g.setLineDash([]);
    };
    line(tr, 4, 'rgba(255,255,255,0.75)');
    for (const br of tr.branches) {
      const locked = br.lock && !this.me.keys.has(br.lock);
      line(br.path, 3, locked ? 'rgba(255,208,0,0.8)' : 'rgba(0,229,255,0.85)', locked ? [4, 4] : []);
    }
    for (const k of tr.keys) {
      if (this.me.keys.has(k.id)) continue;
      const i = tr.idx(k.s);
      const [x, y] = this.mapXY(tr.P[i * 3], tr.P[i * 3 + 2]);
      g.font = '12px system-ui';
      g.fillText('🔑', x - 6, y + 4);
    }
    const [sx, sy] = this.mapXY(tr.P[0], tr.P[2]);
    g.fillStyle = '#fff';
    g.fillRect(sx - 4, sy - 4, 8, 8);
    this.mapKeys = this.me.keys.size;
  }

  drawMinimap() {
    if (this.mapKeys !== this.me.keys.size) this.drawMapBg();
    const cv = document.getElementById('minimap');
    const g = cv.getContext('2d');
    g.clearRect(0, 0, cv.width, cv.height);
    g.drawImage(this.mapBg, 0, 0, cv.width, cv.height);
    const sc = cv.width / 170;
    for (const c of this.cars.values()) {
      if (!c.root.visible) continue;
      const [x, y] = this.mapXY(c.wpos.x, c.wpos.z);
      g.fillStyle = c.color;
      g.strokeStyle = c === this.me ? '#fff' : '#000';
      g.lineWidth = c === this.me ? 2.5 : 1;
      g.beginPath();
      g.arc(x * sc, y * sc, c === this.me ? 5.5 : 4, 0, Math.PI * 2);
      g.fill();
      g.stroke();
    }
  }

  updateHud(now) {
    const me = this.me;
    const hud = this.hud;
    hud.tick(now);
    hud.room(this.net.offline ? null : this.code, [...this.players.values()].filter((p) => !p.bot).length);
    const standings = this.standings();
    const finishOrder = [...this.results.entries()].sort((a, b) => a[1] - b[1]).map((e) => e[0]);
    const pos = me.inRace ? standings.indexOf(me) + 1 : finishOrder.indexOf(me.id) + 1;
    const set = (id, v) => hud.set(id, document.getElementById(id), 'text', v);
    set('rPos', pos ? `${pos}` : '–');
    set('rPosOf', `/${standings.length || this.lastField || this.cars.size}`);
    if (standings.length) this.lastField = standings.length;
    set('rLap', `${clamp(me.lap, 1, this.laps)}/${this.laps}`);
    set('rTime', this.phase === 'racing' || this.phase === 'results' ? fmtTime(me.finished || (this.phase === 'racing' ? now - this.goAt : NaN)) : '0:00.00');
    set('speed', `${Math.round(Math.abs(me.v) * 3.2)}`);
    set('rKeys', [...me.keys].map((id) => `🔑 ${this.track.branches.find((b) => b.lock === id)?.name || 'KEY'}`).join('  '));
    hud.set('rb', document.getElementById('boostFill'), 'width', `${Math.round(me.boost * 100)}%`);

    const lobbyMsg = document.getElementById('lobbyMsg');
    let msg = '';
    if (this.phase === 'lobby') {
      msg = this.net.isHost
        ? `Free drive · ${this.net.offline ? '' : 'invite friends, then '}<button id="lobbyStart">Start ${this.laps}-lap race</button> <small>(or Enter)</small>`
        : 'Free drive · waiting for the host to start the race';
    } else if (this.phase === 'spectate') msg = 'Spectating · you will join the next race';
    hud.set('lobby', lobbyMsg, 'html', msg);
    lobbyMsg.classList.toggle('hidden', !msg);

    const list = this.phase === 'lobby' || this.phase === 'spectate' && !standings.length ? [...this.cars.values()] : standings;
    const rows = list.slice(0, 8).map((c, i) => {
      const p = this.players.get(c.id);
      if (!p) return '';
      const fin = this.results.get(c.id);
      return `<div class="row${c === me ? ' me' : ''}"><span>${this.phase === 'lobby' ? '·' : `${i + 1}.`}</span><span class="dot" style="background:${esc(p.color)}"></span><span class="nm">${esc(p.name)}</span><b>${fin != null ? '🏁' : p.wins ? `🏆${p.wins}` : ''}</b></div>`;
    });
    hud.set('board', hud.el.board, 'html', rows.join(''));
    if ((this.mapTick = (this.mapTick || 0) + 1) % 2 === 0) this.drawMinimap();
  }

  onResize() {
    this.camera.aspect = window.innerWidth / window.innerHeight;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(window.innerWidth, window.innerHeight);
  }

  endGame(title, sub) {
    if (this.gameOver) return;
    this.gameOver = true;
    const o = document.getElementById('ended');
    o.querySelector('h2').textContent = title;
    o.querySelector('p').textContent = sub;
    o.classList.remove('hidden');
  }

  exit() {
    this.stopped = true;
    this.net.destroy();
    location.href = location.pathname;
  }
}
