// Tidebreak Sound: the course, rock islands with surf rings, and the tide
// beacons. Islands are merged into one mesh, surf into another.
import {
  AdditiveBlending, BufferGeometry, Color, CylinderGeometry, DoubleSide, Float32BufferAttribute, Group,
  IcosahedronGeometry, Mesh, MeshBasicMaterial, MeshLambertMaterial, RingGeometry, ShaderMaterial,
} from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { WAVE_GLSL, waveUniforms, heightAt } from './waves.js';
import { paletteUniforms } from './palette.js';
import { mulberry32 } from './util.js';

export const START = { x: 0, z: -34 };

const CHECKPOINTS = [
  { name: 'Marisol', x: 110, z: 420, radius: 25 },
  { name: 'Pelican Reef', x: 505, z: 615, radius: 25 },
  { name: 'Driftwood Light', x: 790, z: 238, radius: 25 },
  { name: 'Coral Spire', x: 520, z: -215, radius: 25 },
  { name: 'Halyard Point', x: 132, z: -338, radius: 25 },
  { name: 'Tidebreak Gate', x: 0, z: 0, radius: 28, gate: true },
];

// Hand-placed islands that shape the racing lines.
const KEY_ISLANDS = [
  { x: 36, z: 220, r: 34, h: 0.55 },
  { x: 300, z: 548, r: 27, h: 0.6 },
  { x: 672, z: 470, r: 44, h: 0.5 },
  { x: 700, z: -18, r: 32, h: 0.62 },
  { x: 330, z: -300, r: 38, h: 0.48 },
  { x: 76, z: -172, r: 18, h: 0.7 },
  { x: 250, z: 300, r: 58, h: 0.42 },
  { x: 440, z: 120, r: 70, h: 0.4 },
];

const STACKS = [
  { x: 150, z: 470, r: 6, h: 32 },
  { x: 548, z: 650, r: 7, h: 38 },
  { x: 832, z: 200, r: 8, h: 44 },
  { x: 484, z: -250, r: 6, h: 30 },
  { x: -40, z: 30, r: 5, h: 22 },
];

function distToSegment(px, pz, ax, az, bx, bz) {
  const abx = bx - ax;
  const abz = bz - az;
  const t = Math.max(0, Math.min(1, ((px - ax) * abx + (pz - az) * abz) / (abx * abx + abz * abz)));
  return Math.hypot(px - (ax + abx * t), pz - (az + abz * t));
}

function colorFaces(geo, pick) {
  const pos = geo.getAttribute('position');
  const colors = new Float32Array(pos.count * 3);
  const c = new Color();
  for (let i = 0; i < pos.count; i += 3) {
    const y = (pos.getY(i) + pos.getY(i + 1) + pos.getY(i + 2)) / 3;
    const ax = pos.getX(i), ay = pos.getY(i), az = pos.getZ(i);
    const bx = pos.getX(i + 1) - ax, by = pos.getY(i + 1) - ay, bz = pos.getZ(i + 1) - az;
    const cx = pos.getX(i + 2) - ax, cy = pos.getY(i + 2) - ay, cz = pos.getZ(i + 2) - az;
    const nx = by * cz - bz * cy, ny = bz * cx - bx * cz, nz = bx * cy - by * cx;
    const up = ny / (Math.hypot(nx, ny, nz) || 1);
    pick(c, y, up);
    for (let v = 0; v < 3; v++) {
      colors[(i + v) * 3] = c.r;
      colors[(i + v) * 3 + 1] = c.g;
      colors[(i + v) * 3 + 2] = c.b;
    }
  }
  geo.setAttribute('color', new Float32BufferAttribute(colors, 3));
  return geo;
}

const ROCK_WET = new Color('#6e3446');
const ROCK = new Color('#b35a56');
const ROCK_HI = new Color('#de8a6c');
const GRASS = new Color('#8fa46a');

function islandGeometry(rng, isl) {
  const g = new IcosahedronGeometry(isl.r, 2);
  const p = g.getAttribute('position');
  const seedA = rng() * 10, seedB = rng() * 10;
  const peak = isl.r * isl.h;
  const hasGrass = rng() < 0.45;
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i) / isl.r, y = p.getY(i) / isl.r, z = p.getZ(i) / isl.r;
    const n = 1 + 0.14 * Math.sin(x * 3.1 + seedA) * Math.cos(z * 2.7 + seedB) + 0.07 * Math.sin((x + z) * 6.3 + seedB);
    p.setXYZ(i, x * isl.r * n * 1.05, Math.max(y, -0.25) * peak * n - peak * 0.12, z * isl.r * n * 1.05);
  }
  g.deleteAttribute('uv');
  g.deleteAttribute('normal');
  g.translate(isl.x, 0, isl.z);
  return colorFaces(g, (c, y, up) => {
    if (y < 1.4) c.copy(ROCK_WET);
    else {
      const t = Math.min(1, y / (peak * 0.85));
      c.copy(ROCK).lerp(ROCK_HI, t * 0.8 * (0.6 + 0.4 * up));
      if (hasGrass && up > 0.82 && t > 0.55) c.copy(GRASS).lerp(ROCK_HI, 0.15);
    }
  });
}

function stackGeometry(rng, s) {
  const g = new CylinderGeometry(s.r * 0.55, s.r, s.h, 6, 4).toNonIndexed();
  const p = g.getAttribute('position');
  for (let i = 0; i < p.count; i++) {
    const y = p.getY(i);
    const wob = 1 + 0.18 * Math.sin(y * 0.4 + s.x);
    p.setXYZ(i, p.getX(i) * wob, y, p.getZ(i) * wob);
  }
  g.deleteAttribute('uv');
  g.deleteAttribute('normal');
  g.rotateY(rng() * Math.PI);
  g.translate(s.x, s.h * 0.5 - 2, s.z);
  return colorFaces(g, (c, y, up) => {
    c.copy(y < 1.5 ? ROCK_WET : ROCK).lerp(ROCK_HI, Math.max(0, up) * 0.5 + Math.min(1, y / s.h) * 0.25);
  });
}

const surfVertex = /* glsl */ `
${WAVE_GLSL}
attribute float aRad;
attribute float aAng;
varying float vRad;
varying float vAng;
varying vec3 vWorld;
void main() {
  vec4 wp = modelMatrix * vec4(position, 1.0);
  wp.y = waveHeight(wp.xz) + 0.12;
  vRad = aRad;
  vAng = aAng;
  vWorld = wp.xyz;
  vec4 clip = projectionMatrix * viewMatrix * wp;
  // Depth-only bias toward the camera so the faceted sea never slices the ring.
  vec3 toCam = cameraPosition - wp.xyz;
  float dist = length(toCam);
  vec3 V = toCam / dist;
  float bias = min(clamp(0.35 / max(V.y, 0.05), 0.3, 5.0), dist * 0.5);
  vec4 biased = projectionMatrix * viewMatrix * vec4(wp.xyz + V * bias, 1.0);
  clip.z = biased.z / biased.w * clip.w;
  gl_Position = clip;
}
`;

const surfFragment = /* glsl */ `
uniform float uTime;
uniform vec3 uFoam;
uniform vec3 uFogColor;
uniform float uFogDensity;
varying float vRad;
varying float vAng;
varying vec3 vWorld;
float hash(vec2 p) { return fract(sin(dot(p, vec2(12.7, 311.7))) * 43758.5453); }
void main() {
  float band = 1.0 - smoothstep(0.0, 1.0, vRad);
  // Foam patches follow the ring's own segments, so they hug the shore as
  // facets instead of forming a world-aligned checkerboard.
  float cell = floor(vAng * 2.0);
  float row = floor(vRad * 3.0);
  float tick = floor(uTime * 1.1 + hash(vec2(cell, 3.1)) * 5.0);
  float n = hash(vec2(cell, row) + tick * 0.618);
  float lap = 0.8 + 0.2 * sin(uTime * 1.4 - vRad * 5.0 + cell * 0.9);
  float foam = band * lap * (0.4 + 0.6 * step(0.5, n));
  float dist = length(cameraPosition - vWorld);
  float fog = 1.0 - exp(-uFogDensity * uFogDensity * dist * dist);
  gl_FragColor = vec4(mix(uFoam, uFogColor, fog), foam * 0.7 * (1.0 - fog));
  #include <colorspace_fragment>
}
`;

const beamVertex = /* glsl */ `
varying float vY;
varying vec3 vNormalW;
varying vec3 vWorld;
void main() {
  vY = uv.y;
  vec4 wp = modelMatrix * vec4(position, 1.0);
  vWorld = wp.xyz;
  vNormalW = normalize(mat3(modelMatrix) * normal);
  gl_Position = projectionMatrix * viewMatrix * wp;
}
`;

const beamFragment = /* glsl */ `
uniform vec3 uColor;
uniform float uIntensity;
varying float vY;
varying vec3 vNormalW;
varying vec3 vWorld;
void main() {
  vec3 V = normalize(cameraPosition - vWorld);
  float rim = pow(abs(dot(normalize(vNormalW.xz), normalize(V.xz))), 1.5);
  float fade = pow(1.0 - vY, 1.8) * smoothstep(0.0, 0.03, vY);
  gl_FragColor = vec4(uColor, rim * fade * uIntensity);
  #include <colorspace_fragment>
}
`;

const ringFragment = /* glsl */ `
uniform vec3 uColor;
uniform float uIntensity;
uniform float uTime;
varying vec2 vUv;
varying vec3 vWorld;
void main() {
  float ang = atan(vWorld.z - uCenter.y, vWorld.x - uCenter.x);
  float dash = step(0.5, fract(ang * 6.0 + uTime * 0.25));
  gl_FragColor = vec4(uColor, (0.35 + 0.65 * dash) * uIntensity);
  #include <colorspace_fragment>
}
`;

const ringVertex = /* glsl */ `
${WAVE_GLSL}
varying vec2 vUv;
varying vec3 vWorld;
void main() {
  vUv = uv;
  vec4 wp = modelMatrix * vec4(position, 1.0);
  wp.y = waveHeight(wp.xz) + 0.4 + length(wp.xz - cameraPosition.xz) * 0.005;
  vWorld = wp.xyz;
  gl_Position = projectionMatrix * viewMatrix * wp;
}
`;

const BEACON_COLORS = {
  pending: new Color('#fff1e6'),
  next: new Color('#5ce1e6'),
  lit: new Color('#ffcf8f'),
};

function buildBeacon(cp) {
  const group = new Group();
  const parts = [];
  const paintGeo = (geo, color) => {
    const g = geo.index ? geo.toNonIndexed() : geo;
    g.deleteAttribute('uv');
    const c = new Color(color);
    const n = g.getAttribute('position').count;
    const arr = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) { arr[i * 3] = c.r; arr[i * 3 + 1] = c.g; arr[i * 3 + 2] = c.b; }
    g.setAttribute('color', new Float32BufferAttribute(arr, 3));
    return g;
  };
  const pylons = cp.gate ? [-(cp.radius + 3), cp.radius + 3] : [0];
  for (const off of pylons) {
    const a = new CylinderGeometry(1.5, 1.9, 0.9, 8); a.translate(off, 0.2, 0); parts.push(paintGeo(a, '#f4ede6'));
    const b = new CylinderGeometry(1.35, 1.5, 0.8, 8); b.translate(off, 1.05, 0); parts.push(paintGeo(b, '#ef6f5e'));
    const m = new CylinderGeometry(0.16, 0.24, 8, 6); m.translate(off, 5.4, 0); parts.push(paintGeo(m, '#efe6da'));
    const cage = new CylinderGeometry(0.2, 0.9, 0.6, 6); cage.translate(off, 9.9, 0); parts.push(paintGeo(cage, '#3a3346'));
  }
  const body = new Mesh(mergeGeometries(parts), new MeshLambertMaterial({ vertexColors: true, flatShading: true }));
  parts.forEach((p) => p.dispose());
  group.add(body);

  const lampMat = new MeshBasicMaterial({ color: BEACON_COLORS.pending.clone(), fog: false });
  const beamMat = new ShaderMaterial({
    uniforms: { uColor: { value: BEACON_COLORS.pending.clone() }, uIntensity: { value: 0.25 } },
    vertexShader: beamVertex,
    fragmentShader: beamFragment,
    transparent: true,
    depthWrite: false,
    blending: AdditiveBlending,
    side: DoubleSide,
  });
  for (const off of pylons) {
    const lamp = new Mesh(new IcosahedronGeometry(0.75, 0), lampMat);
    lamp.position.set(off, 9.2, 0);
    group.add(lamp);
    const beam = new Mesh(new CylinderGeometry(3.2, 1.0, 150, 12, 1, true), beamMat);
    beam.geometry.translate(0, 75, 0);
    beam.position.set(off, 9, 0);
    beam.frustumCulled = false;
    beam.renderOrder = 4;
    group.add(beam);
  }

  const ringMat = new ShaderMaterial({
    uniforms: {
      ...waveUniforms,
      uColor: { value: BEACON_COLORS.pending.clone() },
      uIntensity: { value: 0.3 },
      uCenter: { value: { x: cp.x, y: cp.z } },
    },
    vertexShader: ringVertex,
    fragmentShader: `uniform vec2 uCenter;\n${ringFragment}`,
    transparent: true,
    depthWrite: false,
    blending: AdditiveBlending,
  });
  const ring = new Mesh(new RingGeometry(cp.radius - 1.1, cp.radius, 72, 1), ringMat);
  ring.geometry.rotateX(-Math.PI / 2);
  ring.position.set(cp.x, 0, cp.z);
  ring.frustumCulled = false;
  ring.renderOrder = 2;

  group.position.set(cp.x, 0, cp.z);
  return { group, ring, lampMat, beamMat, ringMat, state: 'pending', pulse: 0 };
}

export class World {
  constructor(scene) {
    const rng = mulberry32(4242);
    this.scene = scene;
    this.checkpoints = CHECKPOINTS.map((c) => ({ ...c }));
    this.islands = [...KEY_ISLANDS];

    // Scatter extra islands that stay clear of the racing lines.
    const legs = [];
    let prev = START;
    for (const cp of this.checkpoints) {
      legs.push([prev.x, prev.z, cp.x, cp.z]);
      prev = cp;
    }
    const cx = 390, cz = 140;
    let tries = 0;
    while (this.islands.length < KEY_ISLANDS.length + 34 && tries++ < 3000) {
      const a = rng() * Math.PI * 2;
      const d = 120 + Math.sqrt(rng()) * 1250;
      const isl = { x: cx + Math.sin(a) * d, z: cz + Math.cos(a) * d, r: 16 + rng() * rng() * 60, h: 0.35 + rng() * 0.35 };
      const clearLeg = legs.every(([ax, az, bx, bz]) => distToSegment(isl.x, isl.z, ax, az, bx, bz) > isl.r + 55);
      const clearCp = this.checkpoints.every((c) => Math.hypot(isl.x - c.x, isl.z - c.z) > isl.r + 90);
      const clearIsl = this.islands.every((o) => Math.hypot(isl.x - o.x, isl.z - o.z) > isl.r + o.r + 30);
      if (clearLeg && clearCp && clearIsl) this.islands.push(isl);
    }

    // Rocks
    const parts = this.islands.map((isl) => islandGeometry(rng, isl));
    STACKS.forEach((s) => parts.push(stackGeometry(rng, s)));
    const rockGeo = mergeGeometries(parts);
    parts.forEach((p) => p.dispose());
    rockGeo.computeVertexNormals();
    this.rocks = new Mesh(rockGeo, new MeshLambertMaterial({ vertexColors: true, flatShading: true }));
    scene.add(this.rocks);

    // Surf rings
    const rings = [];
    for (const isl of [...this.islands, ...STACKS]) {
      const inner = isl.r * 0.9;
      const outer = isl.r * 1.18 + 6;
      const seg = Math.max(18, Math.round(isl.r * 1.2));
      const rg = new RingGeometry(inner, outer, seg, 2);
      rg.rotateX(-Math.PI / 2);
      const pos = rg.getAttribute('position');
      const rad = new Float32Array(pos.count);
      const ang = new Float32Array(pos.count);
      for (let i = 0; i < pos.count; i++) {
        rad[i] = (Math.hypot(pos.getX(i), pos.getZ(i)) - inner) / (outer - inner);
        // RingGeometry lays out (seg + 1) vertices per radial row, so this is
        // the segment index around the ring with no wrap seam.
        ang[i] = i % (seg + 1);
      }
      rg.setAttribute('aRad', new Float32BufferAttribute(rad, 1));
      rg.setAttribute('aAng', new Float32BufferAttribute(ang, 1));
      rg.deleteAttribute('uv');
      rg.deleteAttribute('normal');
      rg.translate(isl.x, 0, isl.z);
      rings.push(rg);
    }
    const surfGeo = mergeGeometries(rings);
    rings.forEach((r) => r.dispose());
    this.surf = new Mesh(
      surfGeo,
      new ShaderMaterial({
        uniforms: { ...waveUniforms, uFoam: paletteUniforms.uFoam, uFogColor: paletteUniforms.uFogColor, uFogDensity: paletteUniforms.uFogDensity },
        vertexShader: surfVertex,
        fragmentShader: surfFragment,
        transparent: true,
        depthWrite: false,
      }),
    );
    this.surf.frustumCulled = false;
    this.surf.renderOrder = 1;
    scene.add(this.surf);

    // Colliders: rock circles at the waterline, soft buoys at each beacon.
    this.colliders = [
      ...this.islands.map((i) => ({ x: i.x, z: i.z, r: i.r * 0.98 })),
      ...STACKS.map((s) => ({ x: s.x, z: s.z, r: s.r + 0.5 })),
    ];
    this.beacons = this.checkpoints.map((cp) => {
      const b = buildBeacon(cp);
      scene.add(b.group);
      scene.add(b.ring);
      if (cp.gate) {
        for (const off of [-(cp.radius + 3), cp.radius + 3]) this.colliders.push({ x: cp.x + off, z: cp.z, r: 1.9, soft: true });
      } else {
        this.colliders.push({ x: cp.x, z: cp.z, r: 1.9, soft: true });
      }
      return b;
    });

    this.computeRacingLine();
    this.bounds = { x: cx, z: cz, r: 1650 };
  }

  /** Apex points and detours around islands, used by AI skippers. */
  computeRacingLine() {
    const cps = this.checkpoints;
    const n = cps.length;
    for (let i = 0; i < n; i++) {
      const cp = cps[i];
      const prev = i === 0 ? START : cps[i - 1];
      const next = cps[(i + 1) % n];
      if (cp.gate) {
        cp.apexX = cp.x;
        cp.apexZ = cp.z;
        continue;
      }
      let inX = cp.x - prev.x, inZ = cp.z - prev.z;
      let outX = next.x - cp.x, outZ = next.z - cp.z;
      const li = Math.hypot(inX, inZ), lo = Math.hypot(outX, outZ);
      inX /= li; inZ /= li; outX /= lo; outZ /= lo;
      let ix = outX - inX, iz = outZ - inZ;
      const l = Math.hypot(ix, iz) || 1;
      ix /= l; iz /= l;
      cp.apexX = cp.x + ix * 8;
      cp.apexZ = cp.z + iz * 8;
    }
    this.legs = [];
    for (let i = 0; i < n; i++) {
      const from = i === 0 ? START : { x: cps[i - 1].apexX, z: cps[i - 1].apexZ };
      const to = { x: cps[i].apexX, z: cps[i].apexZ };
      const pts = [];
      const blockers = this.islands
        .map((isl) => {
          const abx = to.x - from.x, abz = to.z - from.z;
          const len2 = abx * abx + abz * abz;
          const t = ((isl.x - from.x) * abx + (isl.z - from.z) * abz) / len2;
          return { isl, t };
        })
        .filter(({ isl, t }) => t > 0.02 && t < 0.98 && distToSegment(isl.x, isl.z, from.x, from.z, to.x, to.z) < isl.r + 14)
        .sort((a, b) => a.t - b.t);
      for (const { isl } of blockers) {
        const abx = to.x - from.x, abz = to.z - from.z;
        const len = Math.hypot(abx, abz);
        const px = -abz / len, pz = abx / len;
        const side = (isl.x - from.x) * px + (isl.z - from.z) * pz > 0 ? -1 : 1;
        const clear = isl.r + 24;
        const along = [-0.9, 0, 0.9];
        for (const k of along) {
          pts.push({ x: isl.x + px * side * clear + (abx / len) * isl.r * k, z: isl.z + pz * side * clear + (abz / len) * isl.r * k });
        }
      }
      pts.push(to);
      this.legs.push(pts);
    }
  }

  gridSlot(i) {
    const cp = this.checkpoints[0];
    const heading = Math.atan2(cp.x - START.x, cp.z - START.z);
    const rx = -Math.cos(heading), rz = Math.sin(heading);
    const fx = Math.sin(heading), fz = Math.cos(heading);
    const col = (i % 2) * 2 - 1;
    const row = Math.floor(i / 2);
    return {
      x: START.x + rx * col * 5 - fx * row * 9,
      z: START.z + rz * col * 5 - fz * row * 9,
      heading,
    };
  }

  setBeaconState(index, state) {
    const b = this.beacons[index];
    if (!b || b.state === state) return;
    b.state = state;
    b.pulse = state === 'lit' ? 1 : 0;
    const c = BEACON_COLORS[state];
    b.lampMat.color.copy(c);
    b.beamMat.uniforms.uColor.value.copy(c);
    b.ringMat.uniforms.uColor.value.copy(c);
  }

  resetBeacons(nextIndex = 0) {
    this.beacons.forEach((b, i) => this.setBeaconState(i, i === nextIndex ? 'next' : 'pending'));
  }

  update(dt, time) {
    for (const b of this.beacons) {
      const x = b.group.position.x, z = b.group.position.z;
      b.group.position.y = heightAt(x, z, time) * 0.85 - 0.2;
      b.group.rotation.z = Math.sin(time * 0.9 + x) * 0.04;
      b.group.rotation.x = Math.cos(time * 0.8 + z) * 0.04;
      b.pulse = Math.max(0, b.pulse - dt * 0.8);
      const base = b.state === 'next' ? 0.95 + Math.sin(time * 3) * 0.15 : b.state === 'lit' ? 0.55 : 0.16;
      b.beamMat.uniforms.uIntensity.value = base + b.pulse * 1.5;
      b.ringMat.uniforms.uIntensity.value = b.state === 'next' ? 0.9 : b.state === 'lit' ? 0.3 : 0.07;
    }
  }
}
