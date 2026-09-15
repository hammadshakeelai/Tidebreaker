// Shared wave model. The ocean vertex shader and the boat physics evaluate the
// exact same function, so every hull sits on the surface you actually see.
import { Vector3, Vector4 } from 'three';

const G = 9.81;

// direction (deg), wavelength (m), amplitude (m), phase, crest sharpness
const SPEC = [
  [14, 128, 1.7, 0.0, 1.6],
  [-36, 78, 1.0, 1.7, 1.45],
  [66, 49, 0.58, 4.1, 1.3],
  [152, 32, 0.32, 2.3, 1.15],
  [-104, 21, 0.18, 5.5, 1.0],
  [208, 14, 0.1, 0.9, 1.0],
];

export const WAVE_COUNT = SPEC.length;

const DX = new Float64Array(WAVE_COUNT);
const DZ = new Float64Array(WAVE_COUNT);
const K = new Float64Array(WAVE_COUNT);
const A = new Float64Array(WAVE_COUNT);
const W = new Float64Array(WAVE_COUNT);
const P = new Float64Array(WAVE_COUNT);
const S = new Float64Array(WAVE_COUNT);

const uWaveA = [];
const uWaveB = [];

SPEC.forEach(([deg, len, amp, phase, sharp], i) => {
  const r = (deg * Math.PI) / 180;
  DX[i] = Math.sin(r);
  DZ[i] = Math.cos(r);
  K[i] = (2 * Math.PI) / len;
  A[i] = amp;
  W[i] = Math.sqrt(G * K[i]) * 0.92;
  P[i] = phase;
  S[i] = sharp;
  uWaveA.push(new Vector4(DX[i], DZ[i], K[i], A[i]));
  uWaveB.push(new Vector3(W[i], P[i], S[i]));
});

/** Mutable sea state shared by physics and rendering. */
export const sea = { time: 0, scale: 1 };

export const waveUniforms = {
  uTime: { value: 0 },
  uSeaScale: { value: 1 },
  uWaveA: { value: uWaveA },
  uWaveB: { value: uWaveB },
};

export const WAVE_GLSL = /* glsl */ `
#define WAVE_COUNT ${WAVE_COUNT}
uniform float uTime;
uniform float uSeaScale;
uniform vec4 uWaveA[WAVE_COUNT];
uniform vec3 uWaveB[WAVE_COUNT];

float waveHeight(vec2 p) {
  float h = 0.0;
  for (int i = 0; i < WAVE_COUNT; i++) {
    vec4 a = uWaveA[i];
    vec3 b = uWaveB[i];
    float th = a.z * dot(a.xy, p) - b.x * uTime + b.y;
    float u = clamp(sin(th) * 0.5 + 0.5, 0.0, 1.0);
    h += a.w * (2.0 * pow(u, b.z) - 1.0);
  }
  return h * uSeaScale;
}
`;

/** Surface height at world (x, z). */
export function heightAt(x, z, t = sea.time) {
  let h = 0;
  for (let i = 0; i < WAVE_COUNT; i++) {
    const th = K[i] * (DX[i] * x + DZ[i] * z) - W[i] * t + P[i];
    let u = Math.sin(th) * 0.5 + 0.5;
    if (u < 0) u = 0;
    h += A[i] * (2 * Math.pow(u, S[i]) - 1);
  }
  return h * sea.scale;
}

/** Height plus surface gradient (dh/dx, dh/dz), written into `out`. */
export function sampleSurface(x, z, out, t = sea.time) {
  let h = 0;
  let gx = 0;
  let gz = 0;
  for (let i = 0; i < WAVE_COUNT; i++) {
    const th = K[i] * (DX[i] * x + DZ[i] * z) - W[i] * t + P[i];
    const s = Math.sin(th);
    let u = s * 0.5 + 0.5;
    if (u < 1e-6) u = 1e-6;
    const pw = Math.pow(u, S[i]);
    h += A[i] * (2 * pw - 1);
    // d/dθ [2u^p - 1] = p u^(p-1) cos θ
    const d = A[i] * S[i] * (pw / u) * Math.cos(th) * K[i];
    gx += d * DX[i];
    gz += d * DZ[i];
  }
  const sc = sea.scale;
  out.h = h * sc;
  out.gx = gx * sc;
  out.gz = gz * sc;
  return out;
}
