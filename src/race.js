import * as THREE from 'three';
import { Track } from './track.js';
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
const _x = new THREE.Vector3();
const _v = new THREE.Vector3();

// ------------------------------------------------------------------ car

class RaceCar {
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

    this.hasNet = false;
    this.net = null;
    this.netTime = 0;

    const m = buildCar(this.carType, color);
    this.model = m;
    this.root = new THREE.Group();
    this.root.add(m.group);
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
    this.s = track.wrap(s);
    this.d = d;
    this.v = 0;
    this.psi = 0;
    this.flying = false;
    this.crashT = 0;
    this.padT = 0;
    this.boost = 0.6;
    this.syncWorld(track, fr);
  }

  syncWorld(track, fr) {
    track.frame(this.s, fr);
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
      track.frame(this.s, fr);
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

      this.s += this.v * Math.cos(this.psi) * dt;
      this.d += this.v * Math.sin(this.psi) * dt;

      const lim = track.hw - CAR_HALF_W;
      if (Math.abs(this.d) > lim) {
        const hit = Math.abs(this.v * Math.sin(this.psi));
        this.d = Math.sign(this.d) * lim;
        if (Math.sign(this.psi) === Math.sign(this.d)) this.psi *= 0.15;
        this.v -= Math.min(hit * 0.35, Math.max(0, this.v) * 0.3);
        this.v *= 1 - 0.4 * dt;
        ev.bump = hit;
      }

      if (this.s >= track.L) {
        this.s -= track.L;
        this.lap++;
      } else if (this.s < 0) {
        this.s += track.L;
        this.lap--;
      }

      for (const o of others) {
        if (o === this || !o.inRace || o.flying || o.crashT > 0 || !o.root.visible) continue;
        const ds = track.delta(this.s, o.s);
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

      track.frame(this.s, fr);
      if (fr.gap) {
        this.launch(fr);
        ev.launched = true;
      } else {
        this.safeProg = this.lap * track.L + this.s;
        this.wpos.copy(fr.P).addScaledVector(fr.R, this.d);
        this.fwd.copy(fr.T).multiplyScalar(Math.cos(this.psi)).addScaledVector(fr.R, Math.sin(this.psi)).normalize();
        this.up.copy(fr.N);
        this.wvel.copy(this.fwd).multiplyScalar(this.v);
      }
    } else {
      this.flyT += dt;
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
      if (this.flying && (this.wpos.y < 0.8 || this.flyT > 5)) {
        this.flying = false;
        this.crashT = 1.4;
        this.v = 0;
        ev.crashed = true;
      }
    }
    return ev;
  }

  launch(fr) {
    this.flying = true;
    this.flyT = 0;
    this.wpos.copy(fr.P).addScaledVector(fr.R, this.d);
    this.fwd.copy(fr.T).multiplyScalar(Math.cos(this.psi)).addScaledVector(fr.R, Math.sin(this.psi)).normalize();
    this.wvel.copy(this.fwd).multiplyScalar(this.v).addScaledVector(fr.N, 2.5);
    this.up.copy(fr.N);
  }

  tryLand(track, fr, ev) {
    const n = track.n;
    const i0 = track.idx(this.s);
    let best = -1, bestAlong = 0;
    for (let j = 0; j < 160; j++) {
      const i = (i0 + j) % n;
      _v.fromArray(track.P, i * 3);
      _x.fromArray(track.T, i * 3);
      const along = (this.wpos.x - _v.x) * _x.x + (this.wpos.y - _v.y) * _x.y + (this.wpos.z - _v.z) * _x.z;
      if (along < 0) break;
      best = i;
      bestAlong = along;
    }
    if (best < 0) return;
    let s = best * track.ds + bestAlong;
    if (s >= track.L) s -= track.L;
    if (s < this.s - track.L / 2) this.lap++;
    this.s = s;
    if (track.gap[best]) return;
    track.frame(s, fr);
    _v.copy(this.wpos).sub(fr.P);
    const h = _v.dot(fr.N), d = _v.dot(fr.R);
    if (h <= 0.4 && h > -5 && Math.abs(d) < track.hw + 0.5) {
      this.flying = false;
      this.d = clamp(d, -track.hw + CAR_HALF_W, track.hw - CAR_HALF_W);
      this.v = Math.max(0, this.wvel.dot(fr.T));
      this.psi = clamp(Math.atan2(this.wvel.dot(fr.R), this.wvel.dot(fr.T)), -0.6, 0.6);
      ev.landed = true;
    }
  }

  respawn(track, fr) {
    // Fell short of a jump: put the car down just past the landing so it can't get stuck retrying
    for (const g of track.gaps) {
      const into = track.delta(g.start, this.s);
      if (into >= -5 && into <= g.end - g.start + 60) {
        const s = track.wrap(g.end + 14);
        if (s < this.s - track.L / 2) this.lap++;
        this.s = s;
        this.d = 0;
        this.psi = 0;
        this.v = 26;
        this.flying = false;
        this.safeProg = this.lap * track.L + s;
        this.syncWorld(track, fr);
        return;
      }
    }
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
    // [id, s, d, v, psi, flying, x, y, z, vx, vy, vz, lap, finished, boosting, inRace]
    this.net = {
      s: e[1], d: e[2], v: e[3], psi: e[4], flying: !!e[5],
      x: e[6], y: e[7], z: e[8], vx: e[9], vy: e[10], vz: e[11],
    };
    this.lap = e[12];
    this.finished = e[13];
    this.boosting = !!e[14];
    this.inRace = !!e[15];
    this.netTime = now;
    if (!this.hasNet) {
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
    this.v = n.v;
    this.flying = n.flying;
    if (!n.flying) {
      const target = n.s + n.v * Math.cos(n.psi) * age;
      const ds = track.delta(this.s, target);
      this.s = Math.abs(ds) > 30 ? track.wrap(target) : track.wrap(this.s + ds * k);
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
    const b = this.model;
    this.wheelSpin += (this.v * dt) / b.wheelRadius;
    for (const w of b.wheels) w.rotation.x = this.wheelSpin;
    for (const p of b.frontPivots) p.rotation.y = this.steerVis * 0.4;
    b.body.rotation.z = -this.steerVis * Math.min(1, Math.abs(this.v) / 40) * 0.06;
    b.body.rotation.y = this.drifting ? this.steerVis * 0.25 : b.body.rotation.y * 0.8;
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
  }

  think(dt, car, track, cars, fr) {
    const input = { throttle: 1, steer: 0, boost: false, drift: false };
    if (car.flying || car.crashT > 0) return input;
    this.laneT -= dt;
    if (this.laneT <= 0) {
      this.laneT = 3 + Math.random() * 4;
      this.lane = (Math.random() - 0.5) * 5;
    }
    let kMax = 0, kAvg = 0, cnt = 0;
    for (let a = 6; a <= 70; a += 4) {
      track.frame(car.s + a, this.fr);
      kMax = Math.max(kMax, Math.abs(this.fr.k));
      if (a <= 34) {
        kAvg += this.fr.k;
        cnt++;
      }
    }
    kAvg /= cnt;
    const hw = track.hw;
    let target = clamp(kAvg * 280, -hw * 0.5, hw * 0.5) + this.lane;
    for (const o of cars) {
      if (o === car || !o.inRace || o.flying) continue;
      const ds = track.delta(car.s, o.s);
      if (ds > 0 && ds < 16 && Math.abs(o.d - car.d) < 2.8 && car.v > o.v - 3) {
        target = o.d + (o.d > 0 ? -3.6 : 3.6);
      }
    }
    target = clamp(target, -hw + 2, hw - 2);
    track.frame(car.s, fr);
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
  constructor({ net, name, color, car, botCount = 0, sfx, code, map, laps = 3, welcome }) {
    this.net = net;
    this.sfx = sfx;
    this.code = code;
    this.laps = laps;
    this.hud = new Hud();
    document.body.classList.add('mode-race');

    const renderer = (this.renderer = new THREE.WebGLRenderer({ antialias: true }));
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
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
    });
    document.getElementById('leave').addEventListener('click', () => this.exit());
    document.getElementById('startRace').addEventListener('click', () => this.hostStart());
    document.addEventListener('keydown', (e) => {
      if (e.target instanceof HTMLInputElement) return;
      if (['Tab', 'Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.code)) e.preventDefault();
      this.sfx.init();
      this.keys.add(e.code);
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
    if (this.paused) return { throttle: 0, steer: 0, boost: false, drift: false };
    return {
      throttle: (on('KeyW', 'ArrowUp') ? 1 : 0) - (on('KeyS', 'ArrowDown') ? 1 : 0),
      steer: (on('KeyA', 'ArrowLeft') ? 1 : 0) - (on('KeyD', 'ArrowRight') ? 1 : 0),
      boost: on('ShiftLeft', 'ShiftRight'),
      drift: on('Space'),
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
      return b.lap * this.track.L + b.s - (a.lap * this.track.L + a.s);
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
    }

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
    if (c.drifting && Math.random() < 0.7) {
      _v.copy(c.wpos).addScaledVector(c.fwd, -2).addScaledVector(c.up, 0.2);
      this.fx.spark(_v, '#7fdcff');
    }
  }

  followTarget() {
    if (this.phase !== 'spectate') return this.me;
    return this.standings()[0] || this.me;
  }

  updateCamera(dt) {
    const c = this.followTarget();
    const cam = this.camera;
    const onTrack = !c.flying && c.crashT <= 0;
    const k = 1 - Math.exp(-(onTrack ? 14 : 7) * dt);
    const back = c.v < -2 ? -8.5 : 8.5;
    // On the road, follow the track's own curve so the camera stays inside loops
    if (onTrack) this.track.toWorld(c.s - back, c.d * 0.75, 3.3, _v, this.camFr ||= Track.newFrame());
    else _v.copy(c.wpos).addScaledVector(c.fwd, -8.5).addScaledVector(c.up, 3.4);
    if (!this.camInit) {
      cam.position.copy(_v);
      this.camInit = true;
    } else cam.position.lerp(_v, k);
    cam.up.lerp(c.up, 1 - Math.exp(-6 * dt)).normalize();
    if (onTrack) this.track.toWorld(c.s + (back > 0 ? 7 : -7), c.d, 1.5, _v, this.camFr);
    else _v.copy(c.wpos).addScaledVector(c.up, 1.6).addScaledVector(c.fwd, 7);
    cam.lookAt(_v);
    if (this.shake > 0.01) {
      cam.position.x += (Math.random() - 0.5) * this.shake;
      cam.position.y += (Math.random() - 0.5) * this.shake;
      this.shake *= Math.exp(-8 * dt);
    }
    const fov = 68 + Math.min(22, Math.abs(c.v) * 0.25) + (c.boosting || c.padT > 0 ? 8 : 0);
    if (Math.abs(cam.fov - fov) > 0.1) {
      cam.fov += (fov - cam.fov) * Math.min(1, dt * 4);
      cam.updateProjectionMatrix();
    }
  }

  // ---------------- HUD ----------------

  buildMinimap() {
    const tr = this.track;
    let minx = 1e9, maxx = -1e9, minz = 1e9, maxz = -1e9;
    for (let i = 0; i < tr.n; i++) {
      minx = Math.min(minx, tr.P[i * 3]);
      maxx = Math.max(maxx, tr.P[i * 3]);
      minz = Math.min(minz, tr.P[i * 3 + 2]);
      maxz = Math.max(maxz, tr.P[i * 3 + 2]);
    }
    const S = 170, pad = 12;
    const scale = (S - pad * 2) / Math.max(maxx - minx, maxz - minz);
    const cx = (minx + maxx) / 2, cz = (minz + maxz) / 2;
    this.mapXY = (x, z) => [S / 2 - (x - cx) * scale, S / 2 - (z - cz) * scale];
    const bg = document.createElement('canvas');
    bg.width = bg.height = S;
    const g = bg.getContext('2d');
    g.fillStyle = 'rgba(20,24,32,0.7)';
    g.fillRect(0, 0, S, S);
    g.lineWidth = 4;
    g.lineJoin = 'round';
    g.strokeStyle = 'rgba(255,255,255,0.75)';
    g.beginPath();
    for (let i = 0; i <= tr.n; i += 3) {
      const j = i % tr.n;
      const [x, y] = this.mapXY(tr.P[j * 3], tr.P[j * 3 + 2]);
      if (i === 0) g.moveTo(x, y);
      else g.lineTo(x, y);
    }
    g.closePath();
    g.stroke();
    const [sx, sy] = this.mapXY(tr.P[0], tr.P[2]);
    g.fillStyle = '#fff';
    g.fillRect(sx - 4, sy - 4, 8, 8);
    this.mapBg = bg;
  }

  drawMinimap() {
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
