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
const _n = new THREE.Vector3();
const _side = new THREE.Vector3();
const _g = new THREE.Vector3();
const _m = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const WORLD_UP = new THREE.Vector3(0, 1, 0);
const WALL_GRAVITY = 0.3; // share of gravity that drags you down a wall you're driving on
const CLING = 12; // how hard the tyres hold on to a wall or ceiling...
const CLING_PER_SPEED = 0.6; // ...plus this much per unit of speed (the ceiling needs ~37: boost)

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
    this.driftT = 0;
    this.bodyYaw = 0;
    this.draftT = 0; // time spent in another kart's slipstream
    this.drafting = false;
    this.heat = 0;
    this.overheated = false;
    this.rockets = 2;
    this.inv = {};
    this.weapon = 'blaster';
    this.burnT = 0;
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
    root.scale.setScalar(this.sizeMul || 1); // tiny / giant car option
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
    // Dual wielding: a second gun (the left hand) appears beside the first
    const barrel2 = barrel.clone();
    barrel2.visible = false;
    turret.add(barrel2);
    this.barrel2 = barrel2;
    this.muzzle2 = barrel2.children[barrel2.children.length - 1];

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
    this.inv = {}; // weapon -> ammo (the blaster is always available)
    this.weapon = 'blaster';
    this.weapon2 = 'blaster'; // left-hand gun: everyone dual wields, starting with twin Blasters
    this.cooldown2 = 0;
    this.burnT = 0;
    this.cooldown = 0;
    this.shieldUntil = now + 2000;
    this.root.visible = true;
    // Orientation on a curved arena (the cube): the surface's up and our heading along it
    this.up = new THREE.Vector3(0, 1, 0);
    this.fwd3 = this.forward().clone();
    this.onGround = true;
  }

  /**
   * Arcade kart physics. Runs for the local player and (on the host) for bots.
   * input: { throttle -1..1, steer -1..1 (+ = left), boost bool, drift bool }
   * Returns info about events (jump pad, impacts) for sound / fx.
   */
  simulate(dt, input, world, others) {
    if (world.surface) return this.simulateSurface(dt, input, world, others);
    const ev = { impact: 0, wall: 0, jumped: false };
    const fwd = this.forward();
    let vF = this.vel.x * fwd.x + this.vel.z * fwd.z;
    let latX = this.vel.x - fwd.x * vF;
    let latZ = this.vel.z - fwd.z * vF;

    // Drifting works like race mode: hold drift while steering at speed to
    // slide the tail out, and the longer the drift the more nitro it charges
    this.drifting = input.drift && vF > 8 && this.onGround && Math.abs(input.steer) > 0.1;
    this.driftT = this.drifting ? this.driftT + dt : 0;
    const draft = this.slipstream(fwd, vF, others, dt);

    this.boosting = input.boost && input.throttle > 0 && this.boost > 0.02;
    if (this.boosting && !this.endless) this.boost = Math.max(0, this.boost - dt * 0.38);
    else this.boost = Math.min(1, this.boost + dt * (this.drifting ? 0.3 : 0.12) + dt * 0.12 * draft);
    if (this.boost <= 0.02) this.boosting = false;

    const control = this.onGround ? 1 : 0.25;

    // Throttle / brake
    const st = this.stats;
    const top = (this.boosting ? MAX_SPEED + (BOOST_SPEED - MAX_SPEED) * st.boost : MAX_SPEED) * st.speed * (1 + 0.1 * draft);
    if (input.throttle > 0) {
      if (vF < top) vF += (this.boosting ? 62 * st.boost : 34) * st.accel * input.throttle * dt * control * (1 + 0.6 * draft);
    } else if (input.throttle < 0) {
      if (vF > 0.5) vF -= 48 * dt * control;
      else if (vF > -REVERSE_SPEED) vF -= 22 * dt * control;
    } else {
      const f = 9 * dt * control;
      vF = Math.abs(vF) < f ? 0 : vF - Math.sign(vF) * f;
    }
    if (vF > top) vF -= (vF - top) * 2.5 * dt;
    if (input.drift && this.onGround && vF <= 8) vF *= 1 - 1.5 * dt; // handbrake at low speed

    // Steering scales with speed (can't spin in place)
    const speedFactor = Math.max(-1, Math.min(1, vF / 8));
    const turnRate = 2.5 * st.grip * st.handling * (this.drifting ? 1.4 : 1) * (this.boosting ? 0.8 : 1);
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

    const rad = KART_RADIUS * (this.sizeMul || 1);
    ev.wall = collideWorld(world, this.pos, this.vel, rad); // speed into walls and cover
    ev.impact = Math.max(ev.impact, ev.wall);

    // Kart vs kart bumping (we only move ourselves; the other side does the same)
    for (const o of others) {
      if (o === this || !o.alive) continue;
      const dx = this.pos.x - o.pos.x, dz = this.pos.z - o.pos.z;
      if (Math.abs(this.pos.y - o.pos.y) > 2) continue;
      const d2 = dx * dx + dz * dz, min = rad + KART_RADIUS * (o.sizeMul || 1);
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
    this.cooldown2 -= dt;
    this.rocketCooldown -= dt;

    return ev;
  }

  /**
   * Driving on the inside of a curved arena (the cube): the kart follows the
   * surface up the rounded edges, along the walls and over the ceiling. Its
   * tyres cling harder the faster it goes; when gravity pulling it off the
   * surface beats that grip (the ceiling, at low speed) it drops off.
   */
  simulateSurface(dt, input, world, others) {
    const ev = { impact: 0, wall: 0, jumped: false };
    const S = world.surface, st = this.stats;
    const up = (this.up ||= new THREE.Vector3(0, 1, 0));
    const fwd = (this.fwd3 ||= this.forward().clone());
    fwd.addScaledVector(up, -fwd.dot(up));
    if (fwd.lengthSq() < 1e-6) fwd.set(0, 0, 1).addScaledVector(up, -up.z);
    fwd.normalize();
    const side = _side.crossVectors(up, fwd); // points to the kart's left
    let vF = this.vel.dot(fwd), vL = this.vel.dot(side);
    const vN = this.vel.dot(up);

    this.drifting = input.drift && vF > 8 && this.onGround && Math.abs(input.steer) > 0.1;
    this.driftT = this.drifting ? this.driftT + dt : 0;
    const draft = this.slipstream(fwd, vF, others, dt);
    this.boosting = input.boost && input.throttle > 0 && this.boost > 0.02;
    if (this.boosting && !this.endless) this.boost = Math.max(0, this.boost - dt * 0.38);
    else this.boost = Math.min(1, this.boost + dt * (this.drifting ? 0.3 : 0.12) + dt * 0.12 * draft);
    if (this.boost <= 0.02) this.boosting = false;

    const control = this.onGround ? 1 : 0.25;
    const top = (this.boosting ? MAX_SPEED + (BOOST_SPEED - MAX_SPEED) * st.boost : MAX_SPEED) * st.speed * (1 + 0.1 * draft);
    if (input.throttle > 0) {
      if (vF < top) vF += (this.boosting ? 62 * st.boost : 34) * st.accel * input.throttle * dt * control * (1 + 0.6 * draft);
    } else if (input.throttle < 0) {
      if (vF > 0.5) vF -= 48 * dt * control;
      else if (vF > -REVERSE_SPEED) vF -= 22 * dt * control;
    } else {
      const f = 9 * dt * control;
      vF = Math.abs(vF) < f ? 0 : vF - Math.sign(vF) * f;
    }
    if (vF > top) vF -= (vF - top) * 2.5 * dt;
    if (input.drift && this.onGround && vF <= 8) vF *= 1 - 1.5 * dt;

    const speedFactor = Math.max(-1, Math.min(1, vF / 8));
    const turnRate = 2.5 * st.grip * st.handling * (this.drifting ? 1.4 : 1) * (this.boosting ? 0.8 : 1);
    fwd.applyAxisAngle(up, input.steer * turnRate * speedFactor * dt * (this.onGround ? 1 : 0.4));
    side.crossVectors(up, fwd);
    this.steerVis += (input.steer - this.steerVis) * Math.min(1, dt * 10);
    vL *= Math.exp(-(this.onGround ? (this.drifting ? 1.6 : 10 * st.grip) : 0.3) * dt);
    this.vel.copy(fwd).multiplyScalar(vF).addScaledVector(side, vL).addScaledVector(up, vN);

    // Gravity. On a surface only part of its pull along the surface counts
    // (so walls are drivable); the part pulling us off it is fought by grip
    _g.set(0, -GRAVITY, 0);
    const wasGround = this.onGround;
    let attached = false;
    if (wasGround) {
      const gn = _g.dot(up); // < 0 presses into the surface, > 0 pulls away
      const cling = CLING + CLING_PER_SPEED * Math.abs(vF);
      attached = gn - cling < 0;
      if (attached) this.vel.addScaledVector(_g.addScaledVector(up, -gn), (up.y > 0.95 ? 1 : WALL_GRAVITY) * dt);
      else this.vel.addScaledVector(_g, dt);
    } else this.vel.addScaledVector(_g, dt);
    this.pos.addScaledVector(this.vel, dt);

    // Stay inside the shell: land on it, or keep hugging it while attached
    const d = S.sdf(this.pos);
    S.normal(this.pos, _n);
    if (d > 0 || (attached && d > -1.5)) {
      this.pos.addScaledVector(_n, -d);
      const vn = this.vel.dot(_n);
      if (vn > 0) {
        if (!wasGround && vn > 12) ev.impact = Math.max(ev.impact, vn * 0.4);
        this.vel.addScaledVector(_n, -vn);
      }
      this.onGround = true;
    } else this.onGround = false;

    // Turn to match the surface (or right ourselves in the air)
    const target = this.onGround ? _v.copy(_n).negate() : WORLD_UP;
    up.lerp(target, Math.min(1, dt * (this.onGround ? 14 : 1.6))).normalize();
    fwd.addScaledVector(up, -fwd.dot(up)).normalize();
    this.heading = Math.atan2(fwd.x, fwd.z);

    // Jump pads on the floor
    this.padCooldown -= dt;
    if (this.onGround && up.y > 0.9 && this.padCooldown <= 0) {
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

    // Kart vs kart bumping, in 3D
    const rad = KART_RADIUS * (this.sizeMul || 1);
    for (const o of others) {
      if (o === this || !o.alive) continue;
      _v.subVectors(this.pos, o.pos);
      const d2 = _v.lengthSq(), min = rad + KART_RADIUS * (o.sizeMul || 1);
      if (d2 < min * min && d2 > 1e-6) {
        const dd = Math.sqrt(d2);
        _v.divideScalar(dd);
        this.pos.addScaledVector(_v, (min - dd) * 0.6);
        const rel = _n.subVectors(this.vel, o.vel).dot(_v);
        if (rel < 0) {
          this.vel.addScaledVector(_v, -rel * 0.9);
          ev.impact = Math.max(ev.impact, -rel);
        }
      }
    }

    this.heat = Math.max(0, this.heat - dt * (this.overheated ? 0.45 : 0.6));
    if (this.overheated && this.heat <= 0.25) this.overheated = false;
    this.cooldown -= dt;
    this.cooldown2 -= dt;
    this.rocketCooldown -= dt;
    return ev;
  }

  /**
   * Drafting: close behind another kart heading the same way, its slipstream
   * pulls you along. Returns the draft strength (0..1) after a short build-up.
   */
  slipstream(fwd, vF, others, dt) {
    let tow = false;
    if (vF > 18 && this.onGround) {
      for (const o of others) {
        if (o === this || !o.alive) continue;
        const dx = o.pos.x - this.pos.x, dz = o.pos.z - this.pos.z;
        const ahead = dx * fwd.x + dz * fwd.z;
        if (ahead < 2.5 || ahead > 20) continue;
        if (Math.abs(dx * fwd.z - dz * fwd.x) > 1.6 + ahead * 0.05) continue;
        const ov = o.vel.x * fwd.x + o.vel.z * fwd.z; // its speed our way
        if (ov > 14) {
          tow = true;
          break;
        }
      }
    }
    this.draftT = tow ? Math.min(1.2, this.draftT + dt) : Math.max(0, this.draftT - dt * 2.5);
    const draft = Math.max(0, Math.min(1, (this.draftT - 0.25) / 0.6));
    this.drafting = draft > 0;
    return draft;
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
    this.drifting = !!e[14];
    this.dual = !!e[15];
    if (e.length > 21) {
      // Orientation on a curved arena: surface up and heading along it
      (this.netUp ||= new THREE.Vector3()).set(e[16], e[17], e[18]);
      (this.netFwd ||= new THREE.Vector3()).set(e[19], e[20], e[21]);
      if (this.netUp.lengthSq() < 0.01) this.netUp.set(0, 1, 0);
      if (this.netFwd.lengthSq() < 0.01) this.netFwd.set(0, 0, 1);
      this.netUp.normalize();
      this.netFwd.normalize();
      if (!this.up) {
        this.up = this.netUp.clone();
        this.fwd3 = this.netFwd.clone();
      }
    }
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
    const ty = this.netUp ? this.netPos.y + this.netVel.y * age : Math.max(0, this.netPos.y + this.netVel.y * age);
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
    if (this.netUp) {
      this.up.lerp(this.netUp, k).normalize();
      this.fwd3.lerp(this.netFwd, k).addScaledVector(this.up, -this.fwd3.dot(this.up));
      if (this.fwd3.lengthSq() < 1e-4) this.fwd3.copy(this.netFwd);
      this.fwd3.normalize();
    }
    const turn = angleDiff(prev, this.heading) / Math.max(dt, 1e-3);
    this.steerVis += (Math.max(-1, Math.min(1, turn / 2)) - this.steerVis) * Math.min(1, dt * 8);
  }

  updateVisual(dt, now) {
    this.root.visible = this.alive;
    if (!this.alive) return;
    this.root.position.copy(this.pos);
    if (!this.local && !this.bot) this.driftT = this.drifting ? this.driftT + dt : 0;
    // Drifting: swing the tail out hard (as in race mode)
    const yawTarget = this.drifting ? this.steerVis * 0.65 : 0;
    this.bodyYaw += (yawTarget - this.bodyYaw) * Math.min(1, dt * (this.drifting ? 7 : 5));
    // On a curved arena the whole kart turns to the surface it's driving on
    const curved = !!this.world?.surface && this.up && this.fwd3;
    if (curved) {
      _side.crossVectors(this.up, this.fwd3);
      this.root.quaternion.setFromRotationMatrix(_m.makeBasis(_side, this.up, this.fwd3));
    } else this.root.quaternion.identity();
    this.body.rotation.y = (curved ? 0 : this.heading) + this.bodyYaw;
    const fwd = this.forward();
    const vF = this.vel.x * fwd.x + this.vel.z * fwd.z;
    this.wheelSpin += (vF * dt) / 0.45;
    for (const w of this.wheels) w.rotation.x = this.wheelSpin;
    for (const p of this.frontPivots) p.rotation.y = this.drifting ? -this.steerVis * 0.35 : this.steerVis * 0.45; // counter-steer while drifting
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
    this.body.rotation.z = -this.steerVis * Math.min(1, Math.abs(vF) / 25) * (this.drifting ? 0.14 : 0.07) + this.tiltR;
    this.body.rotation.x = this.pos.y > gy + 0.05 ? -0.12 : this.tiltP;
    if (curved) {
      // Aim is in world space: turn it into the tilted kart's own frame
      const cp = Math.cos(this.aimPitch);
      _v.set(Math.sin(this.aimYaw) * cp, Math.sin(this.aimPitch), Math.cos(this.aimYaw) * cp).applyQuaternion(_q.copy(this.root.quaternion).invert());
      this.turret.rotation.y = Math.atan2(_v.x, _v.z);
      this.barrel.rotation.x = -Math.asin(Math.max(-1, Math.min(1, _v.y)));
    } else {
      this.turret.rotation.y = this.aimYaw;
      this.barrel.rotation.x = -this.aimPitch;
    }
    const dual = this.local || this.bot ? !!this.weapon2 : this.dual;
    this.barrel2.visible = dual;
    this.barrel.position.x = dual ? -0.55 : 0;
    this.barrel2.position.x = 0.55;
    this.barrel2.rotation.x = this.barrel.rotation.x;
    const shielded = this.local || this.bot ? now < this.shieldUntil : this.shielded;
    this.shield.visible = shielded;
    if (shielded) this.shield.material.opacity = 0.15 + Math.sin(now * 0.02) * 0.08;
    for (const f of this.flames) {
      f.visible = this.boosting;
      if (this.boosting) f.scale.set(1, 0.7 + Math.random() * 0.8, 1);
    }
    if (this.tag) this.drawTag();
  }

  muzzleWorld(out, gun = this.muzzle) {
    this.root.updateMatrixWorld(true);
    return gun.getWorldPosition(out);
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
