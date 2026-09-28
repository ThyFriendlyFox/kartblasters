import * as THREE from 'three';
import { buildCar } from './cars.js';

/**
 * The car-select showroom: the chosen car turning on a lit turntable, in the
 * style of the promo's car roster. Renders only while it's on screen.
 */
export class Showroom {
  constructor(canvas) {
    this.canvas = canvas;
    this.renderer = null;
    this.running = false;
    this.cache = new Map(); // "car|color" -> car group
    this.current = null;
    this.spin = -0.6;
    this.swap = 1; // 0..1 slide-in of a newly picked car
  }

  init() {
    if (this.renderer) return true;
    try {
      this.renderer = new THREE.WebGLRenderer({ canvas: this.canvas, antialias: true, alpha: false });
    } catch {
      return false; // no WebGL: the stats and carousel still work
    }
    const r = this.renderer;
    r.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    r.shadowMap.enabled = true;
    r.shadowMap.type = THREE.PCFSoftShadowMap;
    const scene = (this.scene = new THREE.Scene());
    scene.background = new THREE.Color('#07080d');
    scene.fog = new THREE.Fog('#07080d', 12, 40);
    scene.add(new THREE.HemisphereLight('#cfe0ff', '#1a1020', 1.2));
    const key = new THREE.DirectionalLight('#ffffff', 2.6);
    key.position.set(4, 7, 5);
    key.castShadow = true;
    key.shadow.mapSize.setScalar(1024);
    const sc = key.shadow.camera;
    sc.left = sc.bottom = -5;
    sc.right = sc.top = 5;
    scene.add(key);
    const rim = new THREE.DirectionalLight('#ff2bd6', 2.2);
    rim.position.set(-6, 3, -5);
    scene.add(rim);
    const rim2 = new THREE.DirectionalLight('#00e5ff', 1.6);
    rim2.position.set(6, 2, -6);
    scene.add(rim2);
    // A soft magenta spotlight glow behind the car
    const glow = new THREE.Mesh(
      new THREE.CircleGeometry(4.5, 48),
      new THREE.MeshBasicMaterial({ color: '#ff2bd6', transparent: true, opacity: 0.18, depthWrite: false }),
    );
    glow.position.set(-1.2, 2.2, -3.5);
    scene.add(glow);
    const floor = new THREE.Mesh(new THREE.CircleGeometry(60, 64), new THREE.MeshStandardMaterial({ color: '#0e1018', roughness: 0.35, metalness: 0.4 }));
    floor.rotation.x = -Math.PI / 2;
    floor.receiveShadow = true;
    scene.add(floor);
    const ring = new THREE.Mesh(new THREE.RingGeometry(3.6, 3.8, 64), new THREE.MeshBasicMaterial({ color: '#ffb703' }));
    ring.rotation.x = -Math.PI / 2;
    ring.position.y = 0.01;
    scene.add(ring);
    this.table = new THREE.Group();
    scene.add(this.table);
    this.camera = new THREE.PerspectiveCamera(40, 16 / 9, 0.1, 100);
    this.camera.position.set(6.2, 2.3, 7.4);
    this.camera.lookAt(0.6, 0.8, 0);
    return true;
  }

  /** Put a car on the turntable. */
  show(type, color) {
    if (!this.init()) return;
    const key = `${type}|${color}`;
    if (this.current?.key === key) return;
    if (this.current) this.current.group.visible = false;
    let group = this.cache.get(key);
    if (!group) {
      group = buildCar(type, color).group;
      group.traverse((o) => (o.castShadow = true));
      this.table.add(group);
      this.cache.set(key, group);
      // Keep only a handful of built cars around
      if (this.cache.size > 8) {
        const [oldKey, old] = this.cache.entries().next().value;
        if (oldKey !== key) {
          this.table.remove(old);
          old.traverse((o) => {
            o.geometry?.dispose();
            for (const m of [].concat(o.material || [])) m.dispose?.();
          });
          this.cache.delete(oldKey);
        }
      }
    }
    group.visible = true;
    const typeChanged = this.current?.type !== type;
    this.current = { key, type, group };
    if (typeChanged) this.swap = 0;
    if (!this.running) this.draw(0);
  }

  start() {
    if (this.running || !this.init()) return;
    this.running = true;
    this.last = performance.now();
    const loop = (t) => {
      if (!this.running) return;
      requestAnimationFrame(loop);
      const dt = Math.min(0.05, (t - this.last) / 1000) || 0.016;
      this.last = t;
      this.draw(dt);
    };
    requestAnimationFrame(loop);
  }

  stop() {
    this.running = false;
  }

  draw(dt) {
    const r = this.renderer;
    if (!r) return;
    const w = this.canvas.clientWidth, h = this.canvas.clientHeight;
    if (!w || !h) return;
    if (this.canvas.width !== Math.round(w * r.getPixelRatio()) || this.canvas.height !== Math.round(h * r.getPixelRatio())) {
      r.setSize(w, h, false);
      this.camera.aspect = w / h;
      this.camera.updateProjectionMatrix();
    }
    this.spin += dt * 0.6;
    this.swap = Math.min(1, this.swap + dt * 3.5);
    const e = 1 - (1 - this.swap) ** 3;
    this.table.rotation.y = this.spin;
    // A new car slides in from the left
    this.table.position.set(-1.6 - (1 - e) * 5, 0, 0);
    // Narrow screens: pull back so the car still fits
    // (and aim low so it sits above the stats, which move to the bottom)
    const aspect = w / h, narrow = aspect < 1.2, z = narrow ? 1.35 : 1;
    this.camera.position.set(6.2 * z, 2.3 * z, 7.4 * z);
    this.camera.lookAt(narrow ? -1.6 : 0.6, narrow ? -1.6 : 0.8, 0);
    r.render(this.scene, this.camera);
  }

  dispose() {
    this.stop();
    this.renderer?.dispose();
    this.renderer?.forceContextLoss?.();
    this.renderer = null;
  }
}
