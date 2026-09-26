import { pointBlocked } from './arena.js';
import { angleDiff } from './kart.js';

export const BOT_NAMES = ['Turbo Tina', 'Crash Carl', 'Nitro Nick', 'Drift Dana', 'Rusty Bolt', 'Blaze', 'Skid Vicious', 'Gearbox Gus'];

export function lineOfSight(world, a, b) {
  const dx = b.x - a.x, dy = b.y - a.y, dz = b.z - a.z;
  const len = Math.hypot(dx, dy, dz);
  const steps = Math.ceil(len / 1.5);
  for (let i = 1; i < steps; i++) {
    const t = i / steps;
    if (pointBlocked(world, a.x + dx * t, a.y + dy * t, a.z + dz * t)) return false;
  }
  return true;
}

/** Simple AI driver for enemy karts. Runs on the host only. */
export class BotBrain {
  constructor(world) {
    this.world = world;
    this.target = null;
    this.retarget = 0;
    this.wander = this.randomPoint();
    this.stuckT = 0;
    this.reverseT = 0;
    this.aimErr = 0;
    this.orbit = Math.random() < 0.5 ? 1 : -1;
    this.burst = 0;
    this.rest = 0;
  }

  randomPoint() {
    const h = this.world.half - 12;
    for (;;) {
      const x = (Math.random() * 2 - 1) * h, z = (Math.random() * 2 - 1) * h;
      if (!pointBlocked(this.world, x, this.world.groundAt(x, z) + 1, z, 3)) return { x, z };
    }
  }

  think(dt, bot, karts, items, now) {
    const input = { throttle: 1, steer: 0, boost: false, drift: false, fire: false, rocket: false };
    const world = this.world;

    // Pick a target: nearest living kart, humans slightly preferred
    this.retarget -= dt;
    if (this.retarget <= 0 || !this.target || !this.target.alive) {
      this.retarget = 1.2 + Math.random();
      let best = null, bestD = 130;
      for (const k of karts) {
        if (k === bot || !k.alive) continue;
        let d = k.pos.distanceTo(bot.pos);
        if (!k.bot) d *= 0.75;
        if (d < bestD) { bestD = d; best = k; }
      }
      this.target = best;
      if (Math.random() < 0.2) this.orbit *= -1;
    }

    // Where to drive
    let gx, gz;
    const t = this.target;
    const lowHp = bot.hp < 35;
    const healthItem = lowHp ? nearestItem(items, 'health', bot.pos) : null;
    const rocketItem = bot.rockets === 0 ? nearestItem(items, 'rocket', bot.pos) : null;
    const weaponItem = !Object.keys(bot.inv || {}).length ? nearestItem(items, 'weapon', bot.pos) : null;
    if (healthItem) {
      gx = healthItem.x; gz = healthItem.z;
    } else if (weaponItem && weaponItem.dist < 45) {
      gx = weaponItem.x; gz = weaponItem.z;
    } else if (t) {
      const dx = t.pos.x - bot.pos.x, dz = t.pos.z - bot.pos.z;
      const d = Math.hypot(dx, dz);
      if (rocketItem && rocketItem.dist < 35 && d > 25) {
        gx = rocketItem.x; gz = rocketItem.z;
      } else if (d > 28) {
        gx = t.pos.x; gz = t.pos.z;
      } else {
        // Circle-strafe around the target
        const px = -dz / d, pz = dx / d;
        gx = t.pos.x + px * 18 * this.orbit - (dx / d) * 6;
        gz = t.pos.z + pz * 18 * this.orbit - (dz / d) * 6;
      }
    } else {
      const d = Math.hypot(this.wander.x - bot.pos.x, this.wander.z - bot.pos.z);
      if (d < 8) this.wander = this.randomPoint();
      gx = this.wander.x; gz = this.wander.z;
    }

    const desired = Math.atan2(gx - bot.pos.x, gz - bot.pos.z);
    let diff = angleDiff(bot.heading, desired);
    input.steer = Math.max(-1, Math.min(1, diff * 2.2));
    if (Math.abs(diff) > 1.8) input.throttle = 0.5;

    // Obstacle avoidance feelers
    const probe = (ang, dist) => {
      const a = bot.heading + ang;
      const x = bot.pos.x + Math.sin(a) * dist, z = bot.pos.z + Math.cos(a) * dist;
      return pointBlocked(world, x, Math.max(world.groundAt(x, z), bot.pos.y) + 1, z, 1.2);
    };
    const leftBlocked = probe(0.45, 7) || probe(0.2, 11);
    const rightBlocked = probe(-0.45, 7) || probe(-0.2, 11);
    if (leftBlocked && !rightBlocked) input.steer = -1;
    else if (rightBlocked && !leftBlocked) input.steer = 1;
    else if (leftBlocked && rightBlocked) {
      input.steer = diff >= 0 ? 1 : -1;
      input.throttle = 0.4;
    }

    // Unstick: reverse out if we are pushing into something
    const fwd = bot.forward();
    const speed = bot.vel.x * fwd.x + bot.vel.z * fwd.z;
    if (this.reverseT > 0) {
      this.reverseT -= dt;
      input.throttle = -1;
      input.steer = -input.steer || 1;
    } else if (Math.abs(speed) < 3) {
      this.stuckT += dt;
      if (this.stuckT > 0.8) {
        this.reverseT = 0.9;
        this.stuckT = 0;
      }
    } else this.stuckT = 0;

    input.boost = Math.abs(diff) < 0.25 && bot.boost > 0.5 && (!t || t.pos.distanceTo(bot.pos) > 40);
    input.drift = Math.abs(diff) > 1.1 && speed > 20;

    // Aiming and shooting
    if (t) {
      const dist = t.pos.distanceTo(bot.pos);
      const lead = dist / 110;
      const tx = t.pos.x + t.vel.x * lead, tz = t.pos.z + t.vel.z * lead, ty = t.pos.y + 1;
      this.aimErr += (Math.random() - 0.5) * dt * 0.8;
      this.aimErr *= 0.97;
      const wantYaw = Math.atan2(tx - bot.pos.x, tz - bot.pos.z) + this.aimErr;
      const d = angleDiff(bot.aimYaw, wantYaw);
      const maxTurn = 3.2 * dt;
      bot.aimYaw += Math.max(-maxTurn, Math.min(maxTurn, d));
      const horiz = Math.hypot(tx - bot.pos.x, tz - bot.pos.z);
      bot.aimPitch = Math.atan2(ty - (bot.pos.y + 2.2), horiz);

      const eye = { x: bot.pos.x, y: bot.pos.y + 2.2, z: bot.pos.z };
      const aimOk = Math.abs(d) < 0.12 && dist < 75 && now > bot.shieldUntil - 1500;
      if (aimOk && lineOfSight(world, eye, { x: t.pos.x, y: t.pos.y + 1, z: t.pos.z })) {
        // Fire in bursts so bots don't laser players down
        this.rest -= dt;
        if (this.rest <= 0) {
          input.fire = true;
          this.burst += dt;
          if (this.burst > 0.6 + Math.random() * 0.5) {
            this.burst = 0;
            this.rest = 0.6 + Math.random() * 0.9;
          }
        }
        if (bot.rockets > 0 && dist < 50 && dist > 8 && Math.random() < dt * 0.6) input.rocket = true;
      }
    } else {
      bot.aimYaw += angleDiff(bot.aimYaw, bot.heading) * Math.min(1, dt * 3);
      bot.aimPitch = 0;
    }

    return input;
  }
}

function nearestItem(items, type, pos) {
  let best = null, bestD = Infinity;
  for (const it of items.values()) {
    if (!it.active || it.type !== type) continue;
    const d = Math.hypot(it.x - pos.x, it.z - pos.z);
    if (d < bestD) { bestD = d; best = it; }
  }
  return best && bestD < 70 ? { x: best.x, z: best.z, dist: bestD } : null;
}
