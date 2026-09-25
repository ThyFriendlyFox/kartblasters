import * as THREE from 'three';

const sphereGeo = new THREE.SphereGeometry(1, 12, 8);
const cubeGeo = new THREE.BoxGeometry(1, 1, 1);
const MAX_PARTS = 500;

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
