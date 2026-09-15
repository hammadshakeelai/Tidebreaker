// Wake ribbons and spray. The wake is a strip mesh laid on the live wave surface
// (displaced in its vertex shader); spray is one pooled Points cloud for every
// boat in the race. Both are a single draw call each.
import {
  AdditiveBlending, BufferAttribute, BufferGeometry, DoubleSide, DynamicDrawUsage, Mesh, NormalBlending, Points,
  ShaderMaterial,
} from 'three';
import { WAVE_GLSL, waveUniforms } from './waves.js';
import { paletteUniforms } from './palette.js';

const SEG = 64;
const LIFE = 3.2;

const wakeVertex = /* glsl */ `
${WAVE_GLSL}
attribute vec3 aData;
varying vec3 vData;
varying vec3 vWorld;
void main() {
  vec3 p = position;
  // Lift clear of the faceted surface, which can sit above the true curve.
  float d = length(p.xz - cameraPosition.xz);
  p.y = waveHeight(p.xz) + 0.35 + d * 0.004;
  vData = aData;
  vWorld = p;
  gl_Position = projectionMatrix * viewMatrix * vec4(p, 1.0);
}
`;

const wakeFragment = /* glsl */ `
uniform vec3 uFoam;
uniform vec3 uShallow;
varying vec3 vData;
varying vec3 vWorld;
float hash(vec2 p) { return fract(sin(dot(p, vec2(41.3, 289.1))) * 43758.5453); }
void main() {
  float age = vData.x;
  float edge = abs(vData.y);
  float strength = vData.z;
  float life = 1.0 - age;
  float core = 1.0 - smoothstep(0.05, 1.0, edge);
  float n = hash(floor(vWorld.xz * vec2(1.3, 0.8)));
  float streak = step(0.6 - 0.25 * life, n) * smoothstep(0.25, 0.85, edge) * (1.0 - smoothstep(0.92, 1.0, edge));
  vec3 col = mix(uShallow * 1.7 + vec3(0.28, 0.34, 0.36), uFoam, 0.2 + streak * 0.8);
  float a = strength * life * life * (core * 0.62 + streak * 0.95);
  gl_FragColor = vec4(col, a);
  #include <colorspace_fragment>
}
`;

export class Wake {
  constructor() {
    this.samples = new Float32Array(SEG * 6); // x, z, rx, rz, t, strength
    this.count = 0;
    this.lastX = 0;
    this.lastZ = 0;
    this.lastT = -1;

    const geo = new BufferGeometry();
    this.positions = new Float32Array(SEG * 2 * 3);
    this.data = new Float32Array(SEG * 2 * 3);
    geo.setAttribute('position', new BufferAttribute(this.positions, 3).setUsage(DynamicDrawUsage));
    geo.setAttribute('aData', new BufferAttribute(this.data, 3).setUsage(DynamicDrawUsage));
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
        uniforms: { ...waveUniforms, uFoam: paletteUniforms.uFoam, uShallow: paletteUniforms.uShallow },
        vertexShader: wakeVertex,
        fragmentShader: wakeFragment,
        transparent: true,
        depthWrite: false,
        blending: AdditiveBlending,
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
      s.copyWithin(6, 0, (SEG - 1) * 6);
      this.count = Math.min(SEG, this.count + 1);
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

    const p = this.positions;
    const d = this.data;
    let live = 0;
    for (let i = 0; i < this.count; i++) {
      const o = i * 6;
      const age = (time - s[o + 4]) / LIFE;
      if (age >= 1) break;
      const w = 0.8 + age * LIFE * 2.4;
      const v = i * 6;
      p[v] = s[o] - s[o + 2] * w;
      p[v + 1] = 0;
      p[v + 2] = s[o + 1] - s[o + 3] * w;
      p[v + 3] = s[o] + s[o + 2] * w;
      p[v + 4] = 0;
      p[v + 5] = s[o + 1] + s[o + 3] * w;
      d[v] = age;
      d[v + 1] = -1;
      d[v + 2] = s[o + 5];
      d[v + 3] = age;
      d[v + 4] = 1;
      d[v + 5] = s[o + 5];
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
