import * as THREE from 'three';

/**
 * Battle-mode arsenal, inspired by the Raze flash games. Keys 1-9 and 0
 * select weapons; 2-0 come from pickups. Rockets stay on right click.
 *
 * Fields: speed (units/s), dmg (direct hit), life (s), cooldown (s),
 * ammo (per pickup), spread (radians), pellets, gravity, lob (extra upward aim),
 * bounces, homing (turn rate), sticky + fuse, splash + splashDmg (+ dig radius),
 * burn (seconds on fire), chain (extra targets), hitscan + range, radius (hit size).
 */
export const WEAPONS = {
  // Speeds are spread out so every gun feels different: from the drifting
  // bubbles and seeking needles up to the near-instant Holy Grail. Lives are
  // set so each keeps its old range.
  blaster: { slot: 1, name: 'Blaster', icon: '⚡', color: null, speed: 105, dmg: 9, life: 1.2, cooldown: 0.11, heat: 0.075, mesh: 'bolt', sfx: 'blaster' },
  shotgun: { slot: 2, name: 'Blunderbuss', icon: '💥', color: '#ffd166', speed: 170, dmg: 7, life: 0.24, cooldown: 0.8, ammo: 12, pellets: 8, spread: 0.1, mesh: 'pellet', sfx: 'shotgun' },
  minigun: { slot: 3, name: 'Laser Minigun', icon: '🔴', color: '#ff3b3b', speed: 240, dmg: 4, life: 0.5, cooldown: 0.05, ammo: 160, spread: 0.055, mesh: 'laser', sfx: 'laser' },
  hail: { slot: 4, name: 'Hail Storm', icon: '🧊', color: '#bfefff', speed: 62, dmg: 15, life: 3, cooldown: 0.22, ammo: 30, gravity: 30, lob: 0.12, bounces: 3, radius: 0.35, mesh: 'ball', sfx: 'hail' },
  bubble: { slot: 5, name: 'Bubble Blaster', icon: '🫧', color: '#6ad7ff', speed: 26, dmg: 13, life: 5.5, cooldown: 0.3, ammo: 25, homing: 2.4, radius: 0.5, mesh: 'bubble', sfx: 'bubble' },
  grenade: { slot: 6, name: 'Grenade Launcher', icon: '🟢', color: '#7dff5a', speed: 50, dmg: 0, life: 6, cooldown: 0.7, ammo: 10, gravity: 32, lob: 0.18, sticky: true, fuse: 1, splash: 6.5, splashDmg: 42, dig: 3.5, mesh: 'grenade', sfx: 'grenade' },
  flame: { slot: 7, name: 'Flamethrower', icon: '🔥', color: '#ff7b1c', speed: 40, dmg: 3, life: 0.45, cooldown: 0.05, ammo: 220, spread: 0.09, gravity: -8, burn: 2, radius: 0.9, mesh: 'flame', sfx: 'flame' },
  electro: { slot: 8, name: 'Electro Bolt', icon: '🌩️', color: '#b28dff', speed: 75, dmg: 22, life: 2.1, cooldown: 0.55, ammo: 16, chain: 3, chainRange: 26, chainDmg: 14, radius: 0.2, mesh: 'orb', sfx: 'zap' },
  beam: { slot: 9, name: 'Focus Beam', icon: '🟩', color: '#39ff14', dmg: 4.5, cooldown: 0.1, ammo: 110, hitscan: true, range: 75, sfx: 'beam' },
  sniper: { slot: 0, name: 'Holy Grail', icon: '☀️', color: '#ffe066', speed: 640, dmg: 85, life: 0.4, cooldown: 1.6, ammo: 6, mesh: 'tracer', sfx: 'sniper' },
  // Needler (key -): pink crystal needles that home in and stick. Seven stuck
  // in one car within a few seconds set off a supercombine explosion.
  needler: { slot: 11, key: '-', name: 'Needler', icon: '💗', color: '#ff4fd8', speed: 58, dmg: 4, life: 2.6, cooldown: 0.09, ammo: 70, spread: 0.03, homing: 3.4, radius: 0.1, needle: true, mesh: 'needle', sfx: 'needle' },
  rocket: { slot: null, name: 'Rocket', icon: '🚀', color: '#ffb703', speed: 52, dmg: 45, life: 3.1, cooldown: 0.9, splash: 7.5, splashDmg: 38, dig: 5, mesh: 'rocket', sfx: 'rocket' },
};

/** Weapons in key order: 1..9 then 0. */
export const SLOTS = Object.keys(WEAPONS)
  .filter((k) => WEAPONS[k].slot != null)
  .sort((a, b) => ((WEAPONS[a].slot || 10) - (WEAPONS[b].slot || 10)));

export const MAX_AMMO_MULT = 2; // you can stack up to two pickups' worth

const geo = {};
const mats = new Map();
const mat = (key, make) => {
  if (!mats.has(key)) mats.set(key, make());
  return mats.get(key);
};
const glow = (color, opacity = 0.85) =>
  new THREE.MeshBasicMaterial({ color, transparent: true, opacity, blending: THREE.AdditiveBlending, depthWrite: false });

/**
 * Build the mesh for one projectile. Meshes point down +Z.
 * Returns { mesh, ownMat } where ownMat is a per-projectile material to dispose.
 */
export function projectileMesh(w, key, ownerColor) {
  const c = w.color || ownerColor;
  const g = new THREE.Group();
  let ownMat = null;
  switch (w.mesh) {
    case 'bolt': {
      g.add(new THREE.Mesh((geo.boltCore ||= new THREE.CylinderGeometry(0.07, 0.07, 2.2, 6).rotateX(Math.PI / 2)), mat('boltCore', () => new THREE.MeshBasicMaterial({ color: '#fff' }))));
      g.add(new THREE.Mesh((geo.boltGlow ||= new THREE.CylinderGeometry(0.2, 0.2, 2.6, 8).rotateX(Math.PI / 2)), mat(`glow${c}`, () => glow(c, 0.7))));
      break;
    }
    case 'pellet':
      g.add(new THREE.Mesh((geo.pellet ||= new THREE.CylinderGeometry(0.08, 0.08, 1.1, 5).rotateX(Math.PI / 2)), mat('pellet', () => glow(c, 0.95))));
      break;
    case 'laser':
      g.add(new THREE.Mesh((geo.laser ||= new THREE.CylinderGeometry(0.06, 0.06, 3.2, 5).rotateX(Math.PI / 2)), mat('laser', () => glow(c, 0.95))));
      break;
    case 'ball':
      g.add(new THREE.Mesh((geo.ball ||= new THREE.IcosahedronGeometry(0.42, 1)), mat('hail', () => new THREE.MeshStandardMaterial({ color: c, roughness: 0.15, metalness: 0.1, emissive: '#3aa0c8', emissiveIntensity: 0.4 }))));
      break;
    case 'bubble':
      g.add(new THREE.Mesh((geo.bubble ||= new THREE.SphereGeometry(0.6, 16, 12)), mat('bubble', () => new THREE.MeshBasicMaterial({ color: c, transparent: true, opacity: 0.45, depthWrite: false }))));
      g.add(new THREE.Mesh((geo.bubbleCore ||= new THREE.SphereGeometry(0.22, 8, 6)), mat('bubbleCore', () => glow('#ffffff', 0.9))));
      break;
    case 'grenade':
      g.add(new THREE.Mesh((geo.grenade ||= new THREE.SphereGeometry(0.4, 12, 10)), mat('grenade', () => glow(c, 1))));
      g.add(new THREE.Mesh((geo.grenadeHalo ||= new THREE.SphereGeometry(0.8, 12, 10)), mat('grenadeHalo', () => glow(c, 0.25))));
      break;
    case 'flame':
      ownMat = glow(Math.random() < 0.5 ? '#ff7b1c' : '#ffb703', 0.8);
      g.add(new THREE.Mesh((geo.flame ||= new THREE.SphereGeometry(0.5, 8, 6)), ownMat));
      break;
    case 'orb':
      g.add(new THREE.Mesh((geo.orb ||= new THREE.OctahedronGeometry(0.45, 0)), mat('orb', () => glow('#ffffff', 1))));
      g.add(new THREE.Mesh((geo.orbHalo ||= new THREE.SphereGeometry(0.9, 10, 8)), mat('orbHalo', () => glow(c, 0.45))));
      break;
    case 'needle':
      g.add(new THREE.Mesh((geo.needle ||= new THREE.OctahedronGeometry(0.2, 0).scale(0.7, 0.7, 3.2)), mat('needle', () => new THREE.MeshBasicMaterial({ color: '#ffd0f4' }))));
      g.add(new THREE.Mesh((geo.needleGlow ||= new THREE.OctahedronGeometry(0.34, 0).scale(1, 1, 2.8)), mat('needleGlow', () => glow(c, 0.6))));
      break;
    case 'tracer':
      g.add(new THREE.Mesh((geo.tracer ||= new THREE.CylinderGeometry(0.09, 0.09, 9, 6).rotateX(Math.PI / 2)), mat('tracer', () => glow(c, 1))));
      break;
    case 'rocket': {
      g.add(new THREE.Mesh((geo.rBody ||= new THREE.CylinderGeometry(0.22, 0.22, 1.2, 10).rotateX(Math.PI / 2)), mat('rBody', () => new THREE.MeshStandardMaterial({ color: '#e0e0e0', metalness: 0.4 }))));
      const nose = new THREE.Mesh((geo.rNose ||= new THREE.ConeGeometry(0.22, 0.5, 10).rotateX(Math.PI / 2)), mat(`nose${ownerColor}`, () => new THREE.MeshBasicMaterial({ color: ownerColor })));
      nose.position.z = 0.85;
      const fl = new THREE.Mesh((geo.rFlame ||= new THREE.SphereGeometry(0.3, 8, 6)), mat('rFlame', () => glow('#ffb703', 1)));
      fl.position.z = -0.75;
      g.add(nose, fl);
      break;
    }
  }
  return { mesh: g, ownMat };
}

/** Weapons a bot would like to use at a given distance, best first. */
export function botPreference(dist) {
  if (dist < 14) return ['flame', 'shotgun', 'grenade', 'needler', 'minigun', 'electro', 'hail', 'beam', 'bubble', 'sniper'];
  if (dist < 35) return ['needler', 'electro', 'minigun', 'beam', 'hail', 'bubble', 'grenade', 'shotgun', 'sniper', 'flame'];
  return ['sniper', 'beam', 'electro', 'minigun', 'needler', 'bubble', 'hail'];
}
