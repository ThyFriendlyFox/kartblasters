import * as THREE from 'three';
import { Track, Path } from './track.js';
import { TRACKS } from './trackdefs.js';
import { buildCar, CARS, CAR_IDS, wallDamage } from './cars.js';
import { Fx, SkidMarks } from './fx.js';
import { BOT_NAMES, botColor } from './bots.js';
import { musicFor } from './music.js';
import { unlock, earnedHTML } from './achievements.js';
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

const DRAFT_RANGE = 24; // how far behind a car its slipstream reaches
const DRAFT_TOP = 0.1; // top speed gain at full draft

const _m = new THREE.Matrix4();
const _r = new THREE.Vector3();

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
    this.maxHp = this.stats.hp; // only matters with the Wall damage option
    this.hp = this.maxHp;
    this.draftT = 0; // time spent in another car's slipstream
    this.drafting = false;

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

  /** The car whose slipstream we're in (close behind it, lined up, both at speed), if any. */
  slipstream(path, others) {
    if (this.v < 28) return null;
    for (const o of others) {
      if (o === this || o.route !== this.route || o.flying || o.crashT > 0 || o.v < 20 || !o.root.visible) continue;
      const gap = path.delta(this.s, o.s);
      if (gap < 2.5 || gap > DRAFT_RANGE) continue;
      // The pocket of still air is narrow up close and widens a little behind
      if (Math.abs(o.d - this.d) < 1.6 + gap * 0.05) return o;
    }
    return null;
  }

  yawMax(spd) {
    return Math.min(2.2, (GRIPC * this.stats.grip) / Math.max(spd, 1)) * this.stats.handling * (this.drifting ? 1.6 : 1) * Math.min(1, spd / 5);
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
    if (this.boosting && !this.endless) this.boost = Math.max(0, this.boost - dt * 0.4);
    else this.boost = Math.min(1, this.boost + dt * (this.drifting ? 0.3 : 0.05));

    if (!this.flying) {
      let path = track.pathOf(this.route);
      path.frame(this.s, fr);
      // Drafting: tuck in close behind a car ahead and its slipstream pulls
      // you along (more top speed, quicker acceleration, a trickle of nitro)
      const tow = this.slipstream(path, others);
      this.draftT = tow ? Math.min(1.2, this.draftT + dt) : Math.max(0, this.draftT - dt * 2.5);
      const draft = clamp((this.draftT - 0.25) / 0.6, 0, 1);
      this.drafting = draft > 0;
      if (draft > 0 && !this.boosting) this.boost = Math.min(1, this.boost + dt * 0.12 * draft);
      if (fr.boost) {
        if (this.padT <= 0) ev.pad = true;
        this.padT = 1.3;
      }
      this.padT -= dt;
      const padded = this.padT > 0;
      const top = BASE_TOP * st.speed * this.topMul * (this.boosting ? 1 + 0.3 * st.boost : 1) * (padded ? 1.3 : 1) * (1 + DRAFT_TOP * draft);

      if (input.throttle > 0) {
        if (this.v < top) this.v += 30 * st.accel * (1 - 0.5 * Math.max(0, this.v) / top) * input.throttle * dt * (this.boosting ? 1 + st.boost : padded ? 2 : 1) * (1 + 0.6 * draft);
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

      const lim = path.hw - CAR_HALF_W * (this.sizeMul || 1);
      let lo = -lim, hi = lim, merging = false;
      if (this.route === 0) {
        // Inside a Y the road is wider: the branch-side lane is drivable too
        // (the zone we were in at the start of this step counts, so crossing the
        // point of the Y doesn't clamp us back before the lane choice is made)
        const z = track.zoneAt(this.s) || track.zoneAt(prevS);
        if (z) {
          const open = !z.br.lock || this.keys.has(z.br.lock);
          if (open) {
            if (z.off > 0) hi = z.off + lim;
            else lo = z.off - lim;
            merging = z.kind === 'join';
          } else if (z.kind === 'fork' && Math.sign(this.d) === z.br.side && Math.abs(this.d) > lim - 0.3) {
            ev.locked = z.br;
          }
        }
      }
      if (this.d > hi || this.d < lo) {
        const edge = this.d > hi ? hi : lo;
        if (merging && Math.abs(this.d) > lim) {
          // Lanes merging: ease the car in rather than slamming it into a wall
          this.d += clamp(edge - this.d, -16 * dt, 16 * dt);
          if (Math.sign(this.psi) === Math.sign(this.d)) this.psi *= Math.exp(-4 * dt);
        } else {
          const hit = Math.abs(this.v * Math.sin(this.psi));
          this.d = edge;
          if (Math.sign(this.psi) === Math.sign(edge)) this.psi *= 0.15;
          this.v -= Math.min(hit * 0.35, Math.max(0, this.v) * 0.3);
          this.v *= 1 - 0.4 * dt;
          ev.bump = hit;
        }
      }

      if (this.route === 0) {
        if (this.s >= track.L) {
          this.s -= track.L;
          this.lap++;
        } else if (this.s < 0) {
          this.s += track.L;
          this.lap--;
        }
        for (const br of track.branches) {
          const f = br.fork, j = br.join;
          // At the point of the Y, whichever lane you're in decides your route
          if (prevS < f.gs && this.s >= f.gs && (this.d - f.off / 2) * Math.sign(f.off) > 0 && (!br.lock || this.keys.has(br.lock))) {
            this.route = br.id;
            this.s = f.bs + (this.s - f.gs);
            this.d -= f.off;
            this.psi -= f.dpsi;
            ev.route = br;
            break;
          }
          // Reversing back up into a route from the merge
          if (prevS > j.gs && this.s <= j.gs && (this.d - j.off / 2) * Math.sign(j.off) > 0) {
            this.route = br.id;
            this.s = j.bs - (j.gs - this.s);
            this.d -= j.off;
            this.psi -= j.dpsi;
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
        if (this.s >= br.join.bs) {
          // Past the inverse Y: back on the main road, in the lane we came in on
          this.route = 0;
          this.s = br.join.gs + (this.s - br.join.bs);
          this.d += br.join.off;
          this.psi += br.join.dpsi;
          ev.merged = br;
        } else if (this.s < br.fork.bs) {
          this.route = 0;
          this.s = br.fork.gs - (br.fork.bs - this.s);
          this.d += br.fork.off;
          this.psi += br.fork.dpsi;
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
      // Air guidance: ease the car back over the track so a long jump into a
      // curve still comes down on the road instead of beside it
      if (this.flyT > 0.1) {
        const path = track.pathOf(this.route);
        path.frame(this.s, fr);
        _v.copy(this.wpos).sub(fr.P);
        const off = _v.dot(fr.R), side = this.wvel.dot(fr.R);
        const push = clamp(-off * 1.2 - side * 1.4, -14, 14) * dt;
        this.wvel.x += fr.R.x * push;
        this.wvel.z += fr.R.z * push;
      }
      this.wpos.addScaledVector(this.wvel, dt);
      _v.copy(this.wvel).normalize();
      this.fwd.lerp(_v, Math.min(1, dt * 3)).normalize();
      this.up.lerp(_x.set(0, 1, 0), Math.min(1, dt * 3)).normalize();
      this.tryLand(track, fr, ev);
      if (ev.landed) {
        ev.air = this.flyT;
        this.scoreTricks(ev);
      }
      if (this.flying && (this.wpos.y < track.groundY(this.wpos.x, this.wpos.z) + 0.8 || this.flyT > 5)) {
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
    this.hp = this.maxHp; // back on track fully repaired
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
    if (e[21] != null) this.hp = e[21];
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

export class RaceBrain {
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
    // A jump coming up: carry the right speed into it (slow-accelerating cars use nitro)
    let jumpAhead = false;
    for (let a = 10; a <= 110 && !jumpAhead; a += 5) {
      path.frame(car.s + a, this.fr);
      jumpAhead = !!this.fr.gap;
    }
    const hw = path.hw;
    let target = clamp(kAvg * 280, -hw * 0.5, hw * 0.5) + this.lane;
    let wantCap = 0.35;
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
        const ahead = track.delta(car.s, br.fork.gs);
        if (ahead < 0 || ahead > 100) continue;
        if (!this.routeRoll.has(br.id) || this.routeRoll.get(br.id).lap !== car.lap) {
          this.routeRoll.set(br.id, { lap: car.lap, take: br.lock ? true : Math.random() < 0.5 });
        }
        const take = this.routeRoll.get(br.id).take && (!br.lock || car.keys.has(br.lock));
        // In the Y itself, follow the chosen lane's centerline
        // In the Y itself, aim where the chosen lane will be a little way ahead
        const z = track.zoneAt(car.s);
        const inFork = z && z.br === br && z.kind === 'fork';
        const zAhead = track.zoneAt(car.s + 18);
        const lead = zAhead && zAhead.br === br && zAhead.kind === 'fork' ? zAhead.off : inFork ? br.fork.off : br.side * hw * 0.6;
        target = take ? lead : -br.side * 2.5;
        if (take) {
          // Brake for the route's own bends, not just the main road's
          for (let a2 = 0; a2 <= 60; a2 += 6) {
            br.path.frame(Math.max(0, car.s - br.from + a2), this.fr);
            kMax = Math.max(kMax, Math.abs(this.fr.k));
          }
        }
        if (take && (inFork || zAhead?.br === br)) wantCap = 0.65;
      }
    }
    const zz = car.route === 0 ? track.zoneAt(car.s) : null;
    const lo = -hw + 2 + (zz && zz.off < 0 ? zz.off : 0), hi = hw - 2 + (zz && zz.off > 0 ? zz.off : 0);
    target = clamp(target, lo, hi);
    path.frame(car.s, fr);
    const want = clamp((target - car.d) * 0.1, -wantCap, wantCap);
    const vmax = Math.sqrt((GRIPC * car.stats.grip * car.stats.handling) / Math.max(kMax, 1e-4));
    input.drift = car.v > vmax * 1.02 && car.v > 25;
    car.drifting = input.drift && car.v > 18;
    const ym = car.yawMax(Math.abs(car.v));
    input.steer = clamp(-((want - car.psi) * 4 + fr.k * car.v) / Math.max(ym, 0.05), -1, 1);
    // (Never lift for a bend beyond a jump: the jump needs the speed)
    if (!jumpAhead && car.v > vmax * 1.6) input.throttle = -1;
    else if (!jumpAhead && car.v > vmax * 1.35) input.throttle = 0;
    // Jumps are built for about 50-65: nitro if too slow to clear one, ease off if flying in far too fast
    input.boost = jumpAhead ? car.v < 52 && car.boost > 0.05 : kMax < 0.012 && car.boost > 0.35;
    if (jumpAhead && car.v > 68) input.throttle = 0;
    return input;
  }
}

// ------------------------------------------------------------------ game

export class RaceGame {
  constructor({ net, name, color, car, botCount = 0, sfx, code, map, laps = 3, welcome, mobile = null, mods = {}, gp = null }) {
    this.mobile = mobile;
    this.mods = { size: 1, endless: false, damage: false, ...(welcome?.mods || mods) };
    document.body.classList.toggle('dmg-on', !!this.mods.damage);
    // Grand Prix: a list of tracks raced back to back, with points per race
    this.gp = welcome?.gp || (gp ? { maps: gp, index: 0, points: {} } : null);
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
    this.sfx.setCar(this.me.carType);
    this.playMapMusic();
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
      c.root.scale.setScalar(this.mods.size);
      c.sizeMul = this.mods.size;
      c.endless = this.mods.endless;
      this.cars.set(id, c);
    }
    return c;
  }

  addBot(i) {
    const id = `bot-${i}`;
    const palette = COLORS.filter((c) => c !== this.me.color);
    const c = this.addCar(id, BOT_NAMES[i % BOT_NAMES.length], botColor(i, palette), CAR_IDS[Math.floor(Math.random() * CAR_IDS.length)], { bot: true });
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

  /** Starting grid: two abreast, or three abreast for big fields so the grid stays short. */
  gridSlot(k) {
    if (this.cars.size <= 8) return { s: -10 - Math.floor(k / 2) * 8, d: k % 2 ? 3.2 : -3.2 };
    const w = this.track.hw - 2;
    return { s: -10 - Math.floor(k / 3) * 8, d: [-w, 0, w][k % 3] };
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
      overlay.querySelector('p').textContent = 'In the air, tap left/right of the screen to spin or DRIFT to flip. If tilt steering is on, tap Play while holding the phone how you like to drive.';
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
      mods: this.mods,
      gp: this.gp,
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
      case 'gpNext':
        if (host) return;
        this.gp = m.gp;
        this.loadMap(m.map);
        break;
    }
  }

  hostStart() {
    if (!this.net.isHost || !(this.phase === 'lobby' || this.phase === 'results')) return;
    if (this.gp && this.phase === 'results') {
      // On to the next Grand Prix race (or a fresh Grand Prix after the last one)
      const gp = this.gp;
      if (gp.index + 1 >= gp.maps.length) {
        gp.index = 0;
        gp.points = {};
      } else gp.index++;
      const map = gp.maps[gp.index];
      this.net.send({ t: 'gpNext', map, gp });
      this.loadMap(map);
      // Give everyone a moment to build the new track, then line up
      clearTimeout(this.gpTimer);
      this.gpTimer = setTimeout(() => this.phase === 'lobby' && this.hostStart(), 1500);
      return;
    }
    clearTimeout(this.gpTimer);
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
      if (place <= 3) unlock('podium', this.sfx);
      if (place === 1) unlock('winner', this.sfx);
      if (place === 1 && !this.ach?.raceWall) unlock('flawless', this.sfx);
      if (this.laps >= 20) unlock('marathon', this.sfx);
    }
    // Photo finish: you and another car within 0.3 s
    const mine = this.results.get(this.me.id);
    if (mine != null && [...this.results].some(([other, t]) => other !== this.me.id && Math.abs(t - mine) < 300)) unlock('photo', this.sfx);
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

  /**
   * Swap to another track in place (Grand Prix): new scene and track, the
   * same cars, players and connection.
   */
  loadMap(mapId) {
    const old = this.scene;
    const scene = new THREE.Scene();
    for (const c of this.cars.values()) {
      scene.add(c.root);
      c.scene = scene;
    }
    old.traverse((o) => {
      o.geometry?.dispose();
      for (const m of [o.material].flat()) {
        if (!m) continue;
        m.map?.dispose();
        m.dispose();
      }
    });
    this.scene = scene;
    this.mapId = mapId;
    this.track = new Track(mapId);
    this.track.build(scene);
    this.fx = new Fx(scene);
    this.skids = new SkidMarks(scene);
    this.buildMinimap();
    this.camInit = false;
    for (const c of this.cars.values()) {
      c.route = 0;
      c.keys.clear();
      c.lap = 0;
      c.finished = 0;
      c.inRace = false;
      c.skid = null;
    }
    for (const b of this.bots) b.brain = new RaceBrain();
    this.autopilot = null;
    this.results.clear();
    this.firstFinish = 0;
    this.phase = 'lobby';
    document.getElementById('results').classList.add('hidden');
    this.lobbyPlace();
    this.playMapMusic();
    this.hud.center(`RACE ${this.gp.index + 1} OF ${this.gp.maps.length}`, TRACKS[mapId].name, 2500);
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
    el.querySelector('h2').textContent = '🏁 Race results';
    el.querySelector('.gpWrap').innerHTML = this.gp ? this.gpResults(order) : '';
    el.querySelector('.achWrap').innerHTML = earnedHTML();
    const last = this.gp && this.gp.index + 1 >= this.gp.maps.length;
    el.querySelector('#startRace').textContent = !this.gp ? 'Race again' : last ? '🏆 New Grand Prix' : `Next race ▶ ${TRACKS[this.gp.maps[this.gp.index + 1]].name}`;
    el.querySelector('.hint').textContent = this.net.isHost
      ? `Press Enter (or the button) to ${!this.gp ? 'race again' : last ? 'start a new Grand Prix' : 'go to the next race'}`
      : 'Waiting for the host to start the next race…';
    document.getElementById('startRace').classList.toggle('hidden', !this.net.isHost);
    el.classList.remove('hidden');
    for (const c of this.cars.values()) c.inRace = false;
  }

  /** Award Grand Prix points for a race and render the championship table. */
  gpResults(order) {
    const gp = this.gp;
    const PTS = [15, 12, 10, 8, 7, 6, 5, 4, 3, 2, 1];
    if (gp.scored !== gp.index) {
      gp.scored = gp.index;
      order.forEach((id, i) => (gp.points[id] = (gp.points[id] || 0) + (PTS[i] || 0)));
    }
    const table = Object.entries(gp.points)
      .filter(([id]) => this.players.get(id))
      .sort((a, b) => b[1] - a[1] || order.indexOf(a[0]) - order.indexOf(b[0])); // ties: last race decides
    const last = gp.index + 1 >= gp.maps.length;
    const el = document.getElementById('results');
    el.querySelector('h2').textContent = last ? '🏆 Grand Prix final standings' : `🏆 Grand Prix · race ${gp.index + 1} of ${gp.maps.length}`;
    if (last) {
      unlock('gpDone', this.sfx);
      if (table[0]?.[0] === this.me.id) unlock('gpChamp', this.sfx);
      const champ = this.players.get(table[0]?.[0]);
      if (champ) this.hud.center(`${champ.name.toUpperCase()} WINS THE GRAND PRIX!`, '', 5000);
    }
    const rows = table.map(([id, pts], i) => {
      const p = this.players.get(id);
      const got = PTS[order.indexOf(id)] || 0;
      return `<tr class="${id === this.me.id ? 'me' : ''}"><td>${i === 0 && last ? '👑' : ord(i + 1)}</td><td><span class="dot" style="background:${esc(p.color)}"></span>${esc(p.name)}</td><td><b>${pts}</b> <small>+${got}</small></td></tr>`;
    });
    const up = last ? '' : `<p class="hintsm">Next: ${gp.maps.slice(gp.index + 1).map((m) => TRACKS[m].name).join(' → ')}</p>`;
    return `<h3>Championship</h3><table class="gpTable"><tbody>${rows.join('')}</tbody></table>${up}`;
  }

  sendSnapshot(now) {
    if (this.net.offline || now - this.lastSnap < SNAP_MS) return;
    this.lastSnap = now;
    const snap = (c) => [
      c.id, r2(c.s), r2(c.d), r2(c.v), r3(c.psi), c.flying ? 1 : 0,
      r2(c.wpos.x), r2(c.wpos.y), r2(c.wpos.z), r2(c.wvel.x), r2(c.wvel.y), r2(c.wvel.z),
      c.lap, c.finished || 0, c.boosting || c.padT > 0 ? 1 : 0, c.inRace ? 1 : 0,
      c.route, r2(c.spin), r2(c.flip), c.drifting ? 1 : 0, r2(c.steerVis), Math.round(c.hp),
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
      this.lastThrottle = input.throttle;
      const prevLap = me.lap;
      const ev = me.step(dt, input, this.track, all, this.fr);
      this.carEvents(me, ev, true);
      this.achieve(dt, ev, racing && me.inRace && !me.finished, me.lap > prevLap && prevLap >= 1);
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
      this.draftFx(c);
      this.damageFx(c);
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
    this.track.followShadow(this.me.wpos);
    if (this.track.smokeAt && Math.random() < dt * 5) {
      _v.copy(this.track.smokeAt).add(_x.set((Math.random() - 0.5) * 8, 0, (Math.random() - 0.5) * 8));
      this.fx.spawn({ color: '#3a3032', pos: _v, vel: _x.set((Math.random() - 0.5) * 3, 6 + Math.random() * 4, (Math.random() - 0.5) * 3), life: 5, size: 5, grow: 4, opacity: 0.5 });
    }
    this.fx.update(dt);
    this.sendSnapshot(now);
    this.updateCamera(dt);
    this.updateHud(now);
    this.sfx.engine(dt, me.v / (BASE_TOP * me.stats.speed), this.lastThrottle || 0, me.boosting || me.padT > 0, !me.crashT);
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
    // Wall damage option: the harder the hit, the bigger the dent
    if (this.mods.damage && ev.bump > 0 && c.crashT <= 0 && (isMe || c.bot)) {
      const dmg = wallDamage(ev.bump);
      if (dmg > 0) {
        c.hp -= dmg;
        if (isMe && dmg > 8) this.hud.damage?.(dmg);
        if (c.hp <= 0) {
          // Wrecked: blow up and respawn repaired, like a missed jump
          c.hp = 0;
          c.crashT = 1.6;
          c.v = 0;
          c.resetTricks();
          this.fx.explosion(c.wpos.clone(), c.color, 1.5);
          this.sfx.play('explode', vol);
          if (isMe) {
            this.hud.center('WRECKED!', 'Too many wall hits · respawning…', 1600);
            unlock('demolition', this.sfx);
          }
        }
      }
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

  /** Watch the local car for achievements (see achievements.js). */
  achieve(dt, ev, racing, lapDone) {
    const me = this.me, a = (this.ach ||= { phase: '', t: {} });
    const hold = (key, on, secs, id) => {
      a.t[key] = on ? (a.t[key] || 0) + dt : 0;
      if (a.t[key] >= secs) unlock(id, this.sfx);
    };
    const pos = this.standings().indexOf(me) + 1;
    if (this.phase !== a.phase) {
      a.phase = this.phase;
      if (this.phase === 'racing') {
        // Fresh race: reset the wall and overtake trackers
        a.wall = a.raceWall = false;
        a.lapPos = 0;
        if (this.bots.length >= 20 && me.inRace) unlock('crowd', this.sfx);
        if (this.mods.size > 1.5) unlock('kaiju', this.sfx);
        if (this.mods.size < 0.8) unlock('pocket', this.sfx);
      }
    }
    if (ev.bump > 4) a.wall = a.raceWall = true;
    if (racing) {
      if (!a.lapPos) a.lapPos = pos;
      if (lapDone) {
        if (!a.wall) unlock('cleanLap', this.sfx);
        if (a.lapPos - pos >= 3) unlock('overtaker', this.sfx);
        a.wall = false;
        a.lapPos = pos;
      }
    }
    if (ev.trick) {
      unlock('stunt', this.sfx);
      if (ev.trick.count >= 3) unlock('showboat', this.sfx);
    }
    if (ev.landed && ev.air >= 1.5) unlock('flyer', this.sfx);
    if (ev.route) unlock('detour', this.sfx);
    if (ev.key) unlock('locksmith', this.sfx);
    if (ev.crashed) unlock('wipeout', this.sfx);
    if (me.driftT >= 3) unlock('driftKing', this.sfx);
    hold('draft', me.drafting, 3, 'slipstream');
    hold('ceiling', !me.flying && me.crashT <= 0 && me.up.y < -0.8, 1, 'ceiling');
    hold('back', me.v < -8, 2, 'wrongWay');
    if (Math.abs(me.v) * 3.2 >= 230) unlock('warp', this.sfx);
    // A whole tank of nitro in one burn
    if (me.boosting && !a.burning && me.boost >= 0.95) a.burning = true;
    if (!me.boosting) a.burning = false;
    if (a.burning && me.boost <= 0.03) unlock('fullSend', this.sfx);
  }

  /** Wall damage option: dark smoke from a battered car, flames when it's nearly done. */
  damageFx(c) {
    if (!this.mods.damage || !c.root.visible || c.crashT > 0) return;
    const f = c.hp / c.maxHp;
    if (f > 0.5 || Math.random() > (f < 0.25 ? 0.7 : 0.35)) return;
    const p = new THREE.Vector3().copy(c.wpos).addScaledVector(c.up, 1.1 * this.mods.size).addScaledVector(c.fwd, 0.8 * this.mods.size);
    this.fx.puff(p, f < 0.25 ? '#2a2a2a' : '#6b6b6b', 0.5 * this.mods.size);
    if (f < 0.25) this.fx.spark(p, Math.random() < 0.5 ? '#ff7b1c' : '#ffd166');
  }

  /** Wind lines streaming past a car that's drafting. */
  draftFx(c) {
    if (!c.drafting || c.flying || !c.root.visible || Math.random() > 0.7) return;
    const right = _r.crossVectors(c.fwd, c.up).normalize();
    const side = Math.random() < 0.5 ? -1 : 1;
    const p = new THREE.Vector3().copy(c.wpos).addScaledVector(c.fwd, 1 + Math.random() * 3).addScaledVector(right, side * (1.2 + Math.random() * 0.8)).addScaledVector(c.up, 0.4 + Math.random() * 1.4);
    this.fx.streak(p, c.fwd, new THREE.Vector3().copy(c.fwd).multiplyScalar(c.v * 0.55));
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
    if (br && c.s + ds < br.fork.bs) return this.track.toWorld(br.fork.gs + c.s + ds - br.fork.bs, d + br.fork.off, h, out, fr);
    if (br && c.s + ds > br.join.bs) return this.track.toWorld(br.join.gs + c.s + ds - br.join.bs, d + br.join.off, h, out, fr);
    return this.track.pathOf(c.route).toWorld(c.s + ds, d, h, out, fr);
  }

  updateCamera(dt) {
    const c = this.followTarget();
    const cam = this.camera;
    const onTrack = !c.flying && c.crashT <= 0;
    const k = 1 - Math.exp(-(onTrack ? 14 : 7) * dt);
    // Pull the camera back for giant cars (and in a little for tiny ones)
    const zoom = this.mods.size < 1 ? 0.8 : 1 + (this.mods.size - 1) * 0.55;
    const back = (c.v < -2 ? -8.5 : 8.5) * zoom;
    // Swing wide of the car while it drifts
    this.camSwing = (this.camSwing || 0) + ((c.drifting ? -c.steerVis * 2.6 : 0) - (this.camSwing || 0)) * Math.min(1, dt * 3);
    // On the road, follow the track's own curve so the camera stays inside loops
    if (onTrack) this.camPoint(c, -back, c.d * 0.75 + this.camSwing, 3.3 * zoom, _v);
    else _v.copy(c.wpos).addScaledVector(c.fwd, -8.5 * zoom).addScaledVector(c.up, 3.4 * zoom);
    if (!this.camInit) {
      cam.position.copy(_v);
      this.camInit = true;
    } else cam.position.lerp(_v, k);
    cam.up.lerp(c.up, 1 - Math.exp(-6 * dt)).normalize();
    if (onTrack) this.camPoint(c, back > 0 ? 7 : -7, c.d, 1.5 * zoom, _v);
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
    document.getElementById('draft').classList.toggle('on', !!me.drafting && !me.flying && this.phase !== 'spectate');
    set('rKeys', [...me.keys].map((id) => `🔑 ${this.track.branches.find((b) => b.lock === id)?.name || 'KEY'}`).join('  '));
    hud.set('rb', document.getElementById('boostFill'), 'width', `${Math.round(me.boost * 100)}%`);
    if (this.mods.damage) {
      const f = Math.max(0, me.hp) / me.maxHp;
      hud.set('hpw', hud.el.hpFill, 'width', `${Math.round(f * 100)}%`);
      hud.set('hpt', hud.el.hpText, 'text', `${Math.max(0, Math.round(me.hp))}`);
      hud.el.hpFill.style.background = f > 0.5 ? '#4ade80' : f > 0.25 ? '#facc15' : '#ef4444';
    }

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
    // Big fields: the top 7, plus you if you're further back
    const shown = list.slice(0, 8);
    if (list.length > 8 && !shown.includes(me) && list.includes(me)) shown.splice(7, 1, me);
    const rows = shown.map((c) => {
      const i = list.indexOf(c);
      const p = this.players.get(c.id);
      if (!p) return '';
      const fin = this.results.get(c.id);
      return `<div class="row${c === me ? ' me' : ''}"><span>${this.phase === 'lobby' ? '·' : `${i + 1}.`}</span><span class="dot" style="background:${esc(p.color)}"></span><span class="nm">${esc(p.name)}</span><b>${fin != null ? '🏁' : p.wins ? `🏆${p.wins}` : ''}</b></div>`;
    });
    hud.set('board', hud.el.board, 'html', rows.join(''));
    if ((this.mapTick = (this.mapTick || 0) + 1) % 2 === 0) this.drawMinimap();
  }

  /** A new random soundtrack for this map (Neon Junction keeps its own tune). */
  playMapMusic() {
    const song = musicFor(this.mapId);
    this.sfx.playMusic(song);
    if (song.label) this.hud.toast(`🎵 ${song.label}`);
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
