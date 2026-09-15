// Web Audio mixer built around recorded CC0 samples (see CREDITS.md).
// The outboard is three RPM layers crossfaded and pitched with throttle and
// load; water rush, spray hiss and wind follow speed; distant waves wash in at
// random. Everything goes through a gentle compressor so nothing clips.
import { clamp } from './util.js';

const LOOPS = ['engine_low', 'engine_mid', 'engine_high', 'hull_water', 'spray_hiss', 'wind'];
const ONESHOTS = [
  'wave_wash_a', 'wave_wash_b', 'splash_big', 'splash_light', 'splash_med', 'splash_heavy', 'beacon_bell', 'finish_gong',
  'boost_whoosh', 'soft_whoosh', 'ui_confirm', 'ui_go', 'ui_select', 'ui_click', 'ui_open', 'ui_close', 'ui_glass', 'ui_bong',
  'hit_wood', 'hit_plank', 'hit_soft',
];
export const SOUND_NAMES = [...LOOPS, ...ONESHOTS];

function pickExtension() {
  const a = document.createElement('audio');
  return a.canPlayType('audio/ogg; codecs="vorbis"') ? 'ogg' : 'm4a';
}

const smooth = (x) => x * x * (3 - 2 * x);
const band = (x, a, b) => smooth(clamp((x - a) / (b - a), 0, 1));

export class AudioEngine {
  constructor() {
    this.ctx = null;
    this.buffers = new Map();
    this.ext = pickExtension();
    this.muted = false;
    this.volume = 0.8;
    this.musicVolume = 0.5;
    this.nextWash = 2;
    this.loops = {};
    this.ready = false;
    this.lastHover = 0;
  }

  /** Must run inside a user gesture. Safe to call repeatedly. */
  unlock() {
    if (!this.ctx) {
      const Ctx = window.AudioContext || window.webkitAudioContext;
      if (!Ctx) return;
      this.ctx = new Ctx({ latencyHint: 'interactive' });
      const c = this.ctx;
      this.comp = c.createDynamicsCompressor();
      this.comp.threshold.value = -14;
      this.comp.knee.value = 10;
      this.comp.ratio.value = 3.5;
      this.comp.attack.value = 0.006;
      this.comp.release.value = 0.22;
      this.master = c.createGain();
      this.master.gain.value = this.muted ? 0 : this.volume;
      this.comp.connect(this.master).connect(c.destination);
      this.buses = {};
      for (const [name, g] of Object.entries({ engine: 0.9, water: 0.9, sfx: 1, ui: 0.55, music: this.musicVolume * 0.9, amb: 0.6 })) {
        const node = c.createGain();
        node.gain.value = g;
        node.connect(this.comp);
        this.buses[name] = node;
      }
      document.addEventListener('visibilitychange', () => {
        if (!this.ctx) return;
        if (document.hidden) this.ctx.suspend();
        else this.ctx.resume();
      });
      if (this.pendingLoad) this.pendingLoad();
    }
    if (this.ctx.state === 'suspended') this.ctx.resume();
  }

  async fetchAll(onProgress) {
    const names = [...SOUND_NAMES, 'music_harbour'];
    let done = 0;
    const raw = new Map();
    await Promise.all(
      names.map(async (n) => {
        try {
          const res = await fetch(`audio/${n}.${this.ext}`);
          raw.set(n, await res.arrayBuffer());
        } catch (e) {
          console.warn('audio fetch failed', n, e);
        }
        done++;
        if (onProgress) onProgress(done / names.length);
      }),
    );
    this.raw = raw;
  }

  async decodeAll() {
    if (!this.ctx || !this.raw || this.ready) return;
    await Promise.all(
      [...this.raw.entries()].map(async ([n, buf]) => {
        try {
          this.buffers.set(n, await this.ctx.decodeAudioData(buf.slice(0)));
        } catch (e) {
          console.warn('audio decode failed', n, e);
        }
      }),
    );
    this.raw = null;
    this.buildLoops();
    this.ready = true;
  }

  buildLoops() {
    const c = this.ctx;
    const start = (name, bus, chain = []) => {
      const buf = this.buffers.get(name);
      if (!buf) return null;
      const src = c.createBufferSource();
      src.buffer = buf;
      src.loop = true;
      const gain = c.createGain();
      gain.gain.value = 0;
      let node = src;
      for (const n of chain) { node.connect(n); node = n; }
      node.connect(gain).connect(this.buses[bus]);
      src.start(c.currentTime + Math.random() * 0.05);
      return { src, gain };
    };

    this.engineFilter = c.createBiquadFilter();
    this.engineFilter.type = 'lowpass';
    this.engineFilter.frequency.value = 900;
    this.engineFilter.Q.value = 0.8;
    this.engineGain = c.createGain();
    this.engineGain.gain.value = 0;
    this.engineFilter.connect(this.engineGain).connect(this.buses.engine);
    for (const name of ['engine_low', 'engine_mid', 'engine_high']) {
      const buf = this.buffers.get(name);
      if (!buf) continue;
      const src = c.createBufferSource();
      src.buffer = buf;
      src.loop = true;
      const gain = c.createGain();
      gain.gain.value = 0;
      src.connect(gain).connect(this.engineFilter);
      src.start(c.currentTime + Math.random() * 0.05);
      this.loops[name] = { src, gain };
    }

    const waterLp = c.createBiquadFilter();
    waterLp.type = 'lowpass';
    waterLp.frequency.value = 2400;
    this.waterFilter = waterLp;
    this.loops.hull_water = start('hull_water', 'water', [waterLp]);
    this.loops.spray_hiss = start('spray_hiss', 'water');
    const windBp = c.createBiquadFilter();
    windBp.type = 'bandpass';
    windBp.frequency.value = 800;
    windBp.Q.value = 0.6;
    this.windFilter = windBp;
    this.loops.wind = start('wind', 'amb', [windBp]);

    // One shared rival engine, panned toward the nearest rival.
    const buf = this.buffers.get('engine_mid');
    if (buf) {
      const src = c.createBufferSource();
      src.buffer = buf;
      src.loop = true;
      const lp = c.createBiquadFilter();
      lp.type = 'lowpass';
      lp.frequency.value = 1400;
      const pan = c.createStereoPanner();
      const gain = c.createGain();
      gain.gain.value = 0;
      src.connect(lp).connect(pan).connect(gain).connect(this.buses.engine);
      src.start();
      this.rival = { src, pan, gain, lp };
    }
  }

  set(param, value, tc = 0.06) {
    param.setTargetAtTime(value, this.ctx.currentTime, tc);
  }

  play(name, { bus = 'sfx', gain = 1, rate = 1, pan = 0, delay = 0 } = {}) {
    if (!this.ready) return;
    const buf = this.buffers.get(name);
    if (!buf) return;
    const c = this.ctx;
    const src = c.createBufferSource();
    src.buffer = buf;
    src.playbackRate.value = rate;
    const g = c.createGain();
    g.gain.value = gain;
    let node = src.connect(g);
    if (pan) {
      const p = c.createStereoPanner();
      p.pan.value = clamp(pan, -1, 1);
      node = node.connect(p);
    }
    node.connect(this.buses[bus]);
    src.start(c.currentTime + delay);
  }

  ui(name, gain = 1) {
    this.play(name, { bus: 'ui', gain, rate: 0.97 + Math.random() * 0.06 });
  }

  hover() {
    const now = performance.now();
    if (now - this.lastHover < 70) return;
    this.lastHover = now;
    this.play('ui_glass', { bus: 'ui', gain: 0.25, rate: 1.1 + Math.random() * 0.1 });
  }

  startMusic() {
    if (!this.ready || this.music) return;
    const buf = this.buffers.get('music_harbour');
    if (!buf) return;
    const c = this.ctx;
    const src = c.createBufferSource();
    src.buffer = buf;
    src.loop = true;
    const g = c.createGain();
    g.gain.value = 0;
    src.connect(g).connect(this.buses.music);
    src.start();
    this.music = { src, gain: g };
  }

  setMusicLevel(level, tc = 0.8) {
    if (!this.music) return;
    this.set(this.music.gain.gain, level, tc);
  }

  setVolume(v) {
    this.volume = v;
    if (this.master && !this.muted) this.set(this.master.gain, v, 0.05);
  }

  setMusicVolume(v) {
    this.musicVolume = v;
    if (this.buses) this.set(this.buses.music.gain, v * 0.9, 0.05);
  }

  duck(on) {
    if (!this.master || this.muted) return;
    this.set(this.master.gain, on ? this.volume * 0.3 : this.volume, 0.12);
  }

  toggleMute() {
    this.muted = !this.muted;
    if (this.master) this.set(this.master.gain, this.muted ? 0 : this.volume, 0.05);
    return this.muted;
  }

  /** Per-frame mix for the player's boat and the nearest rival. */
  update(dt, boat, { active = true, nearestRival = null, listener = null } = {}) {
    if (!this.ready) return;
    const speed01 = clamp(boat.speed / boat.specs.boostSpeed, 0, 1);
    const r = active ? boat.rpm : 0.08;
    const air = boat.airborne;

    const low = Math.sqrt(1 - band(r, 0.18, 0.52));
    const mid = Math.sqrt(band(r, 0.12, 0.42) * (1 - band(r, 0.62, 0.92)));
    const high = Math.sqrt(band(r, 0.55, 0.95));
    const L = this.loops;
    if (L.engine_low) {
      this.set(L.engine_low.gain.gain, low * 0.9);
      this.set(L.engine_low.src.playbackRate, 0.72 + r * 0.6);
    }
    if (L.engine_mid) {
      this.set(L.engine_mid.gain.gain, mid * 0.85);
      this.set(L.engine_mid.src.playbackRate, 0.78 + r * 0.45);
    }
    if (L.engine_high) {
      this.set(L.engine_high.gain.gain, high * 0.8);
      this.set(L.engine_high.src.playbackRate, 0.8 + r * 0.38);
    }
    const throttle = Math.abs(boat.throttle);
    this.set(this.engineFilter.frequency, 520 + r * r * 4200 + (air ? 1600 : 0) + (boat.boosting ? 900 : 0), 0.08);
    this.set(this.engineGain.gain, active ? 0.3 + throttle * 0.3 + r * 0.25 : 0.18, 0.1);

    const wet = air ? 0.08 : 1;
    if (L.hull_water) {
      this.set(L.hull_water.gain.gain, (0.12 + speed01 * 0.95) * wet, 0.08);
      this.set(L.hull_water.src.playbackRate, 0.82 + speed01 * 0.4);
      this.set(this.waterFilter.frequency, 900 + speed01 * 5200);
    }
    if (L.spray_hiss) {
      const hiss = (band(speed01, 0.35, 0.95) * 0.55 + (boat.drifting ? 0.45 : 0)) * wet;
      this.set(L.spray_hiss.gain.gain, hiss, 0.1);
    }
    if (L.wind) {
      this.set(L.wind.gain.gain, 0.08 + speed01 * speed01 * 0.8 + (air ? 0.25 : 0), 0.15);
      this.set(this.windFilter.frequency, 500 + speed01 * 2600);
    }

    if (this.rival) {
      if (nearestRival && listener) {
        const dx = nearestRival.pos.x - listener.pos.x;
        const dz = nearestRival.pos.z - listener.pos.z;
        const d = Math.hypot(dx, dz);
        const h = listener.heading;
        const side = dx * -Math.cos(h) + dz * Math.sin(h);
        this.set(this.rival.gain.gain, clamp(1 - d / 140, 0, 1) ** 2 * 0.55, 0.12);
        this.set(this.rival.pan.pan, clamp(side / Math.max(d, 1), -1, 1) * 0.8, 0.1);
        this.set(this.rival.src.playbackRate, 0.85 + nearestRival.rpm * 0.4);
      } else {
        this.set(this.rival.gain.gain, 0, 0.2);
      }
    }

    // Distant waves wash past now and then.
    this.nextWash -= dt;
    if (this.nextWash <= 0) {
      this.nextWash = 3 + Math.random() * 5;
      this.play(Math.random() < 0.5 ? 'wave_wash_a' : 'wave_wash_b', {
        bus: 'amb', gain: 0.25 + Math.random() * 0.25, rate: 0.78 + Math.random() * 0.2, pan: Math.random() * 1.6 - 0.8,
      });
    }
  }

  landing(impact, airTime) {
    const s = clamp(impact / 12, 0, 1);
    if (s < 0.08) return;
    const name = s > 0.7 ? 'splash_heavy' : s > 0.4 ? 'splash_big' : s > 0.2 ? 'splash_med' : 'splash_light';
    this.play(name, { gain: 0.35 + s * 0.65, rate: 0.9 + Math.random() * 0.2 });
    if (airTime > 0.8) this.play('soft_whoosh', { gain: 0.3, rate: 0.8 });
  }

  hit(strength, kind) {
    const s = clamp(strength / 18, 0.15, 1);
    if (kind === 'boat') this.play('hit_soft', { gain: s, rate: 0.85 + Math.random() * 0.2 });
    else if (kind === 'buoy') this.play('hit_plank', { gain: s * 0.8, rate: 1.1 });
    else {
      this.play('hit_wood', { gain: s, rate: 0.7 + Math.random() * 0.15 });
      this.play('splash_light', { gain: s * 0.7 });
    }
  }
}
