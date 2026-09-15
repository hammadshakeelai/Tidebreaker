// Wake ribbons and spray. The wake is a strip mesh laid on the live wave surface
// (displaced in its vertex shader); spray is one pooled Points cloud for every
// boat in the race. Both are a single draw call each.
import {
  BufferAttribute, BufferGeometry, DoubleSide, DynamicDrawUsage, Mesh, NormalBlending, Points, ShaderMaterial,
} from 'three';
import { WAVE_GLSL, waveUniforms } from './waves.js';
import { paletteUniforms } from './palette.js';

const SEG = 64;
const LIFE = 3.2;
const STRIDE = 7; // x, z, rx, rz, t, strength, serial

const wakeVertex = /* glsl */ `
${WAVE_GLSL}
attribute vec4 aData;
varying vec4 vData;
void main() {
  vec3 p = position;
  p.y = waveHeight(p.xz) + 0.12;
  vData = aData;
  vec4 clip = projectionMatrix * viewMatrix * vec4(p, 1.0);
  // Depth-only bias toward the camera. Between its vertices the faceted sea can
  // sit above the true curve, and at grazing angles it would slice the ribbon
  // into blocks. Screen position is untouched.
  vec3 toCam = cameraPosition - p;
  float dist = length(toCam);
  vec3 V = toCam / dist;
  float bias = min(clamp(0.5 / max(V.y, 0.04), 0.5, 12.0), dist * 0.5);
  vec4 biased = projectionMatrix * viewMatrix * vec4(p + V * bias, 1.0);
  clip.z = biased.z / biased.w * clip.w;
  gl_Position = clip;
}
`;

const wakeFragment = /* glsl */ `
uniform vec3 uFoam;
uniform float uIntensity;
varying vec4 vData;
float hash(vec2 p) { return fract(sin(dot(p, vec2(41.3, 289.1))) * 43758.5453); }
void main() {
  float age = vData.x;
  float side = vData.y;
  float edge = abs(side);
  float strength = vData.z * uIntensity;
  float life = 1.0 - age;
  // Churned prop wash down the middle dies quickly; the two arms at the edges
  // spread and last the length of the ribbon.
  float wash = (1.0 - smoothstep(0.0, 0.5, edge)) * life * life * life;
  float arms = smoothstep(0.5, 0.82, edge) * (1.0 - smoothstep(0.88, 1.0, edge)) * life;
  // Foam breaks into clumps that stay put on the water as the ribbon ages.
  float clump = hash(vec2(floor(mod(vData.w, 1024.0) * 1.5), floor((side + 1.0) * 3.0)));
  float foam = step(0.3 + age * 0.55, clump);
  float a = strength * (wash * (0.45 + 0.25 * foam) + arms * (0.18 + 0.34 * foam));
  gl_FragColor = vec4(uFoam, a);
  #include <colorspace_fragment>
}
`;

export class Wake {
  constructor({ intensity = 1 } = {}) {
    this.samples = new Float32Array(SEG * STRIDE);
    this.count = 0;
    this.serial = 0;
    this.lastX = 0;
    this.lastZ = 0;
    this.lastT = -1;

    const geo = new BufferGeometry();
    this.positions = new Float32Array(SEG * 2 * 3);
    this.data = new Float32Array(SEG * 2 * 4);
    geo.setAttribute('position', new BufferAttribute(this.positions, 3).setUsage(DynamicDrawUsage));
    geo.setAttribute('aData', new BufferAttribute(this.data, 4).setUsage(DynamicDrawUsage));
    const idx = [];
    for (let i = 0; i < SEG - 1; i++) {
      const a = i * 2;
      idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
    }
    geo.setIndex(idx);
    geo.setDrawRange(0, 0);
    this.geometry = geo;

    this.mesh = new Mesh(
      geo,
      new ShaderMaterial({
        uniforms: { ...waveUniforms, uFoam: paletteUniforms.uFoam, uIntensity: { value: intensity } },
        vertexShader: wakeVertex,
        fragmentShader: wakeFragment,
        transparent: true,
        depthWrite: false,
        blending: NormalBlending,
        side: DoubleSide,
      }),
    );
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 2;
  }

  reset() {
    this.count = 0;
    this.lastT = -1;
    this.geometry.setDrawRange(0, 0);
  }

  update(boat, time) {
    const h = boat.heading;
    const fx = Math.sin(h);
    const fz = Math.cos(h);
    const sx = boat.pos.x - fx * 2.3;
    const sz = boat.pos.z - fz * 2.3;
    const strength = boat.airborne ? 0 : Math.min(1, boat.speed / 22);
    const s = this.samples;

    const moved = Math.hypot(sx - this.lastX, sz - this.lastZ);
    if (this.lastT < 0 || moved > 1.8 || time - this.lastT > 0.25) {
      s.copyWithin(STRIDE, 0, (SEG - 1) * STRIDE);
      this.count = Math.min(SEG, this.count + 1);
      this.serial++;
      this.lastX = sx;
      this.lastZ = sz;
      this.lastT = time;
    }
    // The newest sample rides with the stern every frame.
    s[0] = sx;
    s[1] = sz;
    s[2] = -Math.cos(h);
    s[3] = Math.sin(h);
    s[4] = time;
    s[5] = strength;
    s[6] = this.serial;

    const p = this.positions;
    const d = this.data;
    let live = 0;
    for (let i = 0; i < this.count; i++) {
      const o = i * STRIDE;
      const age = (time - s[o + 4]) / LIFE;
      if (age >= 1) break;
      const w = 0.7 + age * LIFE * 1.7;
      const v = i * 6;
      p[v] = s[o] - s[o + 2] * w;
      p[v + 1] = 0;
      p[v + 2] = s[o + 1] - s[o + 3] * w;
      p[v + 3] = s[o] + s[o + 2] * w;
      p[v + 4] = 0;
      p[v + 5] = s[o + 1] + s[o + 3] * w;
      const q = i * 8;
      d[q] = age;
      d[q + 1] = -1;
      d[q + 2] = s[o + 5];
      d[q + 3] = s[o + 6];
      d[q + 4] = age;
      d[q + 5] = 1;
      d[q + 6] = s[o + 5];
      d[q + 7] = s[o + 6];
      live++;
    }
    this.geometry.attributes.position.needsUpdate = true;
    this.geometry.attributes.aData.needsUpdate = true;
    this.geometry.setDrawRange(0, Math.max(0, live - 1) * 6);
  }
}

const sprayVertex = /* glsl */ `
uniform float uScale;
attribute float aLife;
attribute float aSize;
varying float vLife;
void main() {
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  vLife = aLife;
  gl_PointSize = aLife > 0.0 ? aSize * uScale / max(-mv.z, 0.5) : 0.0;
  gl_Position = projectionMatrix * mv;
}
`;

const sprayFragment = /* glsl */ `
uniform vec3 uFoam;
varying float vLife;
void main() {
  vec2 c = gl_PointCoord - 0.5;
  float d = length(c);
  if (d > 0.5) discard;
  float a = smoothstep(0.5, 0.15, d) * min(1.0, vLife * 2.5);
  gl_FragColor = vec4(uFoam, a * 0.92);
  #include <colorspace_fragment>
}
`;

export class Spray {
  constructor(max = 1200) {
    this.max = max;
    this.pos = new Float32Array(max * 3);
    this.vel = new Float32Array(max * 3);
    this.life = new Float32Array(max);
    this.maxLife = new Float32Array(max).fill(1);
    this.size = new Float32Array(max);
    this.lifeAttr = new Float32Array(max);
    this.cursor = 0;
    this.acc = new Map();

    const geo = new BufferGeometry();
    geo.setAttribute('position', new BufferAttribute(this.pos, 3).setUsage(DynamicDrawUsage));
    geo.setAttribute('aLife', new BufferAttribute(this.lifeAttr, 1).setUsage(DynamicDrawUsage));
    geo.setAttribute('aSize', new BufferAttribute(this.size, 1).setUsage(DynamicDrawUsage));
    this.geometry = geo;
    this.material = new ShaderMaterial({
      uniforms: { uScale: { value: 400 }, uFoam: paletteUniforms.uFoam },
      vertexShader: sprayVertex,
      fragmentShader: sprayFragment,
      transparent: true,
      depthWrite: false,
      blending: NormalBlending,
    });
    this.points = new Points(geo, this.material);
    this.points.frustumCulled = false;
    this.points.renderOrder = 3;
  }

  setViewportHeight(px) {
    this.material.uniforms.uScale.value = px * 0.3;
  }

  emit(x, y, z, vx, vy, vz, size, life) {
    const i = this.cursor;
    this.cursor = (this.cursor + 1) % this.max;
    const o = i * 3;
    this.pos[o] = x;
    this.pos[o + 1] = y;
    this.pos[o + 2] = z;
    this.vel[o] = vx;
    this.vel[o + 1] = vy;
    this.vel[o + 2] = vz;
    this.size[i] = size;
    this.life[i] = life;
    this.maxLife[i] = life;
  }

  /** Bow spray, drift fans and prop wash for one boat. */
  emitForBoat(boat, dt, detail = 1) {
    if (boat.airborne) return;
    const speed = boat.speed;
    if (speed < 5) return;
    let acc = (this.acc.get(boat) || 0) + dt * speed * 3.6 * detail;
    const h = boat.heading;
    const fx = Math.sin(h), fz = Math.cos(h);
    const rx = -Math.cos(h), rz = Math.sin(h);
    const bx = boat.pos.x, by = boat.pos.y, bz = boat.pos.z;
    while (acc >= 1) {
      acc -= 1;
      for (const side of [-1, 1]) {
        const drift = boat.drifting && Math.sign(boat.steer) === -side ? 1.8 : 1;
        const out = (1.4 + speed * 0.09 + Math.random() * 1.2) * drift;
        const along = 0.3 + Math.random() * 1.2;
        this.emit(
          bx + rx * side * 1.0 + fx * along,
          by + 0.05,
          bz + rz * side * 1.0 + fz * along,
          rx * side * out + boat.vx * 0.7,
          1.8 + speed * 0.1 * Math.random() + Math.random() * 1.2,
          rz * side * out + boat.vz * 0.7,
          0.16 + Math.random() * 0.3 * drift,
          0.3 + Math.random() * 0.4 * drift,
        );
      }
      if (Math.random() < 0.6) {
        this.emit(
          bx - fx * 2.6 + (Math.random() - 0.5) * 0.8, by - 0.1, bz - fz * 2.6 + (Math.random() - 0.5) * 0.8,
          boat.vx * 0.45 + (Math.random() - 0.5) * 2, 1.2 + Math.random() * 1.8, boat.vz * 0.45 + (Math.random() - 0.5) * 2,
          0.2 + Math.random() * 0.25, 0.25 + Math.random() * 0.3,
        );
      }
    }
    this.acc.set(boat, acc);
  }

  burst(x, y, z, strength = 1) {
    const n = Math.floor(50 + 90 * strength);
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2;
      const r = 2 + Math.random() * 6 * strength;
      this.emit(
        x + Math.cos(a) * 1.2, y, z + Math.sin(a) * 1.2,
        Math.cos(a) * r, 3 + Math.random() * 7 * strength, Math.sin(a) * r,
        0.2 + Math.random() * 0.4, 0.5 + Math.random() * 0.5,
      );
    }
  }

  update(dt) {
    const g = 14;
    const drag = 1 - 1.4 * dt;
    for (let i = 0; i < this.max; i++) {
      if (this.life[i] <= 0) {
        this.lifeAttr[i] = 0;
        continue;
      }
      this.life[i] -= dt;
      const o = i * 3;
      this.vel[o + 1] -= g * dt;
      this.vel[o] *= drag;
      this.vel[o + 2] *= drag;
      this.pos[o] += this.vel[o] * dt;
      this.pos[o + 1] += this.vel[o + 1] * dt;
      this.pos[o + 2] += this.vel[o + 2] * dt;
      this.lifeAttr[i] = Math.max(0, this.life[i] / this.maxLife[i]);
    }
    this.geometry.attributes.position.needsUpdate = true;
    this.geometry.attributes.aLife.needsUpdate = true;
    this.geometry.attributes.aSize.needsUpdate = true;
  }
}
