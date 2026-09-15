// The skiff: a hand-authored low-poly model built from lofted hull sections,
// plus arcade physics that ride the shared wave function.
import {
  BoxGeometry, BufferGeometry, Color, CylinderGeometry, DoubleSide, Float32BufferAttribute, Group,
  IcosahedronGeometry, Mesh, MeshLambertMaterial, Vector3,
} from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { heightAt, sampleSurface } from './waves.js';
import { clamp, damp, wrapAngle } from './util.js';

export const LIVERIES = {
  sunset: { hull: '#f0652c', hullDark: '#b8401f', trim: '#fff1de', shirt: '#2f9fb0', name: 'Sunset' },
  lagoon: { hull: '#2fb7b0', hullDark: '#1d7c86', trim: '#f4f7f2', shirt: '#f2b33d', name: 'Lagoon' },
  saffron: { hull: '#f2b83a', hullDark: '#b77c1f', trim: '#fff6e6', shirt: '#5b4fb8', name: 'Saffron' },
  orchid: { hull: '#9b6ee0', hullDark: '#5e3fa6', trim: '#f7efff', shirt: '#ef6f6f', name: 'Orchid' },
};

// Hull stations from transom (z < 0) to bow (z > 0):
// z, half width, gunwale height, keel depth
const STATIONS = [
  [-2.25, 0.94, 0.56, -0.34],
  [-1.5, 1.0, 0.56, -0.41],
  [-0.5, 1.03, 0.58, -0.45],
  [0.5, 0.99, 0.62, -0.42],
  [1.35, 0.82, 0.7, -0.3],
  [1.95, 0.5, 0.8, -0.1],
  [2.42, 0.06, 0.9, 0.34],
];

function paint(geo, color) {
  const g = geo.index ? geo.toNonIndexed() : geo;
  g.deleteAttribute('uv');
  g.deleteAttribute('normal');
  const c = new Color(color);
  const n = g.getAttribute('position').count;
  const arr = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) {
    arr[i * 3] = c.r;
    arr[i * 3 + 1] = c.g;
    arr[i * 3 + 2] = c.b;
  }
  g.setAttribute('color', new Float32BufferAttribute(arr, 3));
  return g;
}

function box(w, h, d, x, y, z, color, rotX = 0) {
  const g = new BoxGeometry(w, h, d);
  if (rotX) g.rotateX(rotX);
  g.translate(x, y, z);
  return paint(g, color);
}

function triangles(points, color) {
  const g = new BufferGeometry();
  g.setAttribute('position', new Float32BufferAttribute(points, 3));
  return paint(g, color);
}

function pushQuad(out, a, b, c, d) {
  out.push(...a, ...b, ...c, ...a, ...c, ...d);
}

function buildHull(livery) {
  // Each station ring: gunwale L, shoulder L, chine L, keel, chine R, shoulder R, gunwale R.
  const rings = STATIONS.map(([z, w, deck, keel]) => {
    const shoulder = deck - 0.26;
    const chine = keel + 0.24;
    return [
      [-w, deck, z], [-w * 0.99, shoulder, z], [-w * 0.8, chine, z], [0, keel, z],
      [w * 0.8, chine, z], [w * 0.99, shoulder, z], [w, deck, z],
    ];
  });
  const bands = [[], [], []]; // bright band, main hull, bottom
  const bandOf = [0, 1, 2, 2, 1, 0];
  for (let s = 0; s < rings.length - 1; s++) {
    for (let j = 0; j < 6; j++) {
      pushQuad(bands[bandOf[j]], rings[s][j], rings[s][j + 1], rings[s + 1][j + 1], rings[s + 1][j]);
    }
  }
  // Transom
  const t = rings[0];
  const tc = [0, 0.1, STATIONS[0][0]];
  const transom = [];
  for (let j = 0; j < 6; j++) transom.push(...tc, ...t[j + 1], ...t[j]);

  // Inner lining and floor, cream, slightly inset so the orange outer skin
  // never shows from inside the cockpit.
  const lining = [];
  for (let s = 0; s < 4; s++) {
    const [z0, w0, d0] = STATIONS[s];
    const [z1, w1, d1] = STATIONS[s + 1];
    const i0 = w0 - 0.08;
    const i1 = w1 - 0.08;
    pushQuad(lining, [-i0, d0 - 0.02, z0], [-i0 * 0.9, 0.12, z0], [-i1 * 0.9, 0.12, z1], [-i1, d1 - 0.02, z1]);
    pushQuad(lining, [i0 * 0.9, 0.12, z0], [i0, d0 - 0.02, z0], [i1, d1 - 0.02, z1], [i1 * 0.9, 0.12, z1]);
    pushQuad(lining, [-i0 * 0.9, 0.12, z0], [i0 * 0.9, 0.12, z0], [i1 * 0.9, 0.12, z1], [-i1 * 0.9, 0.12, z1]);
  }
  // Transom inner face
  const tw = STATIONS[0][1] - 0.08;
  pushQuad(lining, [-tw, 0.54, -2.17], [tw, 0.54, -2.17], [tw * 0.9, 0.12, -2.17], [-tw * 0.9, 0.12, -2.17]);

  // Foredeck covering the bow
  const fore = [];
  for (let s = 4; s < rings.length - 1; s++) {
    const a = rings[s][0], b = rings[s][6], c = rings[s + 1][6], d = rings[s + 1][0];
    pushQuad(fore, a, b, c, d);
  }
  // Gunwale cap strips
  const cap = [];
  for (let s = 0; s < rings.length - 1; s++) {
    for (const side of [0, 6]) {
      const a = rings[s][side];
      const b = rings[s + 1][side];
      const inset = side === 0 ? 0.1 : -0.1;
      pushQuad(cap, [a[0], a[1] + 0.03, a[2]], [a[0] + inset, a[1] + 0.03, a[2]], [b[0] + inset, b[1] + 0.03, b[2]], [b[0], b[1] + 0.03, b[2]]);
    }
  }
  return [
    triangles(bands[0], livery.hull),
    triangles(bands[1], livery.hull),
    triangles(bands[2], livery.hullDark),
    triangles(transom, livery.hullDark),
    triangles(lining, '#efe2cc'),
    triangles(fore, livery.trim),
    triangles(cap, livery.trim),
  ];
}

function buildFittings(livery) {
  const parts = [];
  const skin = '#f1c7a4';
  // Centre console and windscreen
  parts.push(box(0.72, 0.56, 0.52, 0, 0.42, 0.25, livery.trim));
  parts.push(box(0.74, 0.3, 0.05, 0, 0.84, 0.46, '#bfe7f2', -0.5));
  parts.push(box(0.2, 0.05, 0.16, 0, 0.72, 0.18, '#2c2f3c'));
  // Bench, cooler and a rod holder with a pennant
  parts.push(box(1.62, 0.2, 0.42, 0, 0.3, -1.05, '#a9744d'));
  parts.push(box(0.52, 0.34, 0.36, 0.52, 0.3, -1.72, '#f7f4ee'));
  parts.push(box(0.54, 0.06, 0.38, 0.52, 0.5, -1.72, '#39c2c9'));
  parts.push(box(0.03, 1.25, 0.03, -0.62, 1.0, -1.85, '#e7e1da'));
  parts.push(box(0.02, 0.18, 0.3, -0.62, 1.52, -1.99, livery.hull));
  // Outboard motor
  parts.push(box(0.46, 0.52, 0.56, 0, 0.9, -2.5, '#2b2d3a'));
  parts.push(box(0.48, 0.12, 0.58, 0, 1.2, -2.5, livery.hull));
  parts.push(box(0.14, 1.0, 0.16, 0, 0.2, -2.56, '#3a3d4a'));
  parts.push(box(0.36, 0.06, 0.26, 0, -0.26, -2.58, '#3a3d4a'));
  // Skipper
  parts.push(box(0.4, 0.5, 0.3, 0, 0.62, -0.28, livery.shirt));
  const head = new IcosahedronGeometry(0.16, 0);
  head.translate(0, 1.04, -0.26);
  parts.push(paint(head, skin));
  const brim = new CylinderGeometry(0.25, 0.25, 0.03, 8);
  brim.translate(0, 1.16, -0.26);
  parts.push(paint(brim, '#f4e3c3'));
  const crown = new CylinderGeometry(0.12, 0.15, 0.12, 8);
  crown.translate(0, 1.23, -0.26);
  parts.push(paint(crown, '#f4e3c3'));
  // Bow cleat and rub rail
  parts.push(box(0.1, 0.05, 0.22, 0, 0.9, 2.12, '#d8d2ca'));
  parts.push(box(2.08, 0.07, 0.07, 0, 0.3, -0.3, livery.hullDark));
  return parts;
}

const geometryCache = new Map();

export function boatGeometry(liveryKey) {
  if (geometryCache.has(liveryKey)) return geometryCache.get(liveryKey);
  const livery = LIVERIES[liveryKey] || LIVERIES.sunset;
  const parts = [...buildHull(livery), ...buildFittings(livery)];
  const merged = mergeGeometries(parts);
  parts.forEach((p) => p.dispose());
  merged.computeVertexNormals();
  merged.computeBoundingSphere();
  geometryCache.set(liveryKey, merged);
  return merged;
}

const sharedMaterial = new MeshLambertMaterial({ vertexColors: true, flatShading: true, side: DoubleSide });
const ghostMaterial = new MeshLambertMaterial({
  vertexColors: true, flatShading: true, transparent: true, opacity: 0.32, depthWrite: false, color: new Color('#d8fbff'),
});

export function createBoatMesh(liveryKey, { ghost = false } = {}) {
  const mesh = new Mesh(boatGeometry(liveryKey), ghost ? ghostMaterial : sharedMaterial);
  const root = new Group();
  root.rotation.order = 'YXZ';
  root.add(mesh);
  return root;
}

export const BOAT_RADIUS = 1.45;

const DEFAULT_SPECS = {
  maxSpeed: 27, // m/s, about 52 knots
  boostSpeed: 36,
  accel: 17,
  boostAccel: 30,
  brake: 20,
  reverseMax: 7,
  turnRate: 1.95,
  driftTurn: 2.7,
  grip: 5.8,
  driftGrip: 1.25,
  gravity: 14,
  buoyancy: 56,
};

const tmpSurface = { h: 0, gx: 0, gz: 0 };

export class Boat {
  constructor({ name = 'You', livery = 'sunset', isPlayer = false, specs = {} } = {}) {
    this.name = name;
    this.livery = livery;
    this.isPlayer = isPlayer;
    this.specs = { ...DEFAULT_SPECS, ...specs };
    this.speedMul = 1;
    this.mesh = createBoatMesh(livery);

    this.pos = new Vector3();
    this.prevPos = new Vector3();
    this.vx = 0;
    this.vz = 0;
    this.vy = 0;
    this.heading = 0;
    this.prevHeading = 0;
    this.yawRate = 0;
    this.pitch = 0;
    this.roll = 0;
    this.prevPitch = 0;
    this.prevRoll = 0;

    this.airborne = false;
    this.airTime = 0;
    this.boost = 1;
    this.boosting = false;
    this.drifting = false;
    this.throttle = 0;
    this.steer = 0;
    this.rpm = 0;
    this.forwardSpeed = 0;
    this.lateralSpeed = 0;
    this.frozen = false;

    this.onLand = null; // (impactSpeed, airTime) => void
    this.onHit = null; // (impactSpeed, kind) => void
  }

  get speed() {
    return Math.hypot(this.vx, this.vz);
  }

  place(x, z, heading) {
    this.pos.set(x, heightAt(x, z), z);
    this.prevPos.copy(this.pos);
    this.heading = this.prevHeading = heading;
    this.vx = this.vz = this.vy = 0;
    this.yawRate = 0;
    this.pitch = this.roll = this.prevPitch = this.prevRoll = 0;
    this.airborne = false;
    this.airTime = 0;
    this.boost = 1;
    this.rpm = 0;
  }

  step(dt, controls, colliders, time) {
    const s = this.specs;
    this.prevPos.copy(this.pos);
    this.prevHeading = this.heading;
    this.prevPitch = this.pitch;
    this.prevRoll = this.roll;

    const throttle = this.frozen ? 0 : controls.throttle;
    const steer = this.frozen ? 0 : controls.steer;
    this.throttle = throttle;
    this.steer = steer;

    const h = this.heading;
    const fx = Math.sin(h);
    const fz = Math.cos(h);
    const rx = -Math.cos(h);
    const rz = Math.sin(h);
    let vf = this.vx * fx + this.vz * fz;
    let vr = this.vx * rx + this.vz * rz;
    const inWater = !this.airborne;

    // ---- boost
    const wantsBoost = !this.frozen && controls.boost && this.boost > 0.02 && throttle > 0;
    this.boosting = wantsBoost;
    if (wantsBoost) this.boost = Math.max(0, this.boost - dt * 0.3);
    else this.boost = Math.min(1, this.boost + dt * 0.035);

    this.drifting = !this.frozen && controls.drift && inWater && Math.abs(vf) > 6;
    if (this.drifting && Math.abs(steer) > 0.3) this.boost = Math.min(1, this.boost + dt * 0.16);

    // ---- longitudinal
    const top = (this.boosting ? s.boostSpeed : s.maxSpeed) * this.speedMul;
    if (inWater) {
      if (throttle > 0) {
        const ratio = clamp(vf / top, -1, 1);
        const accel = (this.boosting ? s.boostAccel : s.accel) * (1 - ratio * ratio);
        if (vf < top) vf += throttle * accel * dt;
      } else if (throttle < 0) {
        if (vf > 0.5) vf -= s.brake * -throttle * dt;
        else vf = Math.max(vf - 7 * -throttle * dt, -s.reverseMax);
      }
      if (vf > top) vf += (top - vf) * 1.1 * dt;
      vf -= vf * (throttle === 0 ? 0.55 : 0.12) * dt;
      if (this.drifting) vf -= vf * 0.18 * dt;

      // ---- lateral grip: slide is bled off, and part of it becomes drive
      const grip = this.drifting ? s.driftGrip : s.grip;
      const nvr = vr * Math.exp(-grip * dt);
      if (!this.drifting && vf > 1) vf += Math.abs(vr - nvr) * 0.3;
      vr = nvr;
    } else {
      vf -= vf * 0.04 * dt;
    }

    // ---- steering
    const aSpeed = Math.abs(vf);
    const low = clamp(aSpeed / 7, 0, 1);
    const high = 1 - 0.3 * clamp(aSpeed / s.boostSpeed, 0, 1);
    let targetYaw = -steer * (this.drifting ? s.driftTurn : s.turnRate) * low * high * (vf < -0.5 ? -1 : 1);
    if (!inWater) targetYaw *= 0.25;
    this.yawRate = damp(this.yawRate, targetYaw, this.drifting ? 5 : 9, dt);
    this.heading = wrapAngle(this.heading + this.yawRate * dt);

    this.vx = fx * vf + rx * vr;
    this.vz = fz * vf + rz * vr;
    this.forwardSpeed = vf;
    this.lateralSpeed = vr;

    // ---- position
    this.pos.x += this.vx * dt;
    this.pos.z += this.vz * dt;

    // ---- vertical: buoyancy spring against gravity, free flight above water
    sampleSurface(this.pos.x, this.pos.z, tmpSurface, time);
    const ride = 0.1 + 0.2 * clamp(vf / s.maxSpeed, 0, 1.2);
    const target = tmpSurface.h + ride;
    const sub = target - this.pos.y + s.gravity / s.buoyancy;
    let ay = -s.gravity;
    if (sub > 0) ay += s.buoyancy * sub - 7.5 * this.vy;
    this.vy += ay * dt;
    this.pos.y += this.vy * dt;

    const nowAir = this.pos.y > target + 0.28;
    if (nowAir) {
      this.airTime += dt;
      if (this.airTime > 0.08) this.airborne = true;
    } else {
      if (this.airborne && this.onLand) this.onLand(Math.max(0, -this.vy), this.airTime);
      if (this.airborne && this.airTime > 0.45) this.boost = Math.min(1, this.boost + Math.min(0.3, this.airTime * 0.22));
      this.airborne = false;
      this.airTime = 0;
    }

    // ---- attitude
    const bowX = this.pos.x + fx * 1.9, bowZ = this.pos.z + fz * 1.9;
    const sternX = this.pos.x - fx * 1.9, sternZ = this.pos.z - fz * 1.9;
    const leftX = this.pos.x - rx * 0.95, leftZ = this.pos.z - rz * 0.95;
    const rightX = this.pos.x + rx * 0.95, rightZ = this.pos.z + rz * 0.95;
    const waterPitch = -Math.atan2(heightAt(bowX, bowZ, time) - heightAt(sternX, sternZ, time), 3.8);
    const waterRoll = Math.atan2(heightAt(leftX, leftZ, time) - heightAt(rightX, rightZ, time), 1.9);
    const planing = -0.07 * clamp(vf / s.maxSpeed, 0, 1.3) - (throttle > 0 && vf < top * 0.6 ? 0.035 : 0);
    const turnRoll = steer * 0.17 * clamp(aSpeed / s.maxSpeed, 0, 1) + (this.drifting ? steer * 0.08 : 0);
    if (!this.airborne) {
      this.pitch = damp(this.pitch, waterPitch + planing, 7, dt);
      this.roll = damp(this.roll, waterRoll * 0.8 + turnRoll, 6, dt);
    } else {
      this.pitch = damp(this.pitch, clamp(-this.vy * 0.045, -0.4, 0.45), 2, dt);
      this.roll = damp(this.roll, turnRoll * 0.5, 2, dt);
    }

    // ---- engine note
    const load = clamp(Math.abs(vf) / s.boostSpeed, 0, 1);
    let targetRpm = 0.12 + load * 0.62 + Math.abs(throttle) * 0.22 + (this.boosting ? 0.12 : 0);
    if (this.airborne && throttle > 0) targetRpm += 0.3;
    this.rpm = damp(this.rpm, clamp(targetRpm, 0, 1.15), this.airborne ? 6 : 3.5, dt);

    // ---- islands and markers
    if (colliders) this.collide(colliders);
  }

  collide(colliders) {
    for (let i = 0; i < colliders.length; i++) {
      const c = colliders[i];
      const dx = this.pos.x - c.x;
      const dz = this.pos.z - c.z;
      const minD = c.r + BOAT_RADIUS;
      const d2 = dx * dx + dz * dz;
      if (d2 >= minD * minD) continue;
      const d = Math.sqrt(d2) || 0.001;
      const nx = dx / d;
      const nz = dz / d;
      this.pos.x = c.x + nx * minD;
      this.pos.z = c.z + nz * minD;
      const vn = this.vx * nx + this.vz * nz;
      if (vn < 0) {
        const bounce = c.soft ? 1.2 : 1.45;
        this.vx -= bounce * vn * nx;
        this.vz -= bounce * vn * nz;
        const keep = c.soft ? 0.9 : 0.72;
        this.vx *= keep;
        this.vz *= keep;
        this.yawRate += (Math.random() - 0.5) * 1.2 * Math.min(1, -vn / 15);
        if (-vn > 2 && this.onHit) this.onHit(-vn, c.soft ? 'buoy' : 'rock');
      }
    }
  }

  /** Circle-vs-circle bump between two boats. */
  static bump(a, b) {
    const dx = b.pos.x - a.pos.x;
    const dz = b.pos.z - a.pos.z;
    const minD = BOAT_RADIUS * 2;
    const d2 = dx * dx + dz * dz;
    if (d2 >= minD * minD || d2 === 0) return 0;
    const d = Math.sqrt(d2);
    const nx = dx / d;
    const nz = dz / d;
    const overlap = (minD - d) * 0.5;
    a.pos.x -= nx * overlap;
    a.pos.z -= nz * overlap;
    b.pos.x += nx * overlap;
    b.pos.z += nz * overlap;
    const rel = (b.vx - a.vx) * nx + (b.vz - a.vz) * nz;
    if (rel >= 0) return 0;
    const j = -rel * 0.8;
    a.vx -= j * nx;
    a.vz -= j * nz;
    b.vx += j * nx;
    b.vz += j * nz;
    return -rel;
  }

  render(alpha) {
    const m = this.mesh;
    m.position.lerpVectors(this.prevPos, this.pos, alpha);
    m.rotation.y = this.prevHeading + wrapAngle(this.heading - this.prevHeading) * alpha;
    m.rotation.x = this.prevPitch + (this.pitch - this.prevPitch) * alpha;
    m.rotation.z = this.prevRoll + (this.roll - this.prevRoll) * alpha;
  }
}
