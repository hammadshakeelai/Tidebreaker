// Faceted low-poly ocean. One mesh, displaced on the GPU with the shared wave
// function and flat-shaded from screen-space derivatives. The grid is uniform
// near the camera (snapped, so facets never crawl) and stretches out towards
// the horizon so the whole sea costs a single draw call.
import { BufferGeometry, Float32BufferAttribute, Mesh, ShaderMaterial } from 'three';
import { WAVE_GLSL, waveUniforms } from './waves.js';
import { PALETTE_GLSL, paletteUniforms } from './palette.js';

const QUALITY = {
  high: { cell: 3.6, inner: 72, growth: 1.06, reach: 3400 },
  low: { cell: 5.0, inner: 40, growth: 1.1, reach: 3200 },
};

function axisCoords({ cell, inner, growth, reach }) {
  const half = [];
  for (let i = 1; i <= inner; i++) half.push(i * cell);
  let p = inner * cell;
  let step = cell;
  while (p < reach) {
    step *= growth;
    p += step;
    half.push(p);
  }
  const coords = half.map((v) => -v).reverse();
  coords.push(0);
  return coords.concat(half);
}

function buildGrid(q) {
  const xs = axisCoords(q);
  const n = xs.length;
  const pos = new Float32Array(n * n * 3);
  let o = 0;
  for (let j = 0; j < n; j++) {
    for (let i = 0; i < n; i++) {
      pos[o++] = xs[i];
      pos[o++] = 0;
      pos[o++] = xs[j];
    }
  }
  const idx = [];
  for (let j = 0; j < n - 1; j++) {
    for (let i = 0; i < n - 1; i++) {
      const a = j * n + i;
      const b = a + 1;
      const c = a + n;
      const d = c + 1;
      // Alternate the diagonal so the facets read as triangles, not stripes.
      if ((i + j) % 2 === 0) idx.push(a, c, b, b, c, d);
      else idx.push(a, c, d, a, d, b);
    }
  }
  const g = new BufferGeometry();
  g.setAttribute('position', new Float32BufferAttribute(pos, 3));
  g.setIndex(idx);
  return g;
}

const vertexShader = /* glsl */ `
${WAVE_GLSL}
varying vec3 vWorld;
varying float vHeight;
void main() {
  vec4 wp = modelMatrix * vec4(position, 1.0);
  float d = length(wp.xz - cameraPosition.xz);
  float fade = 1.0 - smoothstep(1100.0, 2400.0, d);
  float h = waveHeight(wp.xz) * fade;
  wp.y += h;
  vWorld = wp.xyz;
  vHeight = h;
  gl_Position = projectionMatrix * viewMatrix * wp;
}
`;

const fragmentShader = /* glsl */ `
${PALETTE_GLSL}
uniform float uTime;
uniform float uGlitter;
varying vec3 vWorld;
varying float vHeight;

float hash21(vec2 p) {
  p = fract(p * vec2(123.34, 456.21));
  p += dot(p, p + 45.32);
  return fract(p.x * p.y);
}

void main() {
  vec3 n = normalize(cross(dFdx(vWorld), dFdy(vWorld)));
  if (n.y < 0.0) n = -n;

  vec3 toCam = cameraPosition - vWorld;
  float dist = length(toCam);
  vec3 V = toCam / dist;
  float NdV = clamp(dot(n, V), 0.0, 1.0);
  float fres = 0.02 + 0.98 * pow(1.0 - NdV, 5.0);
  float hN = clamp(vHeight * 0.28 + 0.5, 0.0, 1.0);

  // Looking down into the water reads turquoise; grazing angles fall to indigo.
  float look = smoothstep(0.2, 0.78, NdV);
  vec3 body = mix(uDeep, uMid, smoothstep(0.04, 0.32, NdV) * 0.9);
  body = mix(body, uShallow, look * (0.5 + 0.4 * hN));

  // Facet lighting: every triangle takes its own shade from the low sun.
  vec3 L = normalize(vec3(uSunDir.x, max(uSunDir.y, 0.28), uSunDir.z));
  float sunLit = clamp(dot(n, L), 0.0, 1.0);
  float tilt = 1.0 - n.y;
  body *= 0.7 + 0.5 * sunLit + tilt * 0.4;
  // Wave backs turned away from the sun sink toward indigo shadow.
  float away = clamp(-dot(n.xz, normalize(uSunDir.xz + 1e-5)) * 4.0, 0.0, 1.0);
  body = mix(body, uDeep * 0.8, away * 0.38);

  // Sky reflection supplies the pink and peach facets toward the horizon.
  vec3 R = reflect(-V, n);
  R.y = max(R.y, 0.015);
  R = normalize(R);
  vec3 col = mix(body, skyGradient(R) * 0.96, clamp(fres, 0.0, 0.86));

  // Sun: a hard glint, a softer sheen and a wide warm path.
  float sd = max(dot(R, uSunDir), 0.0);
  col += uSunColor * (pow(sd, 1600.0) * 6.0 + pow(sd, 120.0) * 0.55 + pow(sd, 12.0) * 0.08);

  // Glitter: small facets flash on the sun path, only near the camera.
  vec2 cell = floor(vWorld.xz / 1.4);
  float g = hash21(cell + floor(uTime * 5.0) * 0.37);
  float near = 1.0 - smoothstep(40.0, 220.0, dist);
  col += uSunColor * step(0.985, g) * pow(sd, 18.0) * 0.9 * uGlitter * near;

  // Wind-whipped crests.
  col = mix(col, uFoam, smoothstep(1.6, 2.6, vHeight) * 0.3);

  float fog = 1.0 - exp(-uFogDensity * uFogDensity * dist * dist);
  col = mix(col, uFogColor, fog);
  gl_FragColor = vec4(col, 1.0);
  #include <colorspace_fragment>
}
`;

export class Ocean {
  constructor(quality = 'high') {
    this.material = new ShaderMaterial({
      uniforms: { ...waveUniforms, ...paletteUniforms, uGlitter: { value: 1 } },
      vertexShader,
      fragmentShader,
    });
    this.cell = QUALITY.high.cell;
    this.mesh = new Mesh(buildGrid(QUALITY[quality] || QUALITY.high), this.material);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = -1;
    this.setQuality(quality);
  }

  setQuality(quality) {
    const q = QUALITY[quality] || QUALITY.high;
    if (this.quality === quality) return;
    this.quality = quality;
    this.cell = q.cell;
    const old = this.mesh.geometry;
    this.mesh.geometry = buildGrid(q);
    old.dispose();
  }

  update(camera) {
    const c = this.cell;
    this.mesh.position.set(Math.round(camera.position.x / c) * c, 0, Math.round(camera.position.z / c) * c);
  }
}
