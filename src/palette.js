// Time-of-day palettes. Sky, ocean, fog, clouds and lights all read from here,
// and switching presets cross-fades every colour over a second and a half.
import { Color, Vector3, MathUtils } from 'three';

export const PRESETS = {
  sunrise: {
    label: 'Golden sunrise',
    sky: 'Clear skies',
    skyTop: '#d487c0', skyMid: '#ef9fb8', skyHorizon: '#f7c39c',
    sun: '#fff1c2', halo: '#ffc98e', sunElev: 9, sunAz: 22,
    deep: '#191b6a', mid: '#3a3cb0', shallow: '#33c8dc', foam: '#f6f0ff',
    fog: '#f0b7ab', fogDensity: 0.00095,
    cloud: '#f3b2cf', light: '#ffd7b0', lightI: 2.6, hemiSky: '#f6b6cb', hemiGround: '#3a3c96', hemiI: 1.25,
  },
  noon: {
    label: 'High tide noon',
    sky: 'Bright and breezy',
    skyTop: '#4d8fdc', skyMid: '#8fc0ef', skyHorizon: '#d9eef6',
    sun: '#ffffff', halo: '#fff4d6', sunElev: 48, sunAz: 40,
    deep: '#082c66', mid: '#1462ae', shallow: '#2fd4d0', foam: '#ffffff',
    fog: '#cfe7f2', fogDensity: 0.0008,
    cloud: '#ffffff', light: '#fff6e8', lightI: 2.9, hemiSky: '#bfe0ff', hemiGround: '#1d5a8a', hemiI: 1.3,
  },
  dusk: {
    label: 'Violet dusk',
    sky: 'Evening haze',
    skyTop: '#2f2566', skyMid: '#77499a', skyHorizon: '#f0877a',
    sun: '#ffb877', halo: '#ff8e6e', sunElev: 3, sunAz: 12,
    deep: '#110d36', mid: '#302684', shallow: '#6f5ed8', foam: '#ffd9ef',
    fog: '#b8708e', fogDensity: 0.0011,
    cloud: '#c887b9', light: '#ffae8a', lightI: 1.9, hemiSky: '#a77ac8', hemiGround: '#201c5a', hemiI: 1.05,
  },
};

export const PRESET_ORDER = ['sunrise', 'noon', 'dusk'];

const COLOR_KEYS = {
  uSkyTop: 'skyTop', uSkyMid: 'skyMid', uSkyHorizon: 'skyHorizon',
  uSunColor: 'sun', uHalo: 'halo', uDeep: 'deep', uMid: 'mid',
  uShallow: 'shallow', uFoam: 'foam', uFogColor: 'fog',
};

export const paletteUniforms = {
  uSkyTop: { value: new Color() },
  uSkyMid: { value: new Color() },
  uSkyHorizon: { value: new Color() },
  uSunColor: { value: new Color() },
  uHalo: { value: new Color() },
  uDeep: { value: new Color() },
  uMid: { value: new Color() },
  uShallow: { value: new Color() },
  uFoam: { value: new Color() },
  uFogColor: { value: new Color() },
  uFogDensity: { value: 0.001 },
  uSunDir: { value: new Vector3(0, 0.2, 1).normalize() },
};

export const PALETTE_GLSL = /* glsl */ `
uniform vec3 uSkyTop;
uniform vec3 uSkyMid;
uniform vec3 uSkyHorizon;
uniform vec3 uSunColor;
uniform vec3 uHalo;
uniform vec3 uDeep;
uniform vec3 uMid;
uniform vec3 uShallow;
uniform vec3 uFoam;
uniform vec3 uFogColor;
uniform float uFogDensity;
uniform vec3 uSunDir;

vec3 skyGradient(vec3 dir) {
  float e = dir.y;
  vec3 c = mix(uSkyHorizon, uSkyMid, smoothstep(0.0, 0.2, e));
  c = mix(c, uSkyTop, smoothstep(0.16, 0.8, e));
  c = mix(c, uFogColor, smoothstep(0.0, -0.06, e));
  float sd = max(dot(dir, uSunDir), 0.0);
  c += uHalo * (pow(sd, 5.0) * 0.22 + pow(sd, 42.0) * 0.4);
  return c;
}
`;

function sunDirection(elevDeg, azDeg, out) {
  const e = MathUtils.degToRad(elevDeg);
  const a = MathUtils.degToRad(azDeg);
  return out.set(Math.cos(e) * Math.sin(a), Math.sin(e), Math.cos(e) * Math.cos(a)).normalize();
}

export class Palette {
  constructor() {
    this.key = 'sunrise';
    this.from = {};
    this.to = {};
    for (const u of Object.keys(COLOR_KEYS)) {
      this.from[u] = new Color();
      this.to[u] = new Color();
    }
    this.fromScalars = { fogDensity: 0, lightI: 0, hemiI: 0 };
    this.toScalars = { fogDensity: 0, lightI: 0, hemiI: 0 };
    this.fromSun = new Vector3();
    this.toSun = new Vector3();
    this.extra = { light: [new Color(), new Color()], hemiSky: [new Color(), new Color()], hemiGround: [new Color(), new Color()], cloud: [new Color(), new Color()] };
    this.t = 1;
    this.targets = null;
  }

  /** Objects whose colours follow the palette. */
  bind({ scene, sunLight, hemiLight, cloudMaterial }) {
    this.targets = { scene, sunLight, hemiLight, cloudMaterial };
  }

  get preset() {
    return PRESETS[this.key];
  }

  set(key, instant = false) {
    const p = PRESETS[key] || PRESETS.sunrise;
    this.key = PRESETS[key] ? key : 'sunrise';
    for (const [u, k] of Object.entries(COLOR_KEYS)) {
      this.from[u].copy(paletteUniforms[u].value);
      this.to[u].set(p[k]);
    }
    const tg = this.targets;
    if (tg) {
      this.extra.light[0].copy(tg.sunLight.color);
      this.extra.hemiSky[0].copy(tg.hemiLight.color);
      this.extra.hemiGround[0].copy(tg.hemiLight.groundColor);
      this.extra.cloud[0].copy(tg.cloudMaterial.color);
      this.fromScalars.lightI = tg.sunLight.intensity;
      this.fromScalars.hemiI = tg.hemiLight.intensity;
    }
    this.extra.light[1].set(p.light);
    this.extra.hemiSky[1].set(p.hemiSky);
    this.extra.hemiGround[1].set(p.hemiGround);
    this.extra.cloud[1].set(p.cloud);
    this.fromScalars.fogDensity = paletteUniforms.uFogDensity.value;
    this.toScalars = { fogDensity: p.fogDensity, lightI: p.lightI, hemiI: p.hemiI };
    this.fromSun.copy(paletteUniforms.uSunDir.value);
    sunDirection(p.sunElev, p.sunAz, this.toSun);
    this.t = instant ? 1 : 0;
    this.apply(instant ? 1 : 0);
  }

  cycle() {
    const i = PRESET_ORDER.indexOf(this.key);
    this.set(PRESET_ORDER[(i + 1) % PRESET_ORDER.length]);
    return this.preset;
  }

  update(dt) {
    if (this.t >= 1) return;
    this.t = Math.min(1, this.t + dt / 1.6);
    this.apply(this.t);
  }

  apply(t) {
    const e = t * t * (3 - 2 * t);
    for (const u of Object.keys(COLOR_KEYS)) {
      paletteUniforms[u].value.lerpColors(this.from[u], this.to[u], e);
    }
    paletteUniforms.uFogDensity.value = MathUtils.lerp(this.fromScalars.fogDensity, this.toScalars.fogDensity, e);
    paletteUniforms.uSunDir.value.lerpVectors(this.fromSun, this.toSun, e).normalize();
    const tg = this.targets;
    if (!tg) return;
    tg.sunLight.color.lerpColors(this.extra.light[0], this.extra.light[1], e);
    tg.sunLight.intensity = MathUtils.lerp(this.fromScalars.lightI, this.toScalars.lightI, e);
    tg.hemiLight.color.lerpColors(this.extra.hemiSky[0], this.extra.hemiSky[1], e);
    tg.hemiLight.groundColor.lerpColors(this.extra.hemiGround[0], this.extra.hemiGround[1], e);
    tg.hemiLight.intensity = MathUtils.lerp(this.fromScalars.hemiI, this.toScalars.hemiI, e);
    tg.cloudMaterial.color.lerpColors(this.extra.cloud[0], this.extra.cloud[1], e);
    if (tg.scene.fog) {
      tg.scene.fog.color.copy(paletteUniforms.uFogColor.value);
      tg.scene.fog.density = paletteUniforms.uFogDensity.value;
    }
  }
}
