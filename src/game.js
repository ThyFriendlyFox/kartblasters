import * as THREE from 'three';
import { buildArena, pointBlocked } from './arena.js';
import { Kart } from './kart.js';
import { CARS, CAR_IDS, wallDamage, carThumbnail, statBarsHTML } from './cars.js';
import { Fx, SkidMarks } from './fx.js';
import { BotBrain, BOT_NAMES, botColor } from './bots.js';
import { musicFor } from './music.js';
import { unlock } from './achievements.js';
import { Hud } from './hud.js';
import { WEAPONS, SLOTS, MAX_AMMO_MULT, projectileMesh, botPreference } from './weapons.js';

export const COLORS = ['#ff3b3b', '#ff9f1c', '#ffe03b', '#3bff6f', '#2ec4ff', '#6a5cff', '#ff4fd8', '#f5f5f5'];

const BURN_DPS = 9;
const HIT_R = 1.9;
const RESPAWN_MS = 3000;
const ITEM_RESPAWN_MS = 15000;
const SNAP_MS = 50;
const SENS = 0.0024;

const r2 = (n) => Math.round(n * 100) / 100;
const r3 = (n) => Math.round(n * 1000) / 1000;
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

const _a = new THREE.Vector3();
const _b = new THREE.Vector3();
const _dir = new THREE.Vector3();
const Z = new THREE.Vector3(0, 0, 1);

export class Game {
  constructor({ net, name, color, car, botCount, sfx, code, welcome, map = 'stadium', destructible = false, mobile = null, mods = {} }) {
    this.mobile = mobile;
    this.mods = { size: 1, endless: false, damage: false, ...(welcome?.mods || mods) };
    document.body.classList.add('mode-battle');
    this.net = net;
    this.sfx = sfx;
    this.code = code;
    this.hud = new Hud();

    const renderer = (this.renderer = new THREE.WebGLRenderer({ antialias: true }));
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, mobile ? 1.5 : 2));
    renderer.setSize(window.innerWidth, window.innerHeight);
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFShadowMap;
    document.getElementById('game').appendChild(renderer.domElement);
    this.canvas = renderer.domElement;

    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(72, window.innerWidth / window.innerHeight, 0.1, 600);
    this.mapId = welcome?.map || map;
    this.destructible = welcome ? !!welcome.destructible : !!destructible;
    this.world = buildArena(this.scene, { map: this.mapId, destructible: this.destructible });
    this.digs = []; // crater history, replayed for players who join later
    this.blockHits = new Map();
    this.fx = new Fx(this.scene);
    this.skids = new SkidMarks(this.scene);

    this.karts = new Map();
    this.players = new Map();
    this.bots = [];
    this.projectiles = [];
    this.exploded = new Set();
    this.items = new Map();
    this.pid = 0;
    this.keys = new Set();
    this.mouse = { left: false, right: false };
    this.locked = false;
    this.shake = 0;
    this.lastSnap = 0;
    this.joined = net.isHost;
    this.gameOver = false;

    this.me = this.makeKart({ id: net.myId, name, color, car, local: true });
    this.karts.set(net.myId, this.me);
    this.players.set(net.myId, { name, color, car, kills: 0, deaths: 0, bot: false });

    this.buildItems();
    this.bindInput();
    this.bindNet();

    if (net.isHost) {
      for (let i = 0; i < botCount; i++) this.addBot(i);
      this.spawnKart(this.me);
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

  // ---------- setup ----------

  buildItems() {
    const mk = {
      rocket: () => {
        const g = new THREE.Group();
        const body = new THREE.Mesh(new THREE.CylinderGeometry(0.35, 0.35, 1.6, 12), new THREE.MeshStandardMaterial({ color: '#dddddd', metalness: 0.5 }));
        const nose = new THREE.Mesh(new THREE.ConeGeometry(0.35, 0.7, 12), new THREE.MeshBasicMaterial({ color: '#ff3b3b' }));
        nose.position.y = 1.15;
        body.add(nose);
        body.rotation.z = 0.5;
        g.add(body);
        return g;
      },
      health: () => {
        const g = new THREE.Group();
        const m = new THREE.MeshBasicMaterial({ color: '#4ade80' });
        g.add(new THREE.Mesh(new THREE.BoxGeometry(1.8, 0.6, 0.6), m));
        g.add(new THREE.Mesh(new THREE.BoxGeometry(0.6, 1.8, 0.6), m));
        return g;
      },
      boost: () => {
        const g = new THREE.Group();
        const m = new THREE.MeshBasicMaterial({ color: '#facc15' });
        const a = new THREE.Mesh(new THREE.ConeGeometry(0.6, 1.1, 4), m);
        const b = a.clone();
        a.position.y = 0.35;
        b.position.y = -0.35;
        g.add(a, b);
        return g;
      },
    };
    mk.weapon = (it) => {
      const w = WEAPONS[it.w];
      const g = new THREE.Group();
      const box = new THREE.Mesh(new THREE.BoxGeometry(1.5, 1.1, 1.5), new THREE.MeshStandardMaterial({ color: '#2a2f3a', metalness: 0.5, roughness: 0.4 }));
      box.add(new THREE.LineSegments(new THREE.EdgesGeometry(box.geometry), new THREE.LineBasicMaterial({ color: w.color })));
      const core = new THREE.Mesh(new THREE.SphereGeometry(0.45, 12, 10), new THREE.MeshBasicMaterial({ color: w.color }));
      core.position.y = 0.9;
      g.add(box, core);
      const c = document.createElement('canvas');
      c.width = 256;
      c.height = 56;
      const x = c.getContext('2d');
      x.font = 'bold 30px system-ui, sans-serif';
      x.textAlign = 'center';
      x.lineWidth = 6;
      x.strokeStyle = 'rgba(0,0,0,0.8)';
      const label = `[${w.slot}] ${w.name.toUpperCase()}`;
      x.strokeText(label, 128, 38);
      x.fillStyle = w.color;
      x.fillText(label, 128, 38);
      const tex = new THREE.CanvasTexture(c);
      tex.colorSpace = THREE.SRGBColorSpace;
      const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, depthTest: false, transparent: true }));
      sp.scale.set(5, 1.1, 1);
      sp.position.y = 2.2;
      g.add(sp);
      return g;
    };
    const ringColors = { rocket: '#ff3b3b', health: '#4ade80', boost: '#facc15' };
    for (const it of this.world.items) {
      const g = mk[it.type](it);
      if (it.type === 'weapon') ringColors.weapon = WEAPONS[it.w].color;
      g.position.set(it.x, 1.6, it.z);
      this.scene.add(g);
      const ring = new THREE.Mesh(
        new THREE.RingGeometry(1.6, 2, 32),
        new THREE.MeshBasicMaterial({ color: ringColors[it.type], transparent: true, opacity: 0.6, side: THREE.DoubleSide }),
      );
      ring.rotation.x = -Math.PI / 2;
      ring.position.set(it.x, this.world.groundAt(it.x, it.z) + 0.05, it.z);
      this.scene.add(ring);
      this.items.set(it.id, { ...it, active: true, respawnAt: 0, pending: 0, mesh: g });
    }
  }

  makeKart(opts) {
    const k = new Kart(this.scene, opts);
    k.world = this.world;
    k.sizeMul = this.mods.size;
    k.root.scale.setScalar(this.mods.size);
    k.endless = this.mods.endless;
    return k;
  }

  addBot(i) {
    const id = `bot-${i}`;
    const name = BOT_NAMES[i % BOT_NAMES.length];
    const palette = COLORS.filter((c) => c !== this.me.color);
    const color = botColor(i, palette);
    const car = CAR_IDS[Math.floor(Math.random() * CAR_IDS.length)];
    const kart = this.makeKart({ id, name, color, car, bot: true });
    this.karts.set(id, kart);
    this.players.set(id, { name, color, car, kills: 0, deaths: 0, bot: true });
    this.bots.push({ kart, brain: new BotBrain(this.world) });
    this.spawnKart(kart);
  }

  addPlayer(id, name, color, car, bot = false, kills = 0, deaths = 0) {
    name = String(name || 'Racer').slice(0, 16);
    color = /^#[0-9a-f]{6}$/i.test(color) ? color : '#ffffff';
    this.players.set(id, { name, color, car, kills, deaths, bot });
    if (!this.karts.has(id)) this.karts.set(id, this.makeKart({ id, name, color, car }));
  }

  removePlayer(id) {
    const p = this.players.get(id);
    if (p) this.hud.feed(`<span style="color:${esc(p.color)}">${esc(p.name)}</span> left`);
    this.players.delete(id);
    const k = this.karts.get(id);
    if (k) {
      k.dispose();
      this.karts.delete(id);
    }
  }

  isBot(id) {
    return !!this.players.get(id)?.bot;
  }

  /** Whether this client decides damage dealt by `owner`'s projectiles to bots. */
  botAuthority(owner) {
    return owner === this.me.id || (this.net.isHost && this.isBot(owner));
  }

  pickSpawn() {
    let best = null, bestScore = -1;
    for (const s of this.world.spawns) {
      let minD = 999;
      for (const k of this.karts.values()) {
        if (!k.alive) continue;
        minD = Math.min(minD, Math.hypot(k.pos.x - s.x, k.pos.z - s.z));
      }
      const score = minD + Math.random() * 20;
      if (score > bestScore) { bestScore = score; best = s; }
    }
    return best;
  }

  spawnKart(k) {
    if (k === this.me && this.pendingCar) {
      const car = this.pendingCar;
      this.pendingCar = null;
      if (k.setCar(car)) {
        this.sfx.setCar(car);
        this.players.get(k.id).car = car;
        this.net.send({ t: 'car', car });
        this.hud.toast(`Now driving: ${CARS[car].name}`);
      }
      this.refreshCarSwap();
    }
    k.spawnAt(this.pickSpawn(), performance.now());
    k.pos.y = this.world.groundAt(k.pos.x, k.pos.z);
    if (k === this.me) this.hud.clearCenter();
  }

  // ---------- input ----------

  bindInput() {
    const c = this.canvas;
    const overlay = document.getElementById('clickToPlay');
    this.buildCarSwap();
    const lock = () => {
      this.sfx.init();
      if (this.mobile) {
        // Phones have no pointer lock: "Play" just resumes and re-centers tilt
        this.locked = true;
        overlay.classList.add('hidden');
        this.mobile.setVisible(true);
        this.mobile.calibrate();
        return;
      }
      c.requestPointerLock?.();
    };
    if (this.mobile) {
      this.mobile.onPause = () => {
        this.locked = false;
        this.mobile.setVisible(false);
        overlay.classList.remove('hidden');
      };
      overlay.querySelector('p').textContent = 'Drag to aim, hold to shoot. If tilt steering is on, tap Play while holding the phone how you like to drive.';
      document.getElementById('weaponBar').addEventListener('pointerdown', (e) => {
        const slot = e.target.closest('.wslot');
        if (!slot) return;
        e.preventDefault();
        this.selectWeapon(SLOTS[[...slot.parentNode.children].indexOf(slot)]);
      });
    }
    c.addEventListener('click', lock);
    document.getElementById('resume').addEventListener('click', lock);
    document.getElementById('leave').addEventListener('click', () => this.exit());
    document.addEventListener('pointerlockchange', () => {
      if (this.mobile) return;
      this.locked = document.pointerLockElement === c;
      overlay.classList.toggle('hidden', this.locked || this.gameOver);
      if (!this.locked) this.mouse.left = this.mouse.right = false;
    });
    if (this.mobile) {
      this.locked = true;
      overlay.classList.add('hidden');
    } else overlay.classList.remove('hidden');

    document.addEventListener('mousemove', (e) => {
      if (!this.locked) return;
      this.me.aimYaw -= e.movementX * SENS;
      this.me.aimPitch = Math.max(-0.35, Math.min(0.55, this.me.aimPitch - e.movementY * SENS));
    });
    c.addEventListener('wheel', (e) => {
      if (!this.locked) return;
      e.preventDefault();
      this.cycleWeapon(e.deltaY > 0 ? 1 : -1);
    }, { passive: false });
    c.addEventListener('mousedown', (e) => {
      if (!this.locked) return;
      if (e.button === 0) this.mouse.left = true;
      if (e.button === 2) this.mouse.right = true;
    });
    document.addEventListener('mouseup', (e) => {
      if (e.button === 0) this.mouse.left = false;
      if (e.button === 2) this.mouse.right = false;
    });
    c.addEventListener('contextmenu', (e) => e.preventDefault());
    document.addEventListener('keydown', (e) => {
      if (e.target instanceof HTMLInputElement) return;
      if (e.code === 'Tab' || e.code === 'Space') e.preventDefault();
      this.keys.add(e.code);
      // Top-row number keys pick weapons: 1..9 then 0
      const dm = /^Digit(\d)$/.exec(e.code);
      if (dm) {
        const slot = +dm[1];
        const w = SLOTS.find((k) => WEAPONS[k].slot === slot);
        if (w) this.selectWeapon(w);
      }
      if (e.code === 'KeyM') {
        this.sfx.setMuted(!this.sfx.muted);
        this.hud.toast(this.sfx.muted ? 'Sound off' : 'Sound on');
      }
    });
    document.addEventListener('keyup', (e) => this.keys.delete(e.code));
    window.addEventListener('blur', () => this.keys.clear());
    document.addEventListener('click', (e) => {
      if (e.target?.id === 'copyLink') {
        const url = `${location.origin}${location.pathname}?room=${this.code}`;
        navigator.clipboard?.writeText(url).then(
          () => this.hud.toast('Invite link copied!'),
          () => this.hud.toast(url),
        );
      }
    });
  }

  readInput() {
    const k = this.keys;
    const on = (...codes) => codes.some((c) => k.has(c));
    if (!this.locked) return { throttle: 0, steer: 0, boost: false, drift: false };
    if (this.mobile) return this.mobile.read();
    return {
      throttle: (on('KeyW', 'ArrowUp') ? 1 : 0) - (on('KeyS', 'ArrowDown') ? 1 : 0),
      steer: (on('KeyA', 'ArrowLeft') ? 1 : 0) - (on('KeyD', 'ArrowRight') ? 1 : 0),
      boost: on('ShiftLeft', 'ShiftRight'),
      drift: on('Space'),
    };
  }

  // ---------- networking ----------

  bindNet() {
    const net = this.net;
    net.on('msg', (m, from) => {
      this.lastHostMsg = performance.now();
      this.onMsg(m, from);
    });
    net.on('leave', (id) => this.removePlayer(id));
    net.on('closed', () => this.endGame('Host left the game', 'The room has closed.'));
    if (net.offline) return;
    // Heartbeat on a timer so guests can detect a vanished host quickly
    // (WebRTC can take ~30s to notice), and keep going while the host tab is hidden.
    this.lastHostMsg = performance.now();
    setInterval(() => {
      if (net.isHost) net.send({ t: 'ping' });
      else if (this.joined && performance.now() - this.lastHostMsg > 10000) {
        this.endGame('Lost connection to host', 'The host left or their connection dropped.');
      }
    }, 1000);
  }

  onMsg(m, from) {
    const now = performance.now();
    const host = this.net.isHost;
    switch (m.t) {
      case 'hello': {
        if (!host) return;
        this.addPlayer(from, m.name, m.color, m.car);
        const p = this.players.get(from);
        this.net.sendTo(from, {
          t: 'welcome',
          mode: 'battle',
          map: this.mapId,
          mods: this.mods,
          destructible: this.destructible,
          digs: this.digs,
          broken: this.world.pieces.filter((b) => b.dead).map((b) => b.id),
          players: [...this.players.entries()].map(([id, q]) => [id, q.name, q.color, q.car, q.bot ? 1 : 0, q.kills, q.deaths]),
          items: [...this.items.values()].map((it) => [it.id, it.active ? 1 : 0]),
        });
        this.net.sendExcept(from, { t: 'pj', id: from, name: p.name, color: p.color, car: p.car });
        this.hud.feed(`<span style="color:${esc(p.color)}">${esc(p.name)}</span> joined`);
        break;
      }
      case 'welcome': {
        for (const [id, name, color, car, bot, kills, deaths] of m.players) {
          if (id === this.me.id) continue;
          this.addPlayer(id, name, color, car, !!bot, kills, deaths);
        }
        for (const [id, active] of m.items) {
          const it = this.items.get(id);
          if (it) it.active = !!active;
        }
        for (const d of m.digs || []) this.applyDig(d, false);
        for (const id of m.broken || []) this.world.destroy(id);
        this.joined = true;
        this.spawnKart(this.me);
        break;
      }
      case 'pj':
        if (m.id !== this.me.id) {
          this.addPlayer(m.id, m.name, m.color, m.car);
          const p = this.players.get(m.id);
          this.hud.feed(`<span style="color:${esc(p.color)}">${esc(p.name)}</span> joined`);
        }
        break;
      case 'leave':
        this.removePlayer(m.id);
        break;
      case 's':
        for (const e of m.e) {
          if (e[0] === this.me.id) continue;
          // Clients may only report their own kart; only the host reports bots
          if (e[0] !== m.i && !(this.isBot(e[0]) && !host)) continue;
          const k = this.karts.get(e[0]);
          if (k && !k.bot) k.setNet(e, now);
        }
        break;
      case 'f':
        if (m.o !== m.i && !this.isBot(m.o)) return;
        this.spawnProjectile(m);
        break;
      case 'zap':
        if (m.o !== m.i && !this.isBot(m.o)) return;
        this.applyZap(m, false);
        break;
      case 'bm':
        if (m.o !== m.i && !this.isBot(m.o)) return;
        this.onBeam(m, false);
        break;
      case 'h':
        this.onRemoteHit(m);
        break;
      case 'k':
        if (m.v !== m.i && !this.isBot(m.v)) return;
        this.onKill(m);
        break;
      case 'bd':
        if (host) this.applyBotDamage(m.b, Math.min(60, Math.max(0, +m.d || 0)), from, m.w);
        break;
      case 'grab':
        if (host) this.hostGrab(m.it, from);
        break;
      case 'item':
        this.onItem(m);
        break;
      case 'dig':
        this.applyDig(m, true);
        break;
      case 'car': {
        const k = this.karts.get(m.i);
        const p = this.players.get(m.i);
        if (k && p && !k.bot && CARS[m.car]) {
          k.setCar(m.car);
          p.car = m.car;
        }
        break;
      }
      case 'blk':
        this.breakPiece(m.b, true);
        break;
    }
  }

  sendSnapshot(now) {
    if (this.net.offline || !this.joined || now - this.lastSnap < SNAP_MS) return;
    this.lastSnap = now;
    const snap = (k) => [
      k.id, r2(k.pos.x), r2(k.pos.y), r2(k.pos.z), r2(k.vel.x), r2(k.vel.y), r2(k.vel.z),
      r3(k.heading), r3(k.aimYaw), r3(k.aimPitch), Math.round(k.hp), k.alive ? 1 : 0, k.boosting ? 1 : 0,
      now < k.shieldUntil ? 1 : 0, k.drifting ? 1 : 0,
    ];
    const e = [snap(this.me)];
    for (const b of this.bots) e.push(snap(b.kart));
    this.net.send({ t: 's', e });
  }

  // ---------- weapons ----------

  /** Where the crosshair points: march the camera ray until it hits something. */
  aimPoint(out) {
    const cam = this.camera;
    cam.getWorldDirection(_dir);
    const p = _b.copy(cam.position);
    for (let d = 0; d < 180; d += 1) {
      p.addScaledVector(_dir, 1);
      if (d > 6 && pointBlocked(this.world, p.x, p.y, p.z)) break;
      let hit = false;
      if (d > 6) {
        for (const k of this.karts.values()) {
          if (k === this.me || !k.alive) continue;
          const dx = p.x - k.pos.x, dy = p.y - k.pos.y - 1, dz = p.z - k.pos.z;
          if (dx * dx + dy * dy + dz * dz < HIT_R * HIT_R) { hit = true; break; }
        }
      }
      if (hit) break;
    }
    return out.copy(p);
  }

  aimDir(k, origin) {
    const dir = new THREE.Vector3();
    if (k === this.me) {
      dir.subVectors(this.aimPoint(new THREE.Vector3()), origin);
      if (dir.lengthSq() < 4) this.camera.getWorldDirection(dir);
    } else {
      const cp = Math.cos(k.aimPitch);
      dir.set(Math.sin(k.aimYaw) * cp, Math.sin(k.aimPitch), Math.cos(k.aimYaw) * cp);
    }
    return dir.normalize();
  }

  /** Switch the local player's weapon (keys 1-0 / mouse wheel). */
  selectWeapon(key) {
    const me = this.me;
    if (!WEAPONS[key] || !(key === 'blaster' || me.inv[key] > 0) || me.weapon === key) return;
    me.weapon = key;
    this.sfx.play('hitmark', 0.4);
  }

  cycleWeapon(dir) {
    const owned = SLOTS.filter((w) => w === 'blaster' || this.me.inv[w] > 0);
    const i = owned.indexOf(this.me.weapon);
    this.selectWeapon(owned[(i + dir + owned.length) % owned.length]);
  }

  tryFire(k, weapon, now) {
    const w = WEAPONS[weapon];
    if (!w) return;
    if (weapon === 'rocket') {
      if (k.rocketCooldown > 0) return;
      k.rocketCooldown = w.cooldown;
      if (k.rockets <= 0) {
        if (k === this.me) {
          this.sfx.play('empty');
          this.hud.toast('No rockets: grab a red pickup');
        }
        return;
      }
      k.rockets--;
    } else {
      if (k.cooldown > 0) return;
      if (weapon === 'blaster') {
        if (k.overheated) return;
        k.heat += w.heat;
        if (k.heat >= 1) {
          k.heat = 1;
          k.overheated = true;
          if (k === this.me) this.sfx.play('overheat');
        }
      } else {
        if (!(k.inv[weapon] > 0)) {
          k.weapon = 'blaster';
          return;
        }
        k.inv[weapon]--;
        if (k.inv[weapon] <= 0) {
          delete k.inv[weapon];
          if (k === this.me) this.hud.toast(`${w.name} is empty`);
          k.weapon = 'blaster';
        }
      }
      k.cooldown = w.cooldown * (k.bot ? 1.5 : 1);
    }
    const origin = k.muzzleWorld(_a).clone();
    const dir = this.aimDir(k, origin);
    if (w.hitscan) {
      this.fireBeam(k, weapon, origin, dir);
      return;
    }
    if (w.lob) dir.y += w.lob;
    dir.normalize();
    const m = { t: 'f', p: `${k.id}:${++this.pid}`, o: k.id, w: weapon, x: r2(origin.x), y: r2(origin.y), z: r2(origin.z) };
    // Spread weapons send every pellet's direction
    const n = w.pellets || 1;
    const dirs = [];
    for (let i = 0; i < n; i++) {
      const d = dir.clone();
      if (w.spread) {
        d.x += (Math.random() - 0.5) * 2 * w.spread;
        d.y += (Math.random() - 0.5) * 2 * w.spread;
        d.z += (Math.random() - 0.5) * 2 * w.spread;
        d.normalize();
      }
      dirs.push([r3(d.x), r3(d.y), r3(d.z)]);
    }
    m.d = dirs;
    if (w.homing) {
      // Lock on to the enemy closest to where we're aiming
      let best = null, bestScore = 0.55;
      for (const t of this.karts.values()) {
        if (t === k || !t.alive) continue;
        _b.set(t.pos.x - origin.x, t.pos.y + 1 - origin.y, t.pos.z - origin.z);
        const dist = _b.length();
        if (dist > 70) continue;
        const score = _b.divideScalar(dist).dot(dir);
        if (score > bestScore) { bestScore = score; best = t.id; }
      }
      if (best) m.tg = best;
    }
    this.spawnProjectile(m);
    this.net.send(m);
  }

  spawnProjectile(m) {
    const w = WEAPONS[m.w];
    if (!w) return;
    const dirs = Array.isArray(m.d?.[0]) ? m.d : Array.isArray(m.d) ? [m.d] : null;
    if (!dirs) return;
    const color = this.players.get(m.o)?.color || '#fff';
    const origin = new THREE.Vector3(+m.x, +m.y, +m.z);
    dirs.forEach((d, i) => {
      const dir = new THREE.Vector3(+d[0], +d[1], +d[2]).normalize();
      const { mesh, ownMat } = projectileMesh(w, m.w, color);
      mesh.position.copy(origin);
      mesh.quaternion.setFromUnitVectors(Z, dir);
      this.scene.add(mesh);
      this.projectiles.push({
        id: dirs.length > 1 ? `${m.p}.${i}` : m.p, owner: m.o, w: m.w, def: w,
        pos: origin.clone(), vel: dir.multiplyScalar(w.speed), life: w.life, max: w.life,
        mesh, ownMat, color: w.color || color, trail: 0, dead: false, bounces: w.bounces || 0, target: m.tg || null, stuck: null,
      });
    });
    this.fx.muzzle(origin, w.color || color);
    this.sfx.play(w.sfx, m.o === this.me.id ? 0.9 : this.volAt(origin) * 0.8);
  }

  killProjectile(p) {
    if (p.dead) return;
    p.dead = true;
    this.scene.remove(p.mesh);
    p.ownMat?.dispose();
  }

  /** Rough surface normal where a projectile went from `a` (free) into `b` (solid). */
  surfaceNormal(a, b, out) {
    const world = this.world;
    const gy = world.groundAt(b.x, b.z);
    if (b.y < gy + 0.05) {
      const e = 0.8;
      return out.set(world.groundAt(b.x - e, b.z) - world.groundAt(b.x + e, b.z), 2 * e, world.groundAt(b.x, b.z - e) - world.groundAt(b.x, b.z + e)).normalize();
    }
    for (const c of world.cyls) {
      if (c.dead || b.y > c.h) continue;
      const dx = b.x - c.x, dz = b.z - c.z;
      if (dx * dx + dz * dz < c.r * c.r) return out.set(dx, 0, dz).normalize();
    }
    for (const bx of world.boxes) {
      if (bx.dead || b.y > bx.h || b.y < bx.y0 || b.x < bx.minX || b.x > bx.maxX || b.z < bx.minZ || b.z > bx.maxZ) continue;
      if (a.y > bx.h) return out.set(0, 1, 0);
      if (a.x < bx.minX) return out.set(-1, 0, 0);
      if (a.x > bx.maxX) return out.set(1, 0, 0);
      if (a.z < bx.minZ) return out.set(0, 0, -1);
      return out.set(0, 0, 1);
    }
    return out.set(0, 1, 0);
  }

  updateProjectiles(dt, now) {
    const prev = new THREE.Vector3(), n = new THREE.Vector3();
    for (const p of this.projectiles) {
      if (p.dead) continue;
      const w = p.def;
      p.life -= dt;
      if (p.stuck) {
        // Sticky grenade: ride along with whatever it hit, then blow
        if (p.stuck.kart) {
          const k = p.stuck.kart;
          if (k.alive) p.pos.copy(k.pos).add(p.stuck.off);
        }
        p.mesh.position.copy(p.pos);
        p.mesh.scale.setScalar(1 + Math.sin(now * 0.04) * 0.25);
        if ((p.fuse -= dt) <= 0) {
          this.killProjectile(p);
          this.explode(p, p.pos, null);
        }
        continue;
      }
      if (p.life <= 0) {
        this.killProjectile(p);
        if (w.splash) this.explode(p, p.pos, null);
        continue;
      }
      if (w.gravity) p.vel.y -= w.gravity * dt;
      if (w.homing && p.target) {
        const t = this.karts.get(p.target);
        if (t?.alive) {
          const spd = p.vel.length();
          _b.set(t.pos.x - p.pos.x, t.pos.y + 1 - p.pos.y, t.pos.z - p.pos.z).normalize().multiplyScalar(spd);
          p.vel.lerp(_b, Math.min(1, w.homing * dt)).setLength(spd);
        }
      }
      const dist = p.vel.length() * dt;
      const steps = Math.max(1, Math.ceil(dist / 0.8));
      const hitR = HIT_R + (w.radius || 0);
      for (let s = 0; s < steps && !p.dead && !p.stuck; s++) {
        prev.copy(p.pos);
        p.pos.addScaledVector(p.vel, dt / steps);
        if (pointBlocked(this.world, p.pos.x, p.pos.y, p.pos.z)) {
          if (p.bounces > 0) {
            this.surfaceNormal(prev, p.pos, n);
            const vn = p.vel.dot(n);
            if (vn < 0) p.vel.addScaledVector(n, -2 * vn).multiplyScalar(0.8);
            p.pos.copy(prev);
            p.bounces--;
            this.sfx.play('impact', this.volAt(p.pos) * 0.3);
            continue;
          }
          if (w.sticky) {
            p.pos.copy(prev);
            p.stuck = { pos: prev.clone() };
            p.fuse = w.fuse;
            break;
          }
          if (!w.splash && this.destructible && this.botAuthority(p.owner)) this.chipBlock(p.pos);
          this.killProjectile(p);
          this.fx.impact(p.pos, p.color);
          if (w.splash) this.explode(p, p.pos, null);
          else if (w.mesh !== 'flame') this.sfx.play('impact', this.volAt(p.pos) * 0.5);
          break;
        }
        for (const k of this.karts.values()) {
          if (!k.alive || k.id === p.owner) continue;
          const dx = p.pos.x - k.pos.x, dy = p.pos.y - k.pos.y - 1, dz = p.pos.z - k.pos.z;
          if (dx * dx + dy * dy + dz * dz < hitR * hitR) {
            if (w.sticky) {
              p.stuck = { kart: k, off: p.pos.clone().sub(k.pos) };
              p.fuse = w.fuse;
            } else {
              this.projectileHitKart(p, k, now);
            }
            break;
          }
        }
      }
      if (!p.dead) {
        p.mesh.position.copy(p.pos);
        if (p.vel.lengthSq() > 0.01) p.mesh.quaternion.setFromUnitVectors(Z, _b.copy(p.vel).normalize());
        if (w.mesh === 'flame') {
          const age = 1 - p.life / p.max;
          p.mesh.scale.setScalar(0.5 + age * 3);
          p.ownMat.opacity = 0.85 * (1 - age);
        } else if (w.mesh === 'bubble') {
          p.mesh.scale.setScalar(1 + Math.sin(now * 0.02 + p.life * 9) * 0.08);
        }
        if (w.mesh === 'rocket' && (p.trail -= dt) <= 0) {
          p.trail = 0.025;
          this.fx.puff(p.pos, '#cfcfcf', 0.35);
        }
      }
    }
    this.projectiles = this.projectiles.filter((p) => !p.dead);
    this.updateEffects(dt);
  }

  projectileHitKart(p, k, now) {
    const w = p.def;
    this.killProjectile(p);
    this.fx.impact(p.pos, p.color);
    if (k === this.me) {
      this.damageMe(w.dmg, p.owner, p.w, now, p.vel.clone().normalize());
      if (w.burn) this.ignite(this.me, p.owner, w.burn);
      this.net.send({ t: 'h', p: p.id, w: p.w, o: p.owner, v: this.me.id, x: r2(p.pos.x), y: r2(p.pos.y), z: r2(p.pos.z) });
    } else if (this.isBot(k.id) && this.botAuthority(p.owner)) {
      // Bots take any afterburn up front
      this.damageBot(k.id, w.dmg + (w.burn ? w.burn * BURN_DPS * 0.8 : 0), p.owner, p.w, now);
    }
    if (w.chain && this.botAuthority(p.owner)) this.chainZap(p, k);
    if (w.splash) this.explode(p, p.pos, k.id);
    else if (w.mesh !== 'flame') this.sfx.play('impact', this.volAt(p.pos) * 0.6);
  }

  onRemoteHit(m) {
    const p = this.projectiles.find((q) => q.id === m.p);
    const pos = new THREE.Vector3(+m.x, +m.y, +m.z);
    if (p) {
      this.killProjectile(p);
      this.fx.impact(pos, p.color);
    }
    const w = WEAPONS[m.w];
    if (w?.splash) this.explode({ id: m.p, owner: m.o, w: m.w, def: w }, pos, m.v);
    if (w?.chain && this.botAuthority(m.o)) {
      const k = this.karts.get(m.v);
      if (k) this.chainZap({ owner: m.o, def: w, pos }, k);
    }
    if (m.o === this.me.id) {
      this.hud.hit(false);
      this.sfx.play('hitmark');
    }
  }

  /** Splash damage (rockets, grenades). The owner also decides any crater. */
  explode(p, pos, directId) {
    if (this.exploded.has(p.id)) return;
    this.exploded.add(p.id);
    if (this.exploded.size > 500) this.exploded = new Set([...this.exploded].slice(-200));
    const w = p.def || WEAPONS[p.w];
    const now = performance.now();
    const color = w.color && p.w !== 'rocket' ? w.color : this.players.get(p.owner)?.color || '#ff8c1a';
    this.fx.explosion(pos.clone(), color, w.splash > 7 ? 1 : 0.8);
    if (this.destructible && w.dig && this.botAuthority(p.owner)) {
      const m = { t: 'dig', x: r2(pos.x), y: r2(pos.y), z: r2(pos.z), r: w.dig };
      this.net.send(m);
      this.applyDig(m, true);
    }
    this.sfx.play('explode', this.volAt(pos));
    const me = this.me;
    const dMe = Math.hypot(me.pos.x - pos.x, me.pos.y + 1 - pos.y, me.pos.z - pos.z);
    this.shake = Math.max(this.shake, Math.max(0, 1 - dMe / 30) * 0.8);
    if (me.alive && me.id !== p.owner && me.id !== directId && dMe < w.splash) {
      const f = 1 - dMe / w.splash;
      _a.set(me.pos.x - pos.x, 0, me.pos.z - pos.z).normalize();
      me.vel.addScaledVector(_a, 18 * f);
      me.vel.y += 8 * f;
      this.damageMe(w.splashDmg * f, p.owner, p.w, now, null);
    }
    if (this.botAuthority(p.owner)) {
      for (const k of this.karts.values()) {
        if (!k.alive || !this.isBot(k.id) || k.id === directId || k.id === p.owner) continue;
        const d = Math.hypot(k.pos.x - pos.x, k.pos.y + 1 - pos.y, k.pos.z - pos.z);
        if (d < w.splash) this.damageBot(k.id, w.splashDmg * (1 - d / w.splash), p.owner, p.w, now);
      }
    }
  }

  /** Electro Bolt: arc from the victim to up to N more enemies nearby (through walls). */
  chainZap(p, victim) {
    const w = p.def;
    const from = victim.pos;
    const targets = [...this.karts.values()]
      .filter((t) => t.alive && t !== victim && t.id !== p.owner)
      .map((t) => [t, t.pos.distanceTo(from)])
      .filter(([, d]) => d < w.chainRange)
      .sort((a, b) => a[1] - b[1])
      .slice(0, w.chain)
      .map(([t]) => t.id);
    if (!targets.length) return;
    const m = { t: 'zap', o: p.owner, x: r2(from.x), y: r2(from.y + 1), z: r2(from.z), v: targets, d: w.chainDmg };
    this.net.send(m);
    this.applyZap(m, true);
  }

  applyZap(m, mine) {
    const from = new THREE.Vector3(+m.x, +m.y, +m.z);
    for (const id of m.v || []) {
      const t = this.karts.get(id);
      if (!t) continue;
      this.lightning(from, new THREE.Vector3(t.pos.x, t.pos.y + 1, t.pos.z), WEAPONS.electro.color);
      const d = Math.min(30, +m.d || 0);
      if (id === this.me.id && m.o !== this.me.id) this.damageMe(d, m.o, 'electro', performance.now(), null);
      // Bot damage is sent by whoever launched the zap
      else if (mine && this.isBot(id)) this.damageBot(id, d, m.o, 'electro', performance.now());
    }
    this.sfx.play('zap', this.volAt(from));
  }

  /** Focus Beam: instant, perfectly accurate ray. The shooter reports the damage. */
  fireBeam(k, weapon, origin, dir) {
    const w = WEAPONS[weapon];
    const p = origin.clone();
    let victim = null;
    for (let d = 0; d < w.range; d += 0.6) {
      p.addScaledVector(dir, 0.6);
      if (pointBlocked(this.world, p.x, p.y, p.z)) break;
      for (const t of this.karts.values()) {
        if (t === k || !t.alive) continue;
        const dx = p.x - t.pos.x, dy = p.y - t.pos.y - 1, dz = p.z - t.pos.z;
        if (dx * dx + dy * dy + dz * dz < HIT_R * HIT_R) { victim = t; break; }
      }
      if (victim) break;
    }
    const m = { t: 'bm', o: k.id, a: [r2(origin.x), r2(origin.y), r2(origin.z)], b: [r2(p.x), r2(p.y), r2(p.z)] };
    if (victim) {
      m.v = victim.id;
      m.d = w.dmg;
      if (this.isBot(victim.id)) this.damageBot(victim.id, w.dmg, k.id, weapon, performance.now());
      else if (victim === this.me) this.damageMe(w.dmg, k.id, weapon, performance.now(), null, true);
    }
    this.net.send(m);
    this.onBeam(m, true);
  }

  onBeam(m, local) {
    const a = new THREE.Vector3(...m.a.map(Number)), b = new THREE.Vector3(...m.b.map(Number));
    if (![a.x, a.y, a.z, b.x, b.y, b.z].every(Number.isFinite)) return;
    this.beamFx(m.o, a, b);
    if (!local && m.v === this.me.id && m.o !== this.me.id) this.damageMe(Math.min(10, +m.d || 0), m.o, 'beam', performance.now(), null, true);
    if (m.v && m.o === this.me.id && Math.random() < 0.3) this.hud.hit(false);
  }

  beamFx(owner, a, b) {
    this.beams ||= new Map();
    let bm = this.beams.get(owner);
    if (!bm) {
      const mesh = new THREE.Mesh(
        new THREE.CylinderGeometry(0.12, 0.12, 1, 6, 1, true).rotateX(Math.PI / 2).translate(0, 0, 0.5),
        new THREE.MeshBasicMaterial({ color: WEAPONS.beam.color, transparent: true, opacity: 0.9, blending: THREE.AdditiveBlending, depthWrite: false }),
      );
      const outer = new THREE.Mesh(mesh.geometry, new THREE.MeshBasicMaterial({ color: WEAPONS.beam.color, transparent: true, opacity: 0.25, blending: THREE.AdditiveBlending, depthWrite: false }));
      outer.scale.set(3, 3, 1);
      mesh.add(outer);
      this.scene.add(mesh);
      bm = { mesh, life: 0 };
      this.beams.set(owner, bm);
    }
    const len = a.distanceTo(b);
    bm.mesh.position.copy(a);
    bm.mesh.quaternion.setFromUnitVectors(Z, _b.subVectors(b, a).normalize());
    bm.mesh.scale.set(1, 1, len);
    bm.mesh.visible = true;
    bm.life = 0.14;
    this.fx.spark(b, WEAPONS.beam.color);
  }

  lightning(a, b, color) {
    const pts = [];
    const segs = 8;
    for (let i = 0; i <= segs; i++) {
      const p = a.clone().lerp(b, i / segs);
      if (i > 0 && i < segs) p.add(new THREE.Vector3((Math.random() - 0.5) * 1.6, (Math.random() - 0.5) * 1.6, (Math.random() - 0.5) * 1.6));
      pts.push(p);
    }
    const line = new THREE.Line(new THREE.BufferGeometry().setFromPoints(pts), new THREE.LineBasicMaterial({ color, transparent: true }));
    this.scene.add(line);
    (this.bolts ||= []).push({ line, life: 0.3 });
    this.fx.impact(b, color);
  }

  updateEffects(dt) {
    for (const bm of this.beams?.values() || []) {
      bm.life -= dt;
      if (bm.life <= 0) bm.mesh.visible = false;
    }
    if (this.bolts) {
      for (const b of this.bolts) {
        b.life -= dt;
        b.line.material.opacity = Math.max(0, b.life / 0.3);
        if (b.life <= 0) {
          this.scene.remove(b.line);
          b.line.geometry.dispose();
          b.line.material.dispose();
        }
      }
      this.bolts = this.bolts.filter((b) => b.life > 0);
    }
  }

  /** Flamethrower afterburn on the local player (bots take it up front). */
  ignite(k, by, secs) {
    k.burnT = Math.max(k.burnT || 0, secs);
    k.burnBy = by;
  }

  // ---------- change car (pause menu) ----------

  buildCarSwap() {
    const wrap = document.getElementById('carSwap');
    wrap.classList.remove('hidden');
    const grid = wrap.querySelector('.swapGrid');
    grid.innerHTML = '';
    this.swapBtns = {};
    for (const id of CAR_IDS) {
      const b = document.createElement('button');
      b.className = 'carBtn';
      let img = '';
      try {
        img = `<img alt="" src="${carThumbnail(id, this.me.color, 72)}" />`;
      } catch {}
      b.innerHTML = `${img}<span>${CARS[id].name}</span><small>${CARS[id].hp} HP</small>`;
      b.onclick = (e) => {
        e.stopPropagation();
        this.pendingCar = id === this.me.carType ? null : id;
        this.refreshCarSwap();
        if (this.pendingCar) this.hud.toast(`${CARS[id].name} ready: you'll switch on your next respawn`);
      };
      grid.appendChild(b);
      this.swapBtns[id] = b;
    }
    this.refreshCarSwap();
  }

  refreshCarSwap() {
    if (!this.swapBtns) return;
    const next = this.pendingCar || this.me.carType;
    document.getElementById('swapStats').innerHTML = `<b>${CARS[next].name}</b>${statBarsHTML(next)}`;
    for (const [id, b] of Object.entries(this.swapBtns)) {
      b.classList.toggle('on', id === next);
      b.classList.toggle('current', id === this.me.carType);
    }
    document.getElementById('carSwapNote').textContent = this.pendingCar
      ? `Driving ${CARS[this.me.carType].name} · switching to ${CARS[this.pendingCar].name} on your next respawn`
      : `Driving ${CARS[this.me.carType].name} · pick another car to swap to it when you respawn`;
  }

  /** Bots pick the best weapon they own for the range they're fighting at. */
  botWeapon(kart, brain) {
    const t = brain.target;
    if (!t) return;
    const pref = botPreference(kart.pos.distanceTo(t.pos));
    kart.weapon = pref.find((w) => kart.inv[w] > 0) || 'blaster';
  }

  // ---------- destructible terrain ----------

  applyDig(m, fx) {
    const x = +m.x, y = +m.y, z = +m.z, r = Math.min(8, +m.r || 5);
    if (![x, y, z].every(Number.isFinite)) return;
    if (this.digs.length < 3000) this.digs.push({ t: 'dig', x, y, z, r });
    const gone = this.world.carve(x, y, z, r);
    if (fx) this.debris(gone);
    // Anything standing in the new hole drops into it
    for (const k of this.karts.values()) if (k.local || k.bot) k.onGround = false;
  }

  /** Blaster bolts chip blocks; the shooter counts hits and breaks the block for everyone. */
  chipBlock(pos) {
    const b = this.world.pieceAt(pos.x, pos.y, pos.z);
    if (!b) return;
    const hits = (this.blockHits.get(b.id) || 0) + 1;
    this.blockHits.set(b.id, hits);
    if (hits >= 4) {
      this.net.send({ t: 'blk', b: b.id });
      this.breakPiece(b.id, true);
    }
  }

  breakPiece(id, fx) {
    const gone = this.world.destroy(+id);
    if (fx) this.debris(gone);
  }

  debris(pieces) {
    if (!pieces.length) return;
    const v = new THREE.Vector3();
    for (const b of pieces.slice(0, 12)) {
      const at = new THREE.Vector3(b.cx, b.cy, b.cz);
      for (let i = 0; i < 5; i++) {
        v.set(Math.random() - 0.5, Math.random() * 0.8 + 0.3, Math.random() - 0.5).multiplyScalar(10);
        this.fx.spawn({ color: b.color, pos: at, vel: v, life: 0.9 + Math.random() * 0.5, size: 0.4 + Math.random() * 0.4, gravity: 26 });
      }
      this.fx.puff(at, '#b8a88f', 1.2);
    }
    this.sfx.play('bump', this.volAt(new THREE.Vector3(pieces[0].cx, pieces[0].cy, pieces[0].cz)));
  }

  damageMe(dmg, by, weapon, now, dir, quiet = false) {
    const me = this.me;
    if (!me.alive || now < me.shieldUntil) return;
    me.hp -= dmg;
    if (!quiet || Math.random() < 0.15) {
      this.hud.damage(dmg);
      this.shake = Math.max(this.shake, 0.25 + dmg / 80);
      this.sfx.play('hurt', quiet ? 0.3 : 0.7);
    }
    if (dir) me.vel.addScaledVector(dir, dmg * 0.15);
    if (me.hp <= 0) {
      me.hp = 0;
      me.alive = false;
      me.respawnAt = now + RESPAWN_MS;
      const m = { t: 'k', v: me.id, by, w: weapon };
      this.net.send(m);
      this.onKill(m);
    }
  }

  damageBot(id, dmg, by, weapon, now) {
    if (by === this.me.id) {
      this.hud.hit(false);
      this.sfx.play('hitmark');
    }
    if (this.net.isHost) this.applyBotDamage(id, dmg, by, weapon, now);
    else this.net.toHost({ t: 'bd', b: id, d: r2(dmg), w: weapon });
  }

  applyBotDamage(id, dmg, by, weapon, now = performance.now()) {
    const k = this.karts.get(id);
    if (!k?.bot || !k.alive || now < k.shieldUntil) return;
    k.hp -= dmg;
    if (k.hp <= 0) {
      k.hp = 0;
      k.alive = false;
      k.respawnAt = now + RESPAWN_MS;
      const m = { t: 'k', v: id, by, w: WEAPONS[weapon] || weapon === 'wall' ? weapon : 'blaster' };
      this.net.send(m);
      this.onKill(m);
    }
  }

  onKill(m) {
    const victim = this.players.get(m.v);
    const killer = this.players.get(m.by);
    if (!victim) return;
    victim.deaths++;
    if (killer && m.by !== m.v) killer.kills++;
    const k = this.karts.get(m.v);
    if (k) {
      if (k.alive || k === this.me || k.bot) {
        this.fx.explosion(_a.set(k.pos.x, k.pos.y + 1, k.pos.z).clone(), victim.color, 1.4);
        this.sfx.play('explode', this.volAt(k.pos));
      }
      k.alive = false;
    }
    this.hud.killFeed(killer, victim, m.w);
    if (m.by === this.me.id && m.v !== this.me.id) {
      this.hud.center(`BLASTED ${victim.name.toUpperCase()}`, '', 1500);
      this.hud.hit(true);
      this.sfx.play('kill');
      // Achievements
      const now = performance.now();
      unlock('firstBlood', this.sfx);
      if (now - (this.lastKillAt || -1e9) < 4000) unlock('double', this.sfx);
      this.lastKillAt = now;
      this.streak = (this.streak || 0) + 1;
      if (this.streak >= 5) unlock('rampage', this.sfx);
      if (m.w === 'rocket') unlock('rocketSci', this.sfx);
      if (this.me.drifting) unlock('driftKill', this.sfx);
    }
    if (m.v === this.me.id) {
      this.streak = 0;
      this.killerId = m.by !== m.v ? m.by : null;
      this.hud.center('WRECKED', killer && m.by !== m.v ? `Blasted by ${killer.name}` : '', 0);
    }
  }

  // ---------- items ----------

  checkPickups(now) {
    const local = [this.me, ...this.bots.map((b) => b.kart)];
    for (const it of this.items.values()) {
      if (it.pending && now - it.pending > 1000) it.pending = 0;
      if (!it.active || it.pending) continue;
      for (const k of local) {
        if (!k.alive) continue;
        const dx = k.pos.x - it.x, dz = k.pos.z - it.z;
        if (dx * dx + dz * dz > 2.8 * 2.8 || k.pos.y - this.world.groundAt(it.x, it.z) > 4) continue;
        if (it.type === 'health' && k.hp >= k.maxHp) continue;
        if (it.type === 'weapon' && (k.inv[it.w] || 0) >= WEAPONS[it.w].ammo * MAX_AMMO_MULT) continue;
        if (this.net.isHost) this.hostGrab(it.id, k.id);
        else {
          it.pending = now;
          this.net.toHost({ t: 'grab', it: it.id });
        }
        break;
      }
    }
    if (this.net.isHost) {
      for (const it of this.items.values()) {
        if (!it.active && now >= it.respawnAt) {
          const m = { t: 'item', it: it.id, a: 1 };
          this.net.send(m);
          this.onItem(m);
        }
      }
    }
  }

  hostGrab(itemId, by) {
    const it = this.items.get(itemId);
    const k = this.karts.get(by);
    if (!it?.active || !k?.alive) return;
    it.active = false;
    it.respawnAt = performance.now() + ITEM_RESPAWN_MS;
    const m = { t: 'item', it: itemId, a: 0, by };
    this.net.send(m);
    this.onItem(m);
  }

  onItem(m) {
    const it = this.items.get(m.it);
    if (!it) return;
    it.active = !!m.a;
    it.pending = 0;
    if (m.a) return;
    for (let i = 0; i < 8; i++) this.fx.spark(_a.set(it.x, 1.5, it.z), '#ffffff');
    const k = this.karts.get(m.by);
    if (!k || !(k === this.me || k.bot)) return;
    if (it.type === 'rocket') k.rockets = Math.min(9, k.rockets + 3);
    if (it.type === 'health') k.hp = Math.min(k.maxHp, k.hp + 50);
    if (it.type === 'boost') k.boost = 1;
    if (it.type === 'weapon') {
      const w = WEAPONS[it.w];
      k.inv[it.w] = Math.min(w.ammo * MAX_AMMO_MULT, (k.inv[it.w] || 0) + w.ammo);
      if (k.weapon === 'blaster') k.weapon = it.w;
    }
    if (k === this.me) {
      this.sfx.play('pickup');
      this.hud.toast(it.type === 'weapon' ? `${WEAPONS[it.w].icon} ${WEAPONS[it.w].name} [${WEAPONS[it.w].slot}]` : { rocket: '+3 Rockets', health: '+50 Health', boost: 'Boost refilled' }[it.type]);
    }
  }

  // ---------- loop ----------

  volAt(pos) {
    const d = this.camera.position.distanceTo(pos);
    return Math.max(0, 1 - d / 110);
  }

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
    const all = [...this.karts.values()];

    // Local player
    if (me.alive) {
      const input = this.readInput();
      this.lastThrottle = input.throttle;
      const ev = me.simulate(dt, input, this.world, all);
      this.kartEvents(me, ev);
      if (this.mods.damage && ev.wall && wallDamage(ev.wall) > 0) {
        this.damageMe(wallDamage(ev.wall), me.id, 'wall', now, null, wallDamage(ev.wall) < 8);
        if (!me.alive) unlock('demolition', this.sfx);
      }
      if (me.burnT > 0) {
        me.burnT -= dt;
        if (Math.random() < 0.5) this.fx.spawn({ color: Math.random() < 0.5 ? '#ff7b1c' : '#ffd166', pos: _a.set(me.pos.x + (Math.random() - 0.5) * 2, me.pos.y + 1, me.pos.z + (Math.random() - 0.5) * 2), vel: _b.set(0, 4, 0), life: 0.4, size: 0.5, grow: 2, additive: true });
        this.damageMe(BURN_DPS * dt, me.burnBy, 'flame', now, null, true);
      }
      const m = this.locked && this.mobile;
      if (m) {
        // Drag anywhere to swing the turret
        const [dx, dy] = m.consumeAim();
        me.aimYaw -= dx * 0.0065;
        me.aimPitch = Math.max(-0.35, Math.min(0.55, me.aimPitch - dy * 0.005));
      }
      if (this.locked && (this.mouse.left || m?.fire)) this.tryFire(me, me.weapon, now);
      if (this.locked && (this.mouse.right || m?.rocket || this.keys.has('KeyE') || this.keys.has('KeyQ'))) this.tryFire(me, 'rocket', now);
    } else if (this.joined && me.respawnAt && now >= me.respawnAt) {
      me.respawnAt = 0;
      this.spawnKart(me);
    } else if (this.joined && me.respawnAt) {
      const s = Math.ceil((me.respawnAt - now) / 1000);
      const killer = this.killerId && this.players.get(this.killerId);
      this.hud.center('WRECKED', `${killer ? `Blasted by ${killer.name} · ` : ''}Respawning in ${s}…`, 0);
    }

    // Bots (host only)
    for (const { kart, brain } of this.bots) {
      if (!kart.alive) {
        if (now >= kart.respawnAt) this.spawnKart(kart);
        continue;
      }
      const input = brain.think(dt, kart, all, this.items, now);
      this.botWeapon(kart, brain);
      const ev = kart.simulate(dt, input, this.world, all);
      this.kartEvents(kart, ev);
      if (this.mods.damage && wallDamage(ev.wall) > 0) this.applyBotDamage(kart.id, wallDamage(ev.wall), kart.id, 'wall', now);
      if (input.fire) this.tryFire(kart, kart.weapon, now);
      if (input.rocket) this.tryFire(kart, 'rocket', now);
    }

    // Remote karts
    for (const k of all) {
      if (k !== me && !k.bot) k.updateRemote(dt, now);
      k.updateVisual(dt, now);
      this.driftFx(k);
      this.draftFx(k);
    }
    this.sfx.screech(me.alive && me.drifting && me.onGround ? Math.min(1, 0.5 + me.driftT) : 0);
    document.getElementById('draft').classList.toggle('on', me.alive && me.drafting);

    this.updateProjectiles(dt, now);
    this.checkPickups(now);
    for (const it of this.items.values()) {
      it.mesh.visible = it.active;
      it.mesh.rotation.y += dt * 2;
      it.mesh.position.y = this.world.groundAt(it.x, it.z) + 1.6 + Math.sin(now * 0.003 + it.id) * 0.25;
    }
    for (const c of this.world.padMeshes) {
      c.position.y = c.userData.base + 0.9 + ((now * 0.002) % 1) * 1.5;
    }
    this.fx.update(dt);
    this.sendSnapshot(now);
    this.updateCamera(dt, now);

    // Sound + HUD
    const f = me.forward(_b);
    const speed = me.vel.x * f.x + me.vel.z * f.z;
    this.sfx.engine(dt, speed / (30 * me.stats.speed), this.lastThrottle || 0, me.boosting, me.alive && this.locked);
    this.hud.stats(me, speed);
    this.hud.weaponBar(me);
    this.hud.tick(now);
    this.hud.room(this.net.offline ? null : this.code, [...this.players.values()].filter((p) => !p.bot).length);
    this.hud.board(this.players, me.id);
    this.hud.scoreboard(this.players, me.id, this.keys.has('Tab'));
    if ((this.mapTick = (this.mapTick || 0) + 1) % 2 === 0) this.hud.minimap(this.world, this.karts, this.items, me);
  }

  /** Tire smoke, skid marks and sparks that heat up the longer a drift is held (as in race mode). */
  driftFx(k) {
    if (!k.alive || !k.drifting || !k.onGround) {
      k.skid = null;
      return;
    }
    const f = k.forward(_b);
    const rx = f.z, rz = -f.x; // right, flat on the ground
    const right = new THREE.Vector3(rx, 0, rz);
    const wheels = [-1, 1].map((side) => {
      const x = k.pos.x - f.x * 1.35 + rx * side * 1.05, z = k.pos.z - f.z * 1.35 + rz * side * 1.05;
      return new THREE.Vector3(x, this.world.groundAt(x, z) + 0.05, z);
    });
    if (k.skid) for (let w = 0; w < 2; w++) this.skids.add(k.skid[w], wheels[w], right);
    k.skid = wheels;
    for (const w of wheels) if (Math.random() < 0.6) this.fx.puff(w, '#e2e2e2', 0.55);
    const t = k.driftT;
    const col = t < 0.8 ? '#7fdcff' : t < 1.8 ? '#ffb703' : '#ff4fd8';
    const n = t < 0.8 ? 1 : t < 1.8 ? 2 : 4;
    for (let i = 0; i < n; i++) this.fx.spark(wheels[i % 2], col);
  }

  /** Wind lines streaming past a kart that's drafting. */
  draftFx(k) {
    if (!k.alive || !k.drafting || Math.random() > 0.7) return;
    const f = k.forward(new THREE.Vector3());
    const side = Math.random() < 0.5 ? -1 : 1, off = 1.2 + Math.random() * 0.8, ahead = 1 + Math.random() * 3;
    const p = new THREE.Vector3(k.pos.x + f.x * ahead + f.z * side * off, k.pos.y + 0.4 + Math.random() * 1.4, k.pos.z + f.z * ahead - f.x * side * off);
    const v = k.vel.x * f.x + k.vel.z * f.z;
    this.fx.streak(p, f, f.clone().multiplyScalar(v * 0.55));
  }

  kartEvents(k, ev) {
    const vol = k === this.me ? 1 : this.volAt(k.pos);
    if (ev.jumped) this.sfx.play('jump', vol * 0.8);
    if (ev.jumped && k === this.me) unlock('bounce', this.sfx);
    if (ev.impact > 8) {
      this.sfx.play('bump', vol * Math.min(1, ev.impact / 30));
      if (k === this.me) this.shake = Math.max(this.shake, Math.min(0.5, ev.impact / 60));
    }
  }

  updateCamera(dt, now) {
    const me = this.me;
    const cam = this.camera;
    const yaw = me.aimYaw, pitch = me.aimPitch;
    const cp = Math.cos(pitch);
    _dir.set(Math.sin(yaw) * cp, Math.sin(pitch), Math.cos(yaw) * cp);
    const zoom = this.mods.size < 1 ? 0.8 : 1 + (this.mods.size - 1) * 0.55; // giant cars: pull back
    const base = _a.set(me.pos.x, me.pos.y + 2.8 * zoom, me.pos.z);
    let dist = (me.alive ? 8.5 : 14) * zoom;
    // Pull the camera in if an obstacle is between it and the kart
    for (let d = 1; d <= dist; d += 0.5) {
      if (pointBlocked(this.world, base.x - _dir.x * d, base.y - _dir.y * d + 1.4, base.z - _dir.z * d, 0.3)) {
        dist = Math.max(2.5, d - 0.6);
        break;
      }
    }
    cam.position.set(base.x - _dir.x * dist, Math.max(0.6, base.y - _dir.y * dist + 1.4), base.z - _dir.z * dist);
    cam.lookAt(base.x + _dir.x * 30, base.y + _dir.y * 30 + 0.6, base.z + _dir.z * 30);
    if (this.shake > 0.01) {
      cam.position.x += (Math.random() - 0.5) * this.shake;
      cam.position.y += (Math.random() - 0.5) * this.shake;
      this.shake *= Math.exp(-8 * dt);
    }
    const fov = (me.boosting ? 84 : 72) + (me.drifting ? 4 : 0) + (me.drafting ? 3 : 0);
    if (Math.abs(cam.fov - fov) > 0.1) {
      cam.fov += (fov - cam.fov) * Math.min(1, dt * 6);
      cam.updateProjectionMatrix();
    }
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
    document.exitPointerLock?.();
    document.getElementById('clickToPlay').classList.add('hidden');
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
