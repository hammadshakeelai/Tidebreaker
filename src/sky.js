// Sky dome with sun disc, flat-bottomed low-poly clouds and a ring of distant
// island silhouettes. Everything here follows the camera, so it reads as being
// infinitely far away.
import {
  BackSide, Color, Group, IcosahedronGeometry, Mesh, MeshBasicMaterial, ShaderMaterial, SphereGeometry,
  Float32BufferAttribute,
} from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { PALETTE_GLSL, paletteUniforms } from './palette.js';
import { mulberry32 } from './util.js';

const skyVertex = /* glsl */ `
varying vec3 vDir;
void main() {
  vDir = position;
  vec4 p = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  gl_Position = p.xyww;
}
`;

const skyFragment = /* glsl */ `
${PALETTE_GLSL}
varying vec3 vDir;
void main() {
  vec3 dir = normalize(vDir);
  vec3 c = skyGradient(dir);
  float sd = dot(dir, uSunDir);
  float disc = smoothstep(0.99905, 0.99935, sd);
  c = mix(c, uSunColor, disc * 0.92);
  c += uSunColor * pow(max(sd, 0.0), 900.0) * 0.35;
  // Dither to keep the long gradients free of banding.
  float n = fract(sin(dot(gl_FragCoord.xy, vec2(12.9898, 78.233))) * 43758.5453);
  c += (n - 0.5) / 255.0;
  gl_FragColor = vec4(c, 1.0);
  #include <colorspace_fragment>
}
`;

function shadeFaces(geo, sunX, sunZ) {
  const pos = geo.getAttribute('position');
  const count = pos.count;
  const colors = new Float32Array(count * 3);
  for (let i = 0; i < count; i += 3) {
    const ax = pos.getX(i), ay = pos.getY(i), az = pos.getZ(i);
    const bx = pos.getX(i + 1) - ax, by = pos.getY(i + 1) - ay, bz = pos.getZ(i + 1) - az;
    const cx = pos.getX(i + 2) - ax, cy = pos.getY(i + 2) - ay, cz = pos.getZ(i + 2) - az;
    let nx = by * cz - bz * cy;
    let ny = bz * cx - bx * cz;
    let nz = bx * cy - by * cx;
    const l = Math.hypot(nx, ny, nz) || 1;
    nx /= l; ny /= l; nz /= l;
    const b = 0.7 + 0.3 * Math.max(ny, 0) - 0.12 * Math.max(-ny, 0) + 0.07 * (nx * sunX + nz * sunZ);
    for (let v = 0; v < 3; v++) {
      colors[(i + v) * 3] = b;
      colors[(i + v) * 3 + 1] = b;
      colors[(i + v) * 3 + 2] = b;
    }
  }
  geo.setAttribute('color', new Float32BufferAttribute(colors, 3));
  return geo;
}

function puff(rng, r, x, y, z, flatten) {
  const g = new IcosahedronGeometry(r, 1);
  const p = g.getAttribute('position');
  for (let i = 0; i < p.count; i++) {
    let vy = p.getY(i) * flatten;
    if (vy < -r * 0.12) vy = -r * 0.12; // flat undersides
    p.setXYZ(i, p.getX(i) * (1.15 + rng() * 0.1) + x, vy + y, p.getZ(i) + z);
  }
  g.deleteAttribute('uv');
  g.deleteAttribute('normal');
  return g;
}

function buildClouds(rng) {
  const parts = [];
  const clusters = 26;
  for (let c = 0; c < clusters; c++) {
    const ang = (c / clusters) * Math.PI * 2 + rng() * 0.2;
    const dist = 1150 + rng() * 650;
    const cx = Math.sin(ang) * dist;
    const cz = Math.cos(ang) * dist;
    const cy = 70 + rng() * 210;
    const tx = Math.cos(ang);
    const tz = -Math.sin(ang);
    const n = 3 + Math.floor(rng() * 4);
    const size = 26 + rng() * 34;
    for (let i = 0; i < n; i++) {
      const off = (i - (n - 1) / 2) * size * (0.9 + rng() * 0.5);
      const r = size * (0.55 + rng() * 0.55) * (1 - Math.abs(i - (n - 1) / 2) / n * 0.6);
      parts.push(puff(rng, r, cx + tx * off, cy + rng() * size * 0.25, cz + tz * off, 0.56 + rng() * 0.14));
    }
  }
  const merged = mergeGeometries(parts);
  parts.forEach((p) => p.dispose());
  return shadeFaces(merged, 0.4, 0.9);
}

function buildSilhouettes(rng) {
  const parts = [];
  for (let i = 0; i < 38; i++) {
    const ang = rng() * Math.PI * 2;
    const dist = 1750 + rng() * 350;
    const r = 18 + rng() * 55;
    const g = new IcosahedronGeometry(r, 1);
    const p = g.getAttribute('position');
    for (let v = 0; v < p.count; v++) {
      p.setXYZ(v, p.getX(v) * 1.3 + Math.sin(ang) * dist, p.getY(v) * (0.35 + rng() * 0.08) - r * 0.08, p.getZ(v) + Math.cos(ang) * dist);
    }
    g.deleteAttribute('uv');
    g.deleteAttribute('normal');
    parts.push(g);
  }
  const merged = mergeGeometries(parts);
  parts.forEach((p) => p.dispose());
  return shadeFaces(merged, 0.4, 0.9);
}

export class Sky {
  constructor() {
    const rng = mulberry32(90210);
    this.group = new Group();

    this.dome = new Mesh(
      new SphereGeometry(3000, 32, 16),
      new ShaderMaterial({ uniforms: paletteUniforms, vertexShader: skyVertex, fragmentShader: skyFragment, side: BackSide, depthWrite: false }),
    );
    this.dome.frustumCulled = false;
    this.dome.renderOrder = -10;
    this.group.add(this.dome);

    this.cloudMaterial = new MeshBasicMaterial({ vertexColors: true, color: new Color('#f3b2cf'), fog: false });
    this.clouds = new Mesh(buildClouds(rng), this.cloudMaterial);
    this.clouds.frustumCulled = false;
    this.clouds.renderOrder = -9;
    this.group.add(this.clouds);

    this.silhouetteMaterial = new MeshBasicMaterial({ vertexColors: true, color: new Color('#b9707a'), fog: false });
    this.silhouettes = new Mesh(buildSilhouettes(rng), this.silhouetteMaterial);
    this.silhouettes.frustumCulled = false;
    this.group.add(this.silhouettes);
    this._tmp = new Color();
  }

  update(camera, dt) {
    this.group.position.set(camera.position.x, 0, camera.position.z);
    this.clouds.rotation.y += dt * 0.0025;
    // Silhouettes sit in the haze: rock colour pushed most of the way to fog.
    this.silhouetteMaterial.color.copy(this._tmp.set('#9a4f5c')).lerp(paletteUniforms.uFogColor.value, 0.5);
  }
}
