import * as THREE from 'three';

const sphereGeo = new THREE.SphereGeometry(1, 12, 8);
const cubeGeo = new THREE.BoxGeometry(1, 1, 1);
const MAX_PARTS = 500;
const _z = new THREE.Vector3(0, 0, 1);

/** Tiny particle system: every particle is a mesh with its own fading material. */
export class Fx {
  constructor(scene) {
    this.scene = scene;
    this.parts = [];
  }

  spawn({ geo = cubeGeo, color, pos, vel, life, size, grow = 0, gravity = 0, additive = false, opacity = 1 }) {
    if (this.parts.length >= MAX_PARTS) this.kill(0);
    const mat = new THREE.MeshBasicMaterial({
      color,
      transparent: true,
      opacity,
      depthWrite: false,
      blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending,
    });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.position.copy(pos);
    mesh.scale.setScalar(size);
    mesh.rotation.set(Math.random() * 3, Math.random() * 3, 0);
    this.scene.add(mesh);
    this.parts.push({ mesh, vel: vel.clone(), life, max: life, size, grow, gravity, opacity });
  }

  kill(i) {
    const p = this.parts[i];
    this.scene.remove(p.mesh);
    p.mesh.material.dispose();
    this.parts.splice(i, 1);
  }

  explosion(pos, color = '#ff8c1a', scale = 1) {
    const v = new THREE.Vector3();
    this.spawn({ geo: sphereGeo, color: '#fff3b0', pos, vel: v, life: 0.25, size: 1.2 * scale, grow: 22 * scale, additive: true });
    this.spawn({ geo: sphereGeo, color, pos, vel: v, life: 0.5, size: 1.5 * scale, grow: 12 * scale, additive: true, opacity: 0.8 });
    for (let i = 0; i < 18 * scale; i++) {
      v.set(Math.random() - 0.5, Math.random() * 0.8 + 0.2, Math.random() - 0.5).normalize().multiplyScalar(8 + Math.random() * 14);
      this.spawn({ color: i % 2 ? '#ffd166' : color, pos, vel: v, life: 0.5 + Math.random() * 0.5, size: 0.3 + Math.random() * 0.3, gravity: 25, additive: true });
    }
    for (let i = 0; i < 8 * scale; i++) {
      v.set(Math.random() - 0.5, Math.random() * 0.5 + 0.5, Math.random() - 0.5).multiplyScalar(4);
      this.spawn({ geo: sphereGeo, color: '#555', pos, vel: v, life: 1.2, size: 0.8 + Math.random(), grow: 2, opacity: 0.5 });
    }
  }

  impact(pos, color) {
    const v = new THREE.Vector3();
    this.spawn({ geo: sphereGeo, color, pos, vel: v, life: 0.15, size: 0.4, grow: 10, additive: true });
    for (let i = 0; i < 6; i++) {
      v.set(Math.random() - 0.5, Math.random() - 0.2, Math.random() - 0.5).normalize().multiplyScalar(6 + Math.random() * 6);
      this.spawn({ color, pos, vel: v, life: 0.3, size: 0.15, gravity: 20, additive: true });
    }
  }

  muzzle(pos, color) {
    this.spawn({ geo: sphereGeo, color, pos, vel: new THREE.Vector3(), life: 0.07, size: 0.35, grow: 6, additive: true });
  }

  puff(pos, color = '#bbb', size = 0.4) {
    const v = new THREE.Vector3((Math.random() - 0.5) * 1.5, 1 + Math.random(), (Math.random() - 0.5) * 1.5);
    this.spawn({ geo: sphereGeo, color, pos, vel: v, life: 0.6, size, grow: 1.5, opacity: 0.45 });
  }

  spark(pos, color = '#ffd166') {
    const v = new THREE.Vector3((Math.random() - 0.5) * 6, Math.random() * 4, (Math.random() - 0.5) * 6);
    this.spawn({ color, pos, vel: v, life: 0.25, size: 0.12, gravity: 20, additive: true });
  }

  /** A thin wind streak along `dir` (slipstream lines). */
  streak(pos, dir, vel, len = 2.2) {
    this.spawn({ color: '#ffffff', pos, vel, life: 0.22, size: 1, opacity: 0.55 });
    const m = this.parts[this.parts.length - 1].mesh;
    m.rotation.set(0, 0, 0);
    m.quaternion.setFromUnitVectors(_z, dir);
    m.scale.set(0.05, 0.05, len);
  }

  update(dt) {
    for (let i = this.parts.length - 1; i >= 0; i--) {
      const p = this.parts[i];
      p.life -= dt;
      if (p.life <= 0) {
        this.kill(i);
        continue;
      }
      p.vel.y -= p.gravity * dt;
      p.mesh.position.addScaledVector(p.vel, dt);
      if (p.grow) p.mesh.scale.addScalar(p.grow * dt);
      p.mesh.material.opacity = p.opacity * (p.life / p.max);
    }
  }
}

/** Ring buffer of tire-mark quads laid on the road while cars drift. */
export class SkidMarks {
  constructor(scene, max = 3000) {
    this.max = max;
    this.i = 0;
    this.count = 0;
    this.pos = new Float32Array(max * 18);
    this.geo = new THREE.BufferGeometry();
    this.attr = new THREE.BufferAttribute(this.pos, 3);
    this.attr.setUsage(THREE.DynamicDrawUsage);
    this.geo.setAttribute('position', this.attr);
    this.geo.setDrawRange(0, 0);
    const mesh = new THREE.Mesh(
      this.geo,
      new THREE.MeshBasicMaterial({ color: '#0d0d10', transparent: true, opacity: 0.55, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2, side: THREE.DoubleSide }),
    );
    mesh.frustumCulled = false;
    mesh.renderOrder = 1;
    scene.add(mesh);
  }

  add(a, b, right, w = 0.24) {
    if (a.distanceToSquared(b) > 25) return; // teleported (respawn / fork), skip
    const q = [
      a.x - right.x * w, a.y - right.y * w, a.z - right.z * w,
      a.x + right.x * w, a.y + right.y * w, a.z + right.z * w,
      b.x + right.x * w, b.y + right.y * w, b.z + right.z * w,
      b.x - right.x * w, b.y - right.y * w, b.z - right.z * w,
    ];
    const o = this.i * 18;
    for (const [k, v] of [0, 1, 2, 0, 2, 3].entries()) this.pos.set(q.slice(v * 3, v * 3 + 3), o + k * 3);
    this.i = (this.i + 1) % this.max;
    this.count = Math.min(this.max, this.count + 1);
    this.geo.setDrawRange(0, this.count * 6);
    this.attr.needsUpdate = true;
  }
}
