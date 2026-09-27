import * as THREE from 'three';
import { buildLongtail, longtailRim, LONGTAIL_WHEELS } from './longtail.js';
import { buildSixBySix, buildShark, buildSixPack, buildDiceRod, buildStadiumF1, buildThrust } from './cars2.js';

/**
 * Selectable cars. Stats are multipliers used by both battle and race physics.
 * grip = how much sideways force the tyres hold at speed; handling = how
 * tightly the car can turn (its maximum turn rate).
 */
export const CARS = {
  hyper: { name: 'Hyper', desc: 'Balanced wedge-shaped supercar', speed: 1.0, accel: 1.0, grip: 1.0, handling: 1.0, boost: 1.0, hp: 100 },
  muscle: { name: 'Muscle', desc: 'Top speed, heavy steering', speed: 1.07, accel: 0.95, grip: 0.9, handling: 0.92, boost: 1.1, hp: 110 },
  formula: { name: 'Formula', desc: 'Stadium open-wheeler: grippy and quick, but fragile', speed: 1.04, accel: 1.05, grip: 1.15, handling: 1.08, boost: 0.95, hp: 85 },
  buggy: { name: 'Buggy', desc: 'Punchy acceleration, great grip', speed: 0.95, accel: 1.15, grip: 1.1, handling: 1.1, boost: 0.9, hp: 100 },
  truck: { name: 'Brute', desc: 'Slow, but takes a beating', speed: 0.92, accel: 0.88, grip: 0.95, handling: 0.9, boost: 0.85, hp: 135 },
  longtail: { name: 'Longtail 17', desc: 'Gold 70s endurance racer, flat-12', speed: 1.09, accel: 0.97, grip: 0.97, handling: 0.96, boost: 1.0, hp: 90 },
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

function profile(points, width, bevel = 0.12) {
  const s = new THREE.Shape();
  s.moveTo(points[0][0], points[0][1]);
  for (let i = 1; i < points.length; i++) s.lineTo(points[i][0], points[i][1]);
  s.closePath();
  const g = new THREE.ExtrudeGeometry(s, {
    depth: width - bevel * 2,
    bevelEnabled: true,
    bevelThickness: bevel,
    bevelSize: bevel,
    bevelSegments: 2,
  });
  g.rotateY(-Math.PI / 2); // profile x -> car +z, extrusion -> car x
  g.translate(width / 2 - bevel, 0, 0);
  return g;
}

/**
 * Build a car mesh facing +Z with its wheels resting on y = 0.
 * Returns handles used for animation.
 */
export function buildCar(type, color) {
  const group = new THREE.Group();
  const body = new THREE.Group();
  group.add(body);
  const paint = new THREE.MeshStandardMaterial({ color, roughness: 0.3, metalness: 0.15 });
  const dark = new THREE.MeshStandardMaterial({ color: '#1c1f24', roughness: 0.7 });
  const chrome = new THREE.MeshStandardMaterial({ color: '#d7dce3', roughness: 0.15, metalness: 1 });
  const glass = new THREE.MeshStandardMaterial({ color: '#0e1a2b', roughness: 0.05, metalness: 0.9 });
  const head = new THREE.MeshBasicMaterial({ color: '#fff8d6' });
  const tail = new THREE.MeshBasicMaterial({ color: '#ff2a2a' });
  const neon = new THREE.MeshBasicMaterial({ color: new THREE.Color(color).lerp(new THREE.Color('#ffffff'), 0.35) });

  const add = (geo, mat, x = 0, y = 0, z = 0, parent = body) => {
    const m = new THREE.Mesh(geo, mat);
    m.position.set(x, y, z);
    m.castShadow = true;
    parent.add(m);
    return m;
  };
  const box = (w, h, d) => new THREE.BoxGeometry(w, h, d);

  // Per-type wheel layout: [radius, width, frontZ, rearZ, track, rearScale]
  let wheel = [0.45, 0.4, 1.3, -1.3, 1.05, 1];
  let roofY = 1.4;
  let custom = null; // detailed cars bring their own axles, tyres, rims, lights and exhausts

  switch (type) {
    case 'muscle': {
      wheel = [0.46, 0.45, 1.45, -1.35, 1.0, 1.2];
      add(profile([[-2.2, 0.35], [2.2, 0.35], [2.25, 0.8], [1.2, 0.95], [-2.1, 0.95], [-2.25, 0.75]], 2.1), paint);
      add(profile([[-1.0, 0.95], [0.5, 0.95], [-0.1, 1.45], [-0.9, 1.45], [-1.5, 0.95]], 1.7, 0.08), glass);
      add(box(0.6, 0.25, 1.0), paint, 0, 1.05, 1.3); // hood scoop
      add(box(2.1, 0.08, 0.45), dark, 0, 1.3, -2.05); // spoiler
      add(box(0.12, 0.35, 0.12), dark, 0.8, 1.1, -2.05);
      add(box(0.12, 0.35, 0.12), dark, -0.8, 1.1, -2.05);
      add(box(0.2, 0.2, 0.9), neon, 0.35, 0.96, 0.2); // racing stripes
      add(box(0.2, 0.2, 0.9), neon, -0.35, 0.96, 0.2);
      for (const x of [0.25, -0.25]) add(new THREE.CylinderGeometry(0.1, 0.1, 0.6, 8).rotateX(Math.PI / 2), chrome, x, 0.45, -2.35);
      roofY = 1.5;
      break;
    }
    case 'buggy': {
      wheel = [0.62, 0.55, 1.4, -1.3, 1.2, 1.1];
      add(profile([[-1.6, 0.7], [1.8, 0.7], [2.0, 1.0], [1.3, 1.1], [-1.5, 1.1], [-1.7, 0.95]], 1.6), paint);
      // Roll cage
      const cage = new THREE.MeshStandardMaterial({ color: '#2a2d33', metalness: 0.6, roughness: 0.4 });
      for (const x of [0.7, -0.7]) {
        add(new THREE.CylinderGeometry(0.06, 0.06, 1.1, 6), cage, x, 1.6, 0.4).rotation.x = 0.35;
        add(new THREE.CylinderGeometry(0.06, 0.06, 1.0, 6), cage, x, 1.6, -0.9);
        add(new THREE.CylinderGeometry(0.06, 0.06, 1.3, 6).rotateX(Math.PI / 2), cage, x, 2.1, -0.25);
      }
      add(new THREE.CylinderGeometry(0.06, 0.06, 1.4, 6).rotateZ(Math.PI / 2), cage, 0, 2.1, 0.35);
      add(new THREE.CylinderGeometry(0.06, 0.06, 1.4, 6).rotateZ(Math.PI / 2), cage, 0, 2.1, -0.9);
      add(box(1.1, 0.25, 0.6), dark, 0, 1.2, -0.5); // seat block
      add(box(1.4, 0.3, 0.2), neon, 0, 2.1, 0.45); // light bar
      add(box(0.5, 0.5, 0.5), chrome, 0, 1.2, -1.5); // engine
      roofY = 2.3;
      break;
    }
    case 'truck': {
      wheel = [0.6, 0.55, 1.5, -1.5, 1.2, 1];
      add(profile([[-2.3, 0.6], [2.3, 0.6], [2.4, 1.2], [1.4, 1.35], [1.0, 2.1], [-2.2, 2.1], [-2.35, 1.3]], 2.3), paint);
      add(box(2.35, 0.45, 1.1), glass, 0, 1.75, 0.9);
      add(box(2.4, 0.5, 0.35), chrome, 0, 0.75, 2.45); // bull bar
      add(box(2.2, 0.15, 2.4), dark, 0, 2.22, -0.8); // roof rack
      add(box(0.5, 0.2, 0.1), head, 0.7, 1.1, 2.42);
      add(box(0.5, 0.2, 0.1), head, -0.7, 1.1, 2.42);
      roofY = 2.3;
      break;
    }
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
    case 'thrust': {
      custom = { formula: buildStadiumF1, sixbysix: buildSixBySix, shark: buildShark, sixpack: buildSixPack, dicerod: buildDiceRod, thrust: buildThrust }[type](body, color);
      roofY = custom.roofY;
      break;
    }
    default: {
      // hyper
      wheel = [0.44, 0.42, 1.4, -1.35, 1.0, 1.08];
      add(profile([[-2.2, 0.3], [2.3, 0.3], [2.35, 0.5], [0.9, 0.8], [-0.2, 1.25], [-1.6, 1.2], [-2.25, 0.85]], 2.05), paint);
      add(profile([[-1.2, 1.0], [0.7, 0.9], [-0.15, 1.27], [-1.0, 1.24]], 1.6, 0.06), glass);
      add(box(2.1, 0.07, 0.45), paint, 0, 1.28, -2.05); // wing
      add(box(2.06, 0.06, 0.08), neon, 0, 0.55, 2.28); // light strip
      add(box(0.06, 0.08, 3.4), neon, 1.06, 0.45, 0); // side neon
      add(box(0.06, 0.08, 3.4), neon, -1.06, 0.45, 0);
      roofY = 1.55;
    }
  }

  // Lights (truck and longtail have their own)
  if (type !== 'truck' && type !== 'longtail' && !custom) {
    const fz = { muscle: 2.25, formula: 2.0, buggy: 1.95 }[type] ?? 2.3;
    const fy = { buggy: 0.95, formula: 0.5 }[type] ?? 0.65;
    add(box(0.4, 0.14, 0.08), head, 0.6, fy, fz);
    add(box(0.4, 0.14, 0.08), head, -0.6, fy, fz);
  }
  const rz = { muscle: -2.27, formula: -1.95, buggy: -1.72, truck: -2.37, longtail: -2.4 }[type] ?? -2.27;
  const ry = { buggy: 0.9, truck: 1.3 }[type] ?? 0.7;
  if (type !== 'longtail' && !custom) {
    add(box(0.5, 0.14, 0.08), tail, 0.6, ry, rz);
    add(box(0.5, 0.14, 0.08), tail, -0.6, ry, rz);
  }

  // Wheels
  const [r, w, fz, rz2, track, rs] = wheel;
  const wheels = [];
  const frontPivots = [];
  const tireMat = new THREE.MeshStandardMaterial({ color: '#111', roughness: 0.9 });
  const rimMat = new THREE.MeshStandardMaterial({ color: type === 'truck' ? '#888' : '#e5e7eb', metalness: 0.9, roughness: 0.2 });
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

  return { group, body, wheels, frontPivots, flames, roofY, wheelRadius: r };
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
