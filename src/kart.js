import * as THREE from 'three';
import { collideWorld } from './arena.js';
import { buildCar, CARS } from './cars.js';

export const KART_RADIUS = 1.6;
export const MAX_HP = 100;

const GRAVITY = 34;
const MAX_SPEED = 30;
const BOOST_SPEED = 48;
const REVERSE_SPEED = 13;

const _fwd = new THREE.Vector3();
const _v = new THREE.Vector3();

export function lerpAngle(a, b, t) {
  let d = ((b - a + Math.PI) % (Math.PI * 2)) - Math.PI;
  if (d < -Math.PI) d += Math.PI * 2;
  return a + d * t;
}

export function angleDiff(a, b) {
  let d = ((b - a + Math.PI) % (Math.PI * 2)) - Math.PI;
  if (d < -Math.PI) d += Math.PI * 2;
  return d;
}

function makeTagCanvas() {
  const c = document.createElement('canvas');
  c.width = 256;
  c.height = 72;
  return c;
}

export class Kart {
  constructor(scene, { id, name, color, car = 'hyper', local = false, bot = false }) {
    this.id = id;
    this.carType = CARS[car] ? car : 'hyper';
    this.stats = CARS[this.carType];
    this.maxHp = this.stats.hp;
    this.name = name;
    this.color = color;
    this.local = local;
    this.bot = bot;
    this.scene = scene;

    this.pos = new THREE.Vector3();
    this.vel = new THREE.Vector3();
    this.heading = 0;
    this.aimYaw = 0;
    this.aimPitch = 0;
    this.steerVis = 0;
    this.wheelSpin = 0;

    this.hp = this.maxHp;
    this.alive = false;
    this.boost = 1;
    this.boosting = false;
    this.drifting = false;
    this.heat = 0;
    this.overheated = false;
    this.rockets = 2;
    this.shieldUntil = 0;
    this.onGround = true;
    this.padCooldown = 0;
    this.cooldown = 0;
    this.rocketCooldown = 0;
    this.respawnAt = 0;

    // Network smoothing for remote karts
    this.netPos = new THREE.Vector3();
    this.netVel = new THREE.Vector3();
    this.netHeading = 0;
    this.netAim = 0;
    this.netPitch = 0;
    this.netTime = 0;
    this.hasNet = false;
    this.shielded = false;

    this.buildMesh();
  }

  buildMesh() {
    const root = new THREE.Group();
    const car = buildCar(this.carType, this.color);
    root.add(car.group);
    const body = car.body;
    this.wheels = car.wheels;
    this.frontPivots = car.frontPivots;
    this.flames = car.flames;

    const dark = new THREE.MeshStandardMaterial({ color: '#222428', roughness: 0.8 });
    const add = (geo, mat, x, y, z, parent) => {
      const m = new THREE.Mesh(geo, mat);
      m.position.set(x, y, z);
      m.castShadow = true;
      parent.add(m);
      return m;
    };

    // Turret (follows aim, independent from the chassis)
    const turret = new THREE.Group();
    turret.position.set(0, car.roofY + 0.15, 0);
    root.add(turret);
    add(new THREE.CylinderGeometry(0.35, 0.45, 0.3, 12), dark, 0, 0, 0, turret);
    const barrel = new THREE.Group();
    turret.add(barrel);
    const bmat = new THREE.MeshStandardMaterial({ color: '#3a3f47', metalness: 0.6, roughness: 0.4 });
    const b1 = add(new THREE.CylinderGeometry(0.12, 0.14, 1.5, 10), bmat, 0.16, 0.1, 0.7, barrel);
    b1.rotation.x = Math.PI / 2;
    const b2 = add(new THREE.CylinderGeometry(0.12, 0.14, 1.5, 10), bmat, -0.16, 0.1, 0.7, barrel);
    b2.rotation.x = Math.PI / 2;
    add(new THREE.BoxGeometry(0.6, 0.2, 0.2), new THREE.MeshBasicMaterial({ color: this.color }), 0, 0.1, 1.4, barrel);
    this.muzzle = new THREE.Object3D();
    this.muzzle.position.set(0, 0.1, 1.6);
    barrel.add(this.muzzle);

    // Spawn shield
    this.shield = new THREE.Mesh(
      new THREE.SphereGeometry(2.6, 20, 14),
      new THREE.MeshBasicMaterial({ color: '#7df9ff', transparent: true, opacity: 0.22, depthWrite: false }),
    );
    this.shield.position.y = 1.1;
    this.shield.visible = false;
    root.add(this.shield);

    // Name tag with health bar
    if (!this.local) {
      this.tagCanvas = makeTagCanvas();
      this.tagTex = new THREE.CanvasTexture(this.tagCanvas);
      this.tagTex.colorSpace = THREE.SRGBColorSpace;
      const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: this.tagTex, depthTest: false, transparent: true }));
      sprite.scale.set(5, 1.4, 1);
      sprite.position.y = car.roofY + 1.6;
      sprite.renderOrder = 10;
      root.add(sprite);
      this.tag = sprite;
      this.tagHp = -1;
      this.drawTag();
    }

    this.root = root;
    this.body = body;
    this.turret = turret;
    this.barrel = barrel;
    root.visible = false;
    this.scene.add(root);
  }

  drawTag() {
    const bucket = Math.max(0, Math.ceil(this.hp / 5));
    if (bucket === this.tagHp) return;
    this.tagHp = bucket;
    const g = this.tagCanvas.getContext('2d');
    g.clearRect(0, 0, 256, 72);
    g.font = 'bold 30px system-ui, sans-serif';
    g.textAlign = 'center';
    g.lineWidth = 6;
    g.strokeStyle = 'rgba(0,0,0,0.75)';
    g.strokeText(this.name, 128, 32);
    g.fillStyle = this.color;
    g.fillText(this.name, 128, 32);
    g.fillStyle = 'rgba(0,0,0,0.6)';
    g.fillRect(48, 46, 160, 16);
    const f = Math.max(0, this.hp) / this.maxHp;
    g.fillStyle = f > 0.5 ? '#4ade80' : f > 0.25 ? '#facc15' : '#ef4444';
    g.fillRect(50, 48, 156 * f, 12);
    this.tagTex.needsUpdate = true;
  }

  get center() {
    return _v.set(this.pos.x, this.pos.y + 1.0, this.pos.z);
  }

  forward(out = _fwd) {
    return out.set(Math.sin(this.heading), 0, Math.cos(this.heading));
  }

  spawnAt(s, now) {
    this.pos.set(s.x, 0, s.z);
    this.vel.set(0, 0, 0);
    this.heading = s.yaw;
    this.aimYaw = s.yaw;
    this.aimPitch = 0;
    this.hp = this.maxHp;
    this.alive = true;
    this.boost = 1;
    this.heat = 0;
    this.overheated = false;
    this.rockets = 2;
    this.shieldUntil = now + 2000;
    this.root.visible = true;
  }

  /**
   * Arcade kart physics. Runs for the local player and (on the host) for bots.
   * input: { throttle -1..1, steer -1..1 (+ = left), boost bool, drift bool }
   * Returns info about events (jump pad, impacts) for sound / fx.
   */
  simulate(dt, input, world, others) {
    const ev = { impact: 0, jumped: false };
    const fwd = this.forward();
    let vF = this.vel.x * fwd.x + this.vel.z * fwd.z;
    let latX = this.vel.x - fwd.x * vF;
    let latZ = this.vel.z - fwd.z * vF;

    this.boosting = input.boost && input.throttle > 0 && this.boost > 0.02;
    if (this.boosting) this.boost = Math.max(0, this.boost - dt * 0.38);
    else this.boost = Math.min(1, this.boost + dt * 0.12);
    if (this.boost <= 0.02) this.boosting = false;

    this.drifting = input.drift && vF > 8 && this.onGround;
    const control = this.onGround ? 1 : 0.25;

    // Throttle / brake
    const st = this.stats;
    const top = (this.boosting ? BOOST_SPEED : MAX_SPEED) * st.speed;
    if (input.throttle > 0) {
      if (vF < top) vF += (this.boosting ? 62 : 34) * st.accel * input.throttle * dt * control;
    } else if (input.throttle < 0) {
      if (vF > 0.5) vF -= 48 * dt * control;
      else if (vF > -REVERSE_SPEED) vF -= 22 * dt * control;
    } else {
      const f = 9 * dt * control;
      vF = Math.abs(vF) < f ? 0 : vF - Math.sign(vF) * f;
    }
    if (vF > top) vF -= (vF - top) * 2.5 * dt;
    if (input.drift && this.onGround && !this.drifting) vF *= 1 - 1.5 * dt; // handbrake at low speed

    // Steering scales with speed (can't spin in place)
    const speedFactor = Math.max(-1, Math.min(1, vF / 8));
    const turnRate = 2.5 * st.grip * (this.drifting ? 1.4 : 1) * (this.boosting ? 0.8 : 1);
    this.heading += input.steer * turnRate * speedFactor * dt * (this.onGround ? 1 : 0.4);
    this.steerVis += (input.steer - this.steerVis) * Math.min(1, dt * 10);

    // Lateral grip: low while drifting so the kart slides
    const grip = this.onGround ? (this.drifting ? 1.6 : 10 * st.grip) : 0.3;
    const keep = Math.exp(-grip * dt);
    latX *= keep;
    latZ *= keep;

    const nf = this.forward();
    this.vel.x = nf.x * vF + latX;
    this.vel.z = nf.z * vF + latZ;

    // Slopes: roll down hills and into craters
    const ground = (x, z) => world.groundAt(x, z);
    if (world.terrain && this.onGround) {
      const gx = (ground(this.pos.x + 0.8, this.pos.z) - ground(this.pos.x - 0.8, this.pos.z)) / 1.6;
      const gz = (ground(this.pos.x, this.pos.z + 0.8) - ground(this.pos.x, this.pos.z - 0.8)) / 1.6;
      this.vel.x -= gx * 22 * dt;
      this.vel.z -= gz * 22 * dt;
    }

    // Vertical
    const wasGround = this.onGround;
    this.vel.y -= GRAVITY * dt;
    this.pos.addScaledVector(this.vel, dt);
    const gy = ground(this.pos.x, this.pos.z);
    if (this.pos.y <= gy || (wasGround && this.vel.y <= 0 && this.pos.y - gy < 0.5)) {
      // Landed, or following the ground down a gentle slope
      if (!wasGround && this.vel.y < -12) ev.impact = Math.max(ev.impact, -this.vel.y * 0.4);
      this.pos.y = gy;
      this.vel.y = 0;
      this.onGround = true;
    } else {
      this.onGround = this.pos.y < gy + 0.05;
    }

    // Jump pads
    this.padCooldown -= dt;
    if (this.onGround && this.padCooldown <= 0) {
      for (const p of world.pads) {
        const dx = this.pos.x - p.x, dz = this.pos.z - p.z;
        if (dx * dx + dz * dz < p.r * p.r) {
          this.vel.y = 19;
          this.pos.y += 0.1;
          this.onGround = false;
          this.padCooldown = 0.5;
          ev.jumped = true;
          break;
        }
      }
    }

    ev.impact = Math.max(ev.impact, collideWorld(world, this.pos, this.vel, KART_RADIUS));

    // Kart vs kart bumping (we only move ourselves; the other side does the same)
    for (const o of others) {
      if (o === this || !o.alive) continue;
      const dx = this.pos.x - o.pos.x, dz = this.pos.z - o.pos.z;
      if (Math.abs(this.pos.y - o.pos.y) > 2) continue;
      const d2 = dx * dx + dz * dz, min = KART_RADIUS * 2;
      if (d2 < min * min && d2 > 1e-6) {
        const d = Math.sqrt(d2), nx = dx / d, nz = dz / d;
        this.pos.x += nx * (min - d) * 0.6;
        this.pos.z += nz * (min - d) * 0.6;
        const rel = (this.vel.x - o.vel.x) * nx + (this.vel.z - o.vel.z) * nz;
        if (rel < 0) {
          this.vel.x -= nx * rel * 0.9;
          this.vel.z -= nz * rel * 0.9;
          ev.impact = Math.max(ev.impact, -rel);
        }
      }
    }

    // Weapon heat
    this.heat = Math.max(0, this.heat - dt * (this.overheated ? 0.45 : 0.6));
    if (this.overheated && this.heat <= 0.25) this.overheated = false;
    this.cooldown -= dt;
    this.rocketCooldown -= dt;

    return ev;
  }

  setNet(e, now) {
    // e = [id, x, y, z, vx, vy, vz, heading, aimYaw, aimPitch, hp, alive, boosting, shielded]
    const alive = !!e[11];
    const wasAlive = this.alive;
    this.netPos.set(e[1], e[2], e[3]);
    this.netVel.set(e[4], e[5], e[6]);
    this.netHeading = e[7];
    this.netAim = e[8];
    this.netPitch = e[9];
    this.hp = e[10];
    this.alive = alive;
    this.boosting = !!e[12];
    this.shielded = !!e[13];
    this.netTime = now;
    if (!this.hasNet || (alive && !wasAlive) || this.pos.distanceTo(this.netPos) > 12) {
      this.pos.copy(this.netPos);
      this.vel.copy(this.netVel);
      this.heading = this.netHeading;
      this.aimYaw = this.netAim;
      this.aimPitch = this.netPitch;
    }
    this.hasNet = true;
  }

  /** Smooth remote karts toward an extrapolated network position. */
  updateRemote(dt, now) {
    const age = Math.min((now - this.netTime) / 1000, 0.25);
    const tx = this.netPos.x + this.netVel.x * age;
    const ty = Math.max(0, this.netPos.y + this.netVel.y * age);
    const tz = this.netPos.z + this.netVel.z * age;
    const k = 1 - Math.exp(-14 * dt);
    this.pos.x += (tx - this.pos.x) * k;
    this.pos.y += (ty - this.pos.y) * k;
    this.pos.z += (tz - this.pos.z) * k;
    this.vel.lerp(this.netVel, k);
    const prev = this.heading;
    this.heading = lerpAngle(this.heading, this.netHeading, k);
    this.aimYaw = lerpAngle(this.aimYaw, this.netAim, k);
    this.aimPitch += (this.netPitch - this.aimPitch) * k;
    const turn = angleDiff(prev, this.heading) / Math.max(dt, 1e-3);
    this.steerVis += (Math.max(-1, Math.min(1, turn / 2)) - this.steerVis) * Math.min(1, dt * 8);
  }

  updateVisual(dt, now) {
    this.root.visible = this.alive;
    if (!this.alive) return;
    this.root.position.copy(this.pos);
    this.body.rotation.y = this.heading;
    const fwd = this.forward();
    const vF = this.vel.x * fwd.x + this.vel.z * fwd.z;
    this.wheelSpin += (vF * dt) / 0.45;
    for (const w of this.wheels) w.rotation.x = this.wheelSpin;
    for (const p of this.frontPivots) p.rotation.y = this.steerVis * 0.45;
    // Lean into turns
    // Tilt to match the ground (hills and craters)
    let pitch = 0, roll = 0;
    const w = this.world;
    const gy = w ? w.groundAt(this.pos.x, this.pos.z) : 0;
    if (w?.terrain && this.pos.y < gy + 0.3) {
      const r = this.rightVec || (this.rightVec = fwd.clone());
      r.set(Math.cos(this.heading), 0, -Math.sin(this.heading));
      const ahead = w.groundAt(this.pos.x + fwd.x * 1.4, this.pos.z + fwd.z * 1.4) - w.groundAt(this.pos.x - fwd.x * 1.4, this.pos.z - fwd.z * 1.4);
      const left = w.groundAt(this.pos.x + r.x * 1.1, this.pos.z + r.z * 1.1) - w.groundAt(this.pos.x - r.x * 1.1, this.pos.z - r.z * 1.1);
      pitch = -Math.atan(ahead / 2.8);
      roll = Math.atan(left / 2.2);
    }
    this.body.rotation.order = 'YXZ';
    this.tiltP = (this.tiltP || 0) + (pitch - (this.tiltP || 0)) * Math.min(1, dt * 12);
    this.tiltR = (this.tiltR || 0) + (roll - (this.tiltR || 0)) * Math.min(1, dt * 12);
    this.body.rotation.z = -this.steerVis * Math.min(1, Math.abs(vF) / 25) * 0.07 + this.tiltR;
    this.body.rotation.x = this.pos.y > gy + 0.05 ? -0.12 : this.tiltP;
    this.turret.rotation.y = this.aimYaw;
    this.barrel.rotation.x = -this.aimPitch;
    const shielded = this.local || this.bot ? now < this.shieldUntil : this.shielded;
    this.shield.visible = shielded;
    if (shielded) this.shield.material.opacity = 0.15 + Math.sin(now * 0.02) * 0.08;
    for (const f of this.flames) {
      f.visible = this.boosting;
      if (this.boosting) f.scale.set(1, 0.7 + Math.random() * 0.8, 1);
    }
    if (this.tag) this.drawTag();
  }

  muzzleWorld(out) {
    this.root.updateMatrixWorld(true);
    return this.muzzle.getWorldPosition(out);
  }

  /** Swap to a different car body (used when respawning with a new pick). */
  setCar(type) {
    if (!CARS[type] || type === this.carType) return false;
    const visible = this.root.visible;
    this.dispose();
    this.carType = type;
    this.stats = CARS[type];
    this.maxHp = this.stats.hp;
    this.hp = Math.min(this.hp, this.maxHp);
    this.buildMesh();
    this.root.visible = visible;
    return true;
  }

  dispose() {
    this.scene.remove(this.root);
    this.root.traverse((o) => {
      if (o.geometry) o.geometry.dispose();
      if (o.material) {
        if (o.material.map) o.material.map.dispose();
        o.material.dispose();
      }
    });
  }
}
