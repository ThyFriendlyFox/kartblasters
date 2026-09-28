import * as THREE from 'three';
import { buildLongtail, longtailRim, LONGTAIL_WHEELS } from './longtail.js';
import { buildSixBySix, buildShark, buildSixPack, buildDiceRod, buildStadiumF1, buildThrust } from './cars2.js';
import { buildRailBuggy, buildWedge, buildGoat, buildArmoured } from './cars3.js';

/**
 * Selectable cars. Stats are multipliers used by both battle and race physics.
 * grip = how much sideways force the tyres hold at speed; handling = how
 * tightly the car can turn (its maximum turn rate).
 */
export const CARS = {
  hyper: { name: 'Hyper', desc: '80s wedge supercar with a turbo: balanced', speed: 1.0, accel: 1.0, grip: 1.0, handling: 1.0, boost: 1.0, hp: 100 },
  muscle: { name: 'Muscle', desc: '60s muscle coupe: top speed, heavy steering', speed: 1.07, accel: 0.95, grip: 0.9, handling: 0.92, boost: 1.1, hp: 110 },
  formula: { name: 'Formula', desc: 'Stadium open-wheeler: grippy and quick, but fragile', speed: 1.04, accel: 1.05, grip: 1.15, handling: 1.08, boost: 0.95, hp: 85 },
  buggy: { name: 'Buggy', desc: 'Rail dune buggy with a whip flag: punchy, great grip', speed: 0.95, accel: 1.15, grip: 1.1, handling: 1.1, boost: 0.9, hp: 100 },
  truck: { name: 'Brute', desc: 'Armoured 4x4: slow, but takes a beating', speed: 0.92, accel: 0.88, grip: 0.95, handling: 0.9, boost: 0.85, hp: 135 },
  longtail: { name: 'Longtail 17', desc: '70s long-tail endurance racer, flat-12', speed: 1.09, accel: 0.97, grip: 0.97, handling: 0.96, boost: 1.0, hp: 90 },
  sixbysix: { name: 'Rockcrawler', desc: 'Six-wheeled off-road pickup: grippy tank', speed: 0.93, accel: 0.92, grip: 1.12, handling: 0.93, boost: 0.88, hp: 145 },
  shark: { name: 'Sharkbite', desc: 'Shark hot rod with a blown V8', speed: 1.02, accel: 1.1, grip: 0.97, handling: 0.98, boost: 1.2, hp: 95 },
  sixpack: { name: 'Six Pack', desc: 'Six-wheeled hatch, engine through the hood', speed: 1.03, accel: 1.02, grip: 1.08, handling: 1.04, boost: 1.1, hp: 105 },
  dicerod: { name: 'Dice Rod', desc: 'Patina rat rod on whitewalls', speed: 1.0, accel: 1.12, grip: 0.92, handling: 0.97, boost: 1.15, hp: 100 },
  thrust: { name: 'Soundbreaker', desc: 'Twin-jet land speed record car: huge top speed and boost, slow to spool up, turns like a train', speed: 1.14, accel: 0.78, grip: 0.9, handling: 0.55, boost: 1.3, hp: 120 },
};
export const CAR_IDS = Object.keys(CARS);

// Stat bars: each stat is scaled across the roster so differences are easy to see
const STAT_DEFS = [
  ['Acceleration', 'accel'],
  ['Top Speed', 'speed'],
  ['Boost Power', 'boost'],
  ['Grip', 'grip'],
  ['Handling', 'handling'],
  ['Health', 'hp'],
];
export function statBarsHTML(id) {
  const car = CARS[id];
  return STAT_DEFS.map(([label, key]) => {
    const vals = CAR_IDS.map((c) => CARS[c][key]);
    const lo = Math.min(...vals), hi = Math.max(...vals);
    const f = 0.18 + 0.82 * ((car[key] - lo) / (hi - lo || 1));
    return `<div class="stat"><span>${label}</span><div class="statBar"><i style="width:${(f * 100).toFixed(0)}%"></i></div></div>`;
  }).join('');
}

/**
 * Build a car mesh facing +Z with its wheels resting on y = 0.
 * Returns handles used for animation.
 */
export function buildCar(type, color) {
  const group = new THREE.Group();
  const body = new THREE.Group();
  group.add(body);
  // Per-type wheel layout: [radius, width, frontZ, rearZ, track, rearScale]
  let wheel = [0.45, 0.4, 1.3, -1.3, 1.05, 1];
  let roofY = 1.4;
  let custom = null; // detailed cars bring their own axles, tyres, rims, lights and exhausts

  switch (type) {
    case 'longtail': {
      // Fixed gold race livery; the player's color tints one pinstripe
      const L = LONGTAIL_WHEELS;
      wheel = [L.r, L.width, L.front, L.rear, L.track, L.rearScale];
      buildLongtail(body, color);
      roofY = 1.3;
      break;
    }
    case 'formula':
    case 'sixbysix':
    case 'shark':
    case 'sixpack':
    case 'dicerod':
    case 'thrust':
    case 'buggy':
    case 'muscle':
    case 'truck': {
      custom = { formula: buildStadiumF1, sixbysix: buildSixBySix, shark: buildShark, sixpack: buildSixPack, dicerod: buildDiceRod, thrust: buildThrust, buggy: buildRailBuggy, muscle: buildGoat, truck: buildArmoured }[type](body, color);
      roofY = custom.roofY;
      break;
    }
    default: {
      custom = buildWedge(body, color); // hyper
      roofY = custom.roofY;
    }
  }
  const rz = -2.4; // Longtail's exhaust flames

  // Wheels
  const [r, w, fz, rz2, track, rs] = wheel;
  const wheels = [];
  const frontPivots = [];
  const tireMat = new THREE.MeshStandardMaterial({ color: '#111', roughness: 0.9 });
  const rimMat = new THREE.MeshStandardMaterial({ color: '#e5e7eb', metalness: 0.9, roughness: 0.2 });
  const axles = custom?.axles || [
    { z: fz, r, w, track, steer: true },
    { z: rz2, r: r * rs, w, track, steer: false },
  ];
  for (const ax of axles) {
    for (const x of [ax.track, -ax.track]) {
      const pivot = new THREE.Group();
      pivot.position.set(x, ax.r, ax.z);
      body.add(pivot);
      const geo = custom?.tire ? custom.tire(ax.r, ax.w) : new THREE.CylinderGeometry(ax.r, ax.r, ax.w, 18).rotateZ(Math.PI / 2);
      const tire = new THREE.Mesh(geo, custom?.tireMat || tireMat);
      tire.castShadow = true;
      if (custom) custom.rim(tire, ax.r, ax.w);
      else if (type === 'longtail') longtailRim(tire, ax.r, ax.w);
      else tire.add(new THREE.Mesh(new THREE.CylinderGeometry(ax.r * 0.6, ax.r * 0.6, ax.w + 0.02, 6).rotateZ(Math.PI / 2), rimMat));
      pivot.add(tire);
      wheels.push(tire);
      if (ax.steer) frontPivots.push(pivot);
    }
  }

  // Boost flames
  const flameMat = new THREE.MeshBasicMaterial({ color: '#7fdcff', transparent: true, opacity: 0.9, blending: THREE.AdditiveBlending, depthWrite: false });
  const flames = [];
  for (const [x, y, z] of custom?.flames || [[0.4, 0.6, rz - 0.8], [-0.4, 0.6, rz - 0.8]]) {
    const f = new THREE.Mesh(new THREE.ConeGeometry(0.22, 1.4, 8), flameMat);
    f.rotation.x = -Math.PI / 2;
    f.position.set(x, y, custom ? z - 0.5 : z);
    f.visible = false;
    body.add(f);
    flames.push(f);
  }

  return { group, body, wheels, frontPivots, flames, roofY, wheelRadius: custom ? custom.axles[0].r : r };
}

/** Small rotating preview renderer for the menu car picker. */
export function carThumbnail(type, color, size = 96) {
  const renderer = carThumbnail.renderer ||= new THREE.WebGLRenderer({ antialias: true, alpha: true, preserveDrawingBuffer: true });
  renderer.setSize(size, size);
  const scene = new THREE.Scene();
  scene.add(new THREE.HemisphereLight('#ffffff', '#445', 2.2));
  const d = new THREE.DirectionalLight('#fff', 2);
  d.position.set(3, 5, 4);
  scene.add(d);
  const car = buildCar(type, color);
  car.group.rotation.y = -0.7;
  scene.add(car.group);
  const cam = new THREE.PerspectiveCamera(32, 1, 0.1, 50);
  cam.position.set(6, 4, 8);
  cam.lookAt(0, 0.8, 0);
  renderer.render(scene, cam);
  const url = renderer.domElement.toDataURL();
  scene.traverse((o) => {
    o.geometry?.dispose();
    o.material?.dispose?.();
  });
  return url;
}

/**
 * Wall damage (the "Wall damage" option): nothing for a light scrape, then
 * more than proportionally more the harder you hit. `speed` is how fast the
 * car was going into the wall. About 15 HP at 15, 48 at 30, 120+ at 55.
 */
export function wallDamage(speed) {
  const s = speed - 6;
  return s > 0 ? s * 1.5 + s * s * 0.02 : 0;
}
