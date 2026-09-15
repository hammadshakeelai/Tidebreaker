// Small shared helpers.

/** Deterministic PRNG so the islands and clouds are identical every visit. */
export function mulberry32(seed) {
  let a = seed >>> 0;
  return function rng() {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);
export const lerp = (a, b, t) => a + (b - a) * t;

/** Frame-rate independent exponential approach. */
export const damp = (a, b, rate, dt) => b + (a - b) * Math.exp(-rate * dt);

/** Wrap an angle to (-PI, PI]. */
export function wrapAngle(a) {
  a = (a + Math.PI) % (Math.PI * 2);
  if (a < 0) a += Math.PI * 2;
  return a - Math.PI;
}

export function formatTime(seconds, withHundredths = true) {
  if (!Number.isFinite(seconds)) return '--:--.--';
  const s = Math.max(0, seconds);
  const m = Math.floor(s / 60);
  const r = s - m * 60;
  const whole = Math.floor(r);
  const mm = String(m).padStart(2, '0');
  const ss = String(whole).padStart(2, '0');
  if (!withHundredths) return `${mm}:${ss}`;
  const hh = String(Math.floor((r - whole) * 100)).padStart(2, '0');
  return `${mm}:${ss}.${hh}`;
}

export function formatDelta(d) {
  const sign = d < 0 ? '−' : '+';
  return `${sign}${Math.abs(d).toFixed(2)}`;
}

export function ordinal(n) {
  const s = ['th', 'st', 'nd', 'rd'];
  const v = n % 100;
  return n + (s[(v - 20) % 10] || s[v] || s[0]);
}

/** Bearing in degrees where north is +z and east is -x. */
export function headingToBearing(heading) {
  let deg = (-heading * 180) / Math.PI;
  deg %= 360;
  if (deg < 0) deg += 360;
  return deg;
}

const CARDINALS = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'];
export function cardinal(deg) {
  return CARDINALS[Math.round(deg / 45) % 8];
}
