import * as THREE from 'three';
import { buildArena, pointBlocked } from './arena.js';
import { Kart, MAX_HP } from './kart.js';
import { Fx } from './fx.js';
import { BotBrain, BOT_NAMES } from './bots.js';
import { Hud } from './hud.js';

export const COLORS = ['#ff3b3b', '#ff9f1c', '#ffe03b', '#3bff6f', '#2ec4ff', '#6a5cff', '#ff4fd8', '#f5f5f5'];

const WEAPONS = {
  blaster: { speed: 115, dmg: 9, life: 1.1, heat: 0.075, cooldown: 0.11 },
  rocket: { speed: 64, dmg: 45, life: 2.5, cooldown: 0.9, splash: 7.5, splashDmg: 38 },
};
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
  constructor({ net, name, color, botCount, sfx, code }) {
    this.net = net;
    this.sfx = sfx;
    this.code = code;
    this.hud = new Hud();

    const renderer = (this.renderer = new THREE.WebGLRenderer({ antialias: true }));
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.setSize(window.innerWidth, window.innerHeight);
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFShadowMap;
    document.getElementById('game').appendChild(renderer.domElement);
    this.canvas = renderer.domElement;

    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(72, window.innerWidth / window.innerHeight, 0.1, 600);
    this.world = buildArena(this.scene);
    this.fx = new Fx(this.scene);

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

    this.me = new Kart(this.scene, { id: net.myId, name, color, local: true });
    this.karts.set(net.myId, this.me);
    this.players.set(net.myId, { name, color, kills: 0, deaths: 0, bot: false });

    this.buildItems();
    this.bindInput();
    this.bindNet();

    if (net.isHost) {
      for (let i = 0; i < botCount; i++) this.addBot(i);
      this.spawnKart(this.me);
    } else {
      this.hud.center('Joining…', 'Connecting to host', 0);
      net.send({ t: 'hello', name, color });
    }

    this.hud.show();
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
    const ringColors = { rocket: '#ff3b3b', health: '#4ade80', boost: '#facc15' };
    for (const it of this.world.items) {
      const g = mk[it.type]();
      g.position.set(it.x, 1.6, it.z);
      this.scene.add(g);
      const ring = new THREE.Mesh(
        new THREE.RingGeometry(1.6, 2, 32),
        new THREE.MeshBasicMaterial({ color: ringColors[it.type], transparent: true, opacity: 0.6, side: THREE.DoubleSide }),
      );
      ring.rotation.x = -Math.PI / 2;
      ring.position.set(it.x, 0.03, it.z);
      this.scene.add(ring);
      this.items.set(it.id, { ...it, active: true, respawnAt: 0, pending: 0, mesh: g });
    }
  }

  addBot(i) {
    const id = `bot-${i}`;
    const name = BOT_NAMES[i % BOT_NAMES.length];
    const palette = COLORS.filter((c) => c !== this.me.color);
    const color = palette[(i + 2) % palette.length];
    const kart = new Kart(this.scene, { id, name, color, bot: true });
    this.karts.set(id, kart);
    this.players.set(id, { name, color, kills: 0, deaths: 0, bot: true });
    this.bots.push({ kart, brain: new BotBrain(this.world) });
    this.spawnKart(kart);
  }

  addPlayer(id, name, color, bot = false, kills = 0, deaths = 0) {
    name = String(name || 'Racer').slice(0, 16);
    color = /^#[0-9a-f]{6}$/i.test(color) ? color : '#ffffff';
    this.players.set(id, { name, color, kills, deaths, bot });
    if (!this.karts.has(id)) this.karts.set(id, new Kart(this.scene, { id, name, color }));
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
    k.spawnAt(this.pickSpawn(), performance.now());
    if (k === this.me) this.hud.clearCenter();
  }

  // ---------- input ----------

  bindInput() {
    const c = this.canvas;
    const overlay = document.getElementById('clickToPlay');
    const lock = () => {
      this.sfx.init();
      c.requestPointerLock?.();
    };
    c.addEventListener('click', lock);
    document.getElementById('resume').addEventListener('click', lock);
    document.getElementById('leave').addEventListener('click', () => this.exit());
    document.addEventListener('pointerlockchange', () => {
      this.locked = document.pointerLockElement === c;
      overlay.classList.toggle('hidden', this.locked || this.gameOver);
      if (!this.locked) this.mouse.left = this.mouse.right = false;
    });
    overlay.classList.remove('hidden');

    document.addEventListener('mousemove', (e) => {
      if (!this.locked) return;
      this.me.aimYaw -= e.movementX * SENS;
      this.me.aimPitch = Math.max(-0.35, Math.min(0.55, this.me.aimPitch - e.movementY * SENS));
    });
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
        this.addPlayer(from, m.name, m.color);
        const p = this.players.get(from);
        this.net.sendTo(from, {
          t: 'welcome',
          players: [...this.players.entries()].map(([id, q]) => [id, q.name, q.color, q.bot ? 1 : 0, q.kills, q.deaths]),
          items: [...this.items.values()].map((it) => [it.id, it.active ? 1 : 0]),
        });
        this.net.sendExcept(from, { t: 'pj', id: from, name: p.name, color: p.color });
        this.hud.feed(`<span style="color:${esc(p.color)}">${esc(p.name)}</span> joined`);
        break;
      }
      case 'welcome': {
        for (const [id, name, color, bot, kills, deaths] of m.players) {
          if (id === this.me.id) continue;
          this.addPlayer(id, name, color, !!bot, kills, deaths);
        }
        for (const [id, active] of m.items) {
          const it = this.items.get(id);
          if (it) it.active = !!active;
        }
        this.joined = true;
        this.spawnKart(this.me);
        break;
      }
      case 'pj':
        if (m.id !== this.me.id) {
          this.addPlayer(m.id, m.name, m.color);
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
    }
  }

  sendSnapshot(now) {
    if (this.net.offline || !this.joined || now - this.lastSnap < SNAP_MS) return;
    this.lastSnap = now;
    const snap = (k) => [
      k.id, r2(k.pos.x), r2(k.pos.y), r2(k.pos.z), r2(k.vel.x), r2(k.vel.y), r2(k.vel.z),
      r3(k.heading), r3(k.aimYaw), r3(k.aimPitch), Math.round(k.hp), k.alive ? 1 : 0, k.boosting ? 1 : 0,
      now < k.shieldUntil ? 1 : 0,
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

  tryFire(k, weapon, now) {
    const w = WEAPONS[weapon];
    if (weapon === 'blaster') {
      if (k.cooldown > 0 || k.overheated) return;
      k.cooldown = w.cooldown * (k.bot ? 1.5 : 1);
      k.heat += w.heat;
      if (k.heat >= 1) {
        k.heat = 1;
        k.overheated = true;
        if (k === this.me) this.sfx.play('overheat');
      }
    } else {
      if (k.rocketCooldown > 0) return;
      k.rocketCooldown = w.cooldown;
      if (k.rockets <= 0) {
        if (k === this.me) {
          this.sfx.play('empty');
          this.hud.toast('No rockets — grab a red pickup');
        }
        return;
      }
      k.rockets--;
    }
    const origin = k.muzzleWorld(_a);
    const dir = new THREE.Vector3();
    if (k === this.me) {
      dir.subVectors(this.aimPoint(new THREE.Vector3()), origin);
      if (dir.lengthSq() < 4) this.camera.getWorldDirection(dir);
      dir.normalize();
    } else {
      const cp = Math.cos(k.aimPitch);
      dir.set(Math.sin(k.aimYaw) * cp, Math.sin(k.aimPitch), Math.cos(k.aimYaw) * cp);
    }
    const m = {
      t: 'f', p: `${k.id}:${++this.pid}`, o: k.id, w: weapon,
      x: r2(origin.x), y: r2(origin.y), z: r2(origin.z), d: [r3(dir.x), r3(dir.y), r3(dir.z)],
    };
    this.spawnProjectile(m);
    this.net.send(m);
  }

  spawnProjectile(m) {
    const w = WEAPONS[m.w];
    if (!w || !Array.isArray(m.d)) return;
    const color = this.players.get(m.o)?.color || '#fff';
    const pos = new THREE.Vector3(m.x, m.y, m.z);
    const dir = new THREE.Vector3(m.d[0], m.d[1], m.d[2]).normalize();
    let mesh;
    if (m.w === 'blaster') {
      mesh = new THREE.Group();
      const core = new THREE.Mesh(this.boltCore ||= new THREE.CylinderGeometry(0.07, 0.07, 2.2, 6).rotateX(Math.PI / 2), this.boltCoreMat ||= new THREE.MeshBasicMaterial({ color: '#ffffff' }));
      const glow = new THREE.Mesh(
        this.boltGlow ||= new THREE.CylinderGeometry(0.2, 0.2, 2.6, 8).rotateX(Math.PI / 2),
        new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.7, blending: THREE.AdditiveBlending, depthWrite: false }),
      );
      mesh.add(core, glow);
    } else {
      mesh = new THREE.Group();
      const body = new THREE.Mesh(new THREE.CylinderGeometry(0.22, 0.22, 1.2, 10).rotateX(Math.PI / 2), new THREE.MeshStandardMaterial({ color: '#e0e0e0', metalness: 0.4 }));
      const nose = new THREE.Mesh(new THREE.ConeGeometry(0.22, 0.5, 10).rotateX(Math.PI / 2), new THREE.MeshBasicMaterial({ color }));
      nose.position.z = 0.85;
      const flame = new THREE.Mesh(new THREE.SphereGeometry(0.3, 8, 6), new THREE.MeshBasicMaterial({ color: '#ffb703', blending: THREE.AdditiveBlending, transparent: true }));
      flame.position.z = -0.75;
      mesh.add(body, nose, flame);
    }
    mesh.position.copy(pos);
    mesh.quaternion.setFromUnitVectors(Z, dir);
    this.scene.add(mesh);
    this.projectiles.push({ id: m.p, owner: m.o, w: m.w, pos, dir, speed: w.speed, life: w.life, mesh, color, trail: 0, dead: false });
    this.fx.muzzle(pos, color);
    const vol = this.volAt(pos);
    this.sfx.play(m.w === 'rocket' ? 'rocket' : 'blaster', m.o === this.me.id ? 1 : vol * 0.8);
  }

  killProjectile(p) {
    if (p.dead) return;
    p.dead = true;
    this.scene.remove(p.mesh);
    p.mesh.traverse((o) => {
      if (o.material && o.material !== this.boltCoreMat) o.material.dispose();
      if (o.geometry && o.geometry !== this.boltCore && o.geometry !== this.boltGlow) o.geometry.dispose();
    });
  }

  updateProjectiles(dt, now) {
    for (const p of this.projectiles) {
      if (p.dead) continue;
      p.life -= dt;
      if (p.life <= 0) {
        this.killProjectile(p);
        if (p.w === 'rocket') this.explodeRocket(p, p.pos, null);
        continue;
      }
      const dist = p.speed * dt;
      const steps = Math.max(1, Math.ceil(dist / 0.8));
      const step = dist / steps;
      for (let s = 0; s < steps && !p.dead; s++) {
        p.pos.addScaledVector(p.dir, step);
        if (pointBlocked(this.world, p.pos.x, p.pos.y, p.pos.z)) {
          this.killProjectile(p);
          this.fx.impact(p.pos, p.color);
          if (p.w === 'rocket') this.explodeRocket(p, p.pos, null);
          else this.sfx.play('impact', this.volAt(p.pos) * 0.5);
          break;
        }
        for (const k of this.karts.values()) {
          if (!k.alive || k.id === p.owner) continue;
          const dx = p.pos.x - k.pos.x, dy = p.pos.y - k.pos.y - 1, dz = p.pos.z - k.pos.z;
          if (dx * dx + dy * dy + dz * dz < HIT_R * HIT_R) {
            this.projectileHitKart(p, k, now);
            break;
          }
        }
      }
      if (!p.dead) {
        p.mesh.position.copy(p.pos);
        if (p.w === 'rocket' && (p.trail -= dt) <= 0) {
          p.trail = 0.025;
          this.fx.puff(p.pos, '#cfcfcf', 0.35);
        }
      }
    }
    this.projectiles = this.projectiles.filter((p) => !p.dead);
  }

  projectileHitKart(p, k, now) {
    this.killProjectile(p);
    this.fx.impact(p.pos, p.color);
    const w = WEAPONS[p.w];
    if (k === this.me) {
      this.damageMe(w.dmg, p.owner, p.w, now, p.dir);
      this.net.send({ t: 'h', p: p.id, w: p.w, o: p.owner, v: this.me.id, x: r2(p.pos.x), y: r2(p.pos.y), z: r2(p.pos.z) });
    } else if (this.isBot(k.id) && this.botAuthority(p.owner)) {
      this.damageBot(k.id, w.dmg, p.owner, p.w, now);
    }
    if (p.w === 'rocket') this.explodeRocket(p, p.pos, k.id);
    else this.sfx.play('impact', this.volAt(p.pos) * 0.6);
  }

  onRemoteHit(m) {
    const p = this.projectiles.find((q) => q.id === m.p);
    const pos = new THREE.Vector3(+m.x, +m.y, +m.z);
    if (p) {
      this.killProjectile(p);
      this.fx.impact(pos, p.color);
    }
    if (m.w === 'rocket') this.explodeRocket({ id: m.p, owner: m.o, w: 'rocket' }, pos, m.v);
    if (m.o === this.me.id) {
      this.hud.hit(false);
      this.sfx.play('hitmark');
    }
  }

  explodeRocket(p, pos, directId) {
    if (this.exploded.has(p.id)) return;
    this.exploded.add(p.id);
    if (this.exploded.size > 500) this.exploded = new Set([...this.exploded].slice(-200));
    const now = performance.now();
    const color = this.players.get(p.owner)?.color || '#ff8c1a';
    this.fx.explosion(pos.clone(), color, 1);
    this.sfx.play('explode', this.volAt(pos));
    const w = WEAPONS.rocket;
    const me = this.me;
    const dMe = Math.hypot(me.pos.x - pos.x, me.pos.y + 1 - pos.y, me.pos.z - pos.z);
    this.shake = Math.max(this.shake, Math.max(0, 1 - dMe / 30) * 0.8);
    if (me.alive && me.id !== p.owner && me.id !== directId && dMe < w.splash) {
      const f = 1 - dMe / w.splash;
      _a.set(me.pos.x - pos.x, 0, me.pos.z - pos.z).normalize();
      me.vel.addScaledVector(_a, 18 * f);
      me.vel.y += 8 * f;
      this.damageMe(w.splashDmg * f, p.owner, 'rocket', now, null);
    }
    if (this.botAuthority(p.owner)) {
      for (const k of this.karts.values()) {
        if (!k.alive || !this.isBot(k.id) || k.id === directId || k.id === p.owner) continue;
        const d = Math.hypot(k.pos.x - pos.x, k.pos.y + 1 - pos.y, k.pos.z - pos.z);
        if (d < w.splash) this.damageBot(k.id, w.splashDmg * (1 - d / w.splash), p.owner, 'rocket', now);
      }
    }
  }

  damageMe(dmg, by, weapon, now, dir) {
    const me = this.me;
    if (!me.alive || now < me.shieldUntil) return;
    me.hp -= dmg;
    this.hud.damage(dmg);
    this.shake = Math.max(this.shake, 0.25 + dmg / 80);
    this.sfx.play('hurt', 0.7);
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
      const m = { t: 'k', v: id, by, w: weapon === 'rocket' ? 'rocket' : 'blaster' };
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
    }
    if (m.v === this.me.id) {
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
        if (dx * dx + dz * dz > 2.8 * 2.8 || k.pos.y > 4) continue;
        if (it.type === 'health' && k.hp >= MAX_HP) continue;
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
    if (it.type === 'health') k.hp = Math.min(MAX_HP, k.hp + 50);
    if (it.type === 'boost') k.boost = 1;
    if (k === this.me) {
      this.sfx.play('pickup');
      this.hud.toast({ rocket: '+3 Rockets', health: '+50 Health', boost: 'Boost refilled' }[it.type]);
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
      const ev = me.simulate(dt, input, this.world, all);
      this.kartEvents(me, ev);
      if (this.locked && this.mouse.left) this.tryFire(me, 'blaster', now);
      if (this.locked && (this.mouse.right || this.keys.has('KeyE') || this.keys.has('KeyQ'))) this.tryFire(me, 'rocket', now);
      if (me.drifting && Math.random() < 0.6) {
        const f = me.forward(_b);
        this.fx.spark(_a.set(me.pos.x - f.x * 1.6, 0.2, me.pos.z - f.z * 1.6), '#ffd166');
      }
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
      const ev = kart.simulate(dt, input, this.world, all);
      this.kartEvents(kart, ev);
      if (input.fire) this.tryFire(kart, 'blaster', now);
      if (input.rocket) this.tryFire(kart, 'rocket', now);
    }

    // Remote karts
    for (const k of all) {
      if (k !== me && !k.bot) k.updateRemote(dt, now);
      k.updateVisual(dt, now);
    }

    this.updateProjectiles(dt, now);
    this.checkPickups(now);
    for (const it of this.items.values()) {
      it.mesh.visible = it.active;
      it.mesh.rotation.y += dt * 2;
      it.mesh.position.y = 1.6 + Math.sin(now * 0.003 + it.id) * 0.25;
    }
    for (const c of this.world.padMeshes) {
      c.position.y = 0.9 + ((now * 0.002) % 1) * 1.5;
    }
    this.fx.update(dt);
    this.sendSnapshot(now);
    this.updateCamera(dt, now);

    // Sound + HUD
    const f = me.forward(_b);
    const speed = me.vel.x * f.x + me.vel.z * f.z;
    this.sfx.engine(speed, me.boosting, me.alive && this.locked);
    this.hud.stats(me, speed);
    this.hud.tick(now);
    this.hud.room(this.net.offline ? null : this.code, [...this.players.values()].filter((p) => !p.bot).length);
    this.hud.board(this.players, me.id);
    this.hud.scoreboard(this.players, me.id, this.keys.has('Tab'));
    if ((this.mapTick = (this.mapTick || 0) + 1) % 2 === 0) this.hud.minimap(this.world, this.karts, this.items, me);
  }

  kartEvents(k, ev) {
    const vol = k === this.me ? 1 : this.volAt(k.pos);
    if (ev.jumped) this.sfx.play('jump', vol * 0.8);
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
    const base = _a.set(me.pos.x, me.pos.y + 2.8, me.pos.z);
    let dist = me.alive ? 8.5 : 14;
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
    const fov = me.boosting ? 84 : 72;
    if (Math.abs(cam.fov - fov) > 0.1) {
      cam.fov += (fov - cam.fov) * Math.min(1, dt * 6);
      cam.updateProjectionMatrix();
    }
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
