// Camera rig: a springy chase cam that swings wide in drifts, a wide wake view,
// a helm view and a slow orbit for menus. Trauma-based shake on impacts.
import { MathUtils, Vector3 } from 'three';
import { heightAt } from './waves.js';
import { clamp, damp, wrapAngle } from './util.js';

const MODES = ['chase', 'far', 'helm'];
const LABELS = { chase: 'Following the boat', far: 'Wide wake view', helm: 'At the helm', orbit: 'Harbour view' };
const ACTION = { chase: 'Wide wake view', far: 'At the helm', helm: 'Follow the boat' };

const tmpA = new Vector3();
const tmpB = new Vector3();

export class CameraRig {
  constructor(camera) {
    this.camera = camera;
    this.mode = 'chase';
    this.yaw = 0;
    this.look = new Vector3();
    this.trauma = 0;
    this.shakeEnabled = true;
    this.time = 0;
    this.orbitAngle = 0.6;
    this.fov = camera.fov;
  }

  get label() {
    return LABELS[this.mode];
  }

  get nextActionLabel() {
    return ACTION[this.mode] || 'At the helm';
  }

  cycle() {
    const i = MODES.indexOf(this.mode);
    this.mode = MODES[(i + 1) % MODES.length];
    return this.mode;
  }

  addTrauma(v) {
    this.trauma = Math.min(1, this.trauma + v);
  }

  snap(boat) {
    this.yaw = boat.heading;
    const p = boat.mesh.position;
    this.camera.position.set(p.x - Math.sin(this.yaw) * 11, p.y + 4.6, p.z - Math.cos(this.yaw) * 11);
    this.look.set(p.x + Math.sin(this.yaw) * 8, p.y + 1.6, p.z + Math.cos(this.yaw) * 8);
    this.camera.lookAt(this.look);
  }

  update(dt, boat, orbit = false) {
    this.time += dt;
    const cam = this.camera;
    const p = boat.mesh.position;
    const speed = boat.speed;
    const ratio = clamp(speed / boat.specs.boostSpeed, 0, 1);

    if (orbit) {
      this.orbitAngle += dt * 0.11;
      const r = 17;
      tmpA.set(p.x + Math.sin(this.orbitAngle) * r, 0, p.z + Math.cos(this.orbitAngle) * r);
      tmpA.y = Math.max(p.y + 5.2, heightAt(tmpA.x, tmpA.z) + 2.5);
      cam.position.lerp(tmpA, 1 - Math.exp(-2.5 * dt));
      tmpB.set(p.x, p.y + 1.4, p.z);
      this.look.lerp(tmpB, 1 - Math.exp(-4 * dt));
      cam.lookAt(this.look);
      this.setFov(52, dt);
      this.yaw = boat.heading;
      return;
    }

    if (this.mode === 'helm') {
      boat.mesh.updateMatrixWorld();
      tmpA.set(0, 1.62, -1.15);
      boat.mesh.localToWorld(tmpA);
      cam.position.copy(tmpA);
      tmpB.set(0, 1.25, 10);
      boat.mesh.localToWorld(tmpB);
      this.look.copy(tmpB);
      cam.lookAt(this.look);
      this.setFov(70 + ratio * 10, dt);
      this.yaw = boat.heading;
      this.applyShake(dt, ratio * 0.4);
      return;
    }

    const far = this.mode === 'far';
    // Swing toward the direction of travel while sliding so drifts read clearly.
    const velHeading = speed > 3 ? Math.atan2(boat.vx, boat.vz) : boat.heading;
    const slip = wrapAngle(velHeading - boat.heading);
    const yawTarget = boat.heading + slip * (boat.drifting ? 0.55 : 0.25);
    this.yaw += wrapAngle(yawTarget - this.yaw) * (1 - Math.exp(-(boat.drifting ? 3 : 5) * dt));

    const dist = (far ? 21 : 10.5) + speed * (far ? 0.12 : 0.085) + (boat.boosting ? 1.8 : 0);
    const height = (far ? 9.5 : 4.4) + speed * 0.025 + (boat.airborne ? 0.8 : 0);
    const fx = Math.sin(this.yaw);
    const fz = Math.cos(this.yaw);

    tmpA.set(p.x - fx * dist, 0, p.z - fz * dist);
    const water = heightAt(tmpA.x, tmpA.z);
    const baseY = Math.max(p.y, water) * 0.55 + water * 0.1;
    tmpA.y = Math.max(baseY + height, water + 1.6);

    cam.position.x = damp(cam.position.x, tmpA.x, 14, dt);
    cam.position.z = damp(cam.position.z, tmpA.z, 14, dt);
    cam.position.y = damp(cam.position.y, tmpA.y, 5, dt);

    tmpB.set(p.x + fx * (far ? 14 : 9), p.y + (far ? 1 : 1.7), p.z + fz * (far ? 14 : 9));
    this.look.x = tmpB.x;
    this.look.z = tmpB.z;
    this.look.y = damp(this.look.y, tmpB.y, 6, dt);
    cam.lookAt(this.look);

    this.setFov((far ? 55 : 63) + Math.pow(ratio, 1.3) * 14 + (boat.boosting ? 6 : 0), dt);
    this.applyShake(dt, ratio);
  }

  setFov(target, dt) {
    const f = damp(this.camera.fov, target, 3, dt);
    if (Math.abs(f - this.camera.fov) > 0.01) {
      this.camera.fov = f;
      this.camera.updateProjectionMatrix();
    }
  }

  applyShake(dt, speedRatio) {
    this.trauma = Math.max(0, this.trauma - dt * 1.5);
    if (!this.shakeEnabled) return;
    const t = this.time;
    const s = this.trauma * this.trauma;
    const hum = speedRatio * speedRatio * 0.012;
    const cam = this.camera;
    cam.position.x += Math.sin(t * 37.1) * (0.4 * s + hum);
    cam.position.y += Math.sin(t * 43.7 + 1.3) * (0.35 * s + hum);
    cam.rotation.z += Math.sin(t * 29.3 + 2.1) * 0.03 * s;
  }
}

export { LABELS as CAMERA_LABELS, MathUtils };
