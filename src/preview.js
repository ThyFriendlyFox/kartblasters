import * as THREE from 'three';
import { Track } from './track.js';
import { buildArena, HALF } from './arena.js';
import { TRACKS } from './trackdefs.js';

/**
 * Map previews for the menu: builds the real map into an off-screen scene,
 * renders one aerial shot and caches the image. Built on demand, one at a time.
 */
const cache = new Map();
let renderer = null;
let queue = Promise.resolve();

// Typical player pace (world units per second): AI laps run ~65, people a bit slower
const AVG_SPEED = 55;

function render(scene, center, radius, dir, pts = null) {
  const W = 640, H = 360;
  renderer ||= new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
  renderer.setSize(W, H, false);
  renderer.setPixelRatio(1);
  const cam = new THREE.PerspectiveCamera(38, W / H, 1, 20000);
  dir.normalize();
  const place = (dist) => {
    cam.position.copy(center).addScaledVector(dir, dist);
    cam.lookAt(center);
    cam.updateMatrixWorld();
  };
  let dist = (radius / Math.sin(THREE.MathUtils.degToRad(19))) * 0.7;
  if (pts) {
    // Pull back until every sampled point of the map is in frame
    const v = new THREE.Vector3();
    const fits = (d) => {
      place(d);
      for (const p of pts) {
        v.copy(p).project(cam);
        if (Math.abs(v.x) > 0.94 || Math.abs(v.y) > 0.9 || v.z > 1) return false;
      }
      return true;
    };
    let lo = radius * 0.3, hi = radius * 8;
    for (let i = 0; i < 24; i++) {
      const mid = (lo + hi) / 2;
      if (fits(mid)) hi = mid;
      else lo = mid;
    }
    dist = hi;
  }
  place(dist);
  scene.fog = null;
  scene.traverse((o) => o.userData.cloud && (o.visible = false));
  renderer.render(scene, cam);
  const url = renderer.domElement.toDataURL('image/jpeg', 0.85);
  scene.traverse((o) => {
    o.geometry?.dispose();
    for (const m of [].concat(o.material || [])) {
      for (const k of ['map', 'emissiveMap']) m[k]?.dispose?.();
      m.dispose?.();
    }
  });
  return url;
}

function trackShot(id) {
  const scene = new THREE.Scene();
  const track = new Track(id);
  track.build(scene);
  const pts = [];
  const box = new THREE.Box3();
  for (const p of [track, ...track.branches.map((b) => b.path)]) {
    for (let i = 0; i < p.n; i += 6) {
      const v = new THREE.Vector3().fromArray(p.P, i * 3);
      pts.push(v);
      box.expandByPoint(v);
    }
  }
  const center = box.getCenter(new THREE.Vector3());
  const size = box.getSize(new THREE.Vector3());
  // Look across the track's short side, so its long side fills the width
  const dir = size.z > size.x ? new THREE.Vector3(1.1, 1.3, 0.35) : new THREE.Vector3(0.35, 1.3, 1.1);
  const url = render(scene, center, Math.max(size.x, size.z) / 2, dir, pts);
  const secs = Math.round(track.L / AVG_SPEED);
  const facts = [`${(track.L / 1000).toFixed(1)} km lap`, `≈ ${Math.floor(secs / 60)}:${String(secs % 60).padStart(2, '0')} per lap`];
  if (track.branches.length) facts.push(`${track.branches.length + 1} routes`);
  return { url, facts, desc: TRACKS[id].desc };
}

function arenaShot(id) {
  const scene = new THREE.Scene();
  const world = buildArena(scene, { map: id, destructible: false });
  const half = world.half || HALF;
  const url = render(scene, new THREE.Vector3(0, world.surface ? 10 : 0, 0), half * 1.15, new THREE.Vector3(0.5, 1.0, 0.8));
  return { url, facts: [`${Math.round(half * 2)} m arena`], desc: null };
}

/** Promise of { url, facts, desc } for a map. */
export function mapPreview(mode, id) {
  const key = `${mode}:${id}`;
  if (!cache.has(key)) {
    const job = queue.then(
      () =>
        new Promise((resolve, reject) =>
          // Let the menu paint its loading state first
          setTimeout(() => {
            try {
              resolve(mode === 'race' ? trackShot(id) : arenaShot(id));
            } catch (e) {
              reject(e);
            }
          }, 30),
        ),
    );
    queue = job.catch(() => cache.delete(key));
    cache.set(key, job);
  }
  return cache.get(key);
}
