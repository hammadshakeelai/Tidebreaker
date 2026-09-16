// Reproducible audio pipeline.
//   node tools/audio/build-audio.mjs
// Downloads the CC0 source files listed in sources.json, trims them, turns
// loops into seamless loops with a crossfade, normalises levels and encodes
// Ogg Vorbis + AAC copies into public/audio/. Requires ffmpeg on PATH.
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..', '..');
const cache = join(here, '.cache');
const out = join(root, 'public', 'audio');
mkdirSync(cache, { recursive: true });
mkdirSync(out, { recursive: true });

const { sources, outputs } = JSON.parse(readFileSync(join(here, 'sources.json'), 'utf8'));
const RATE = 44100;
// Padding around every loop, in seconds. See the comment in the output loop.
const LOOP_PAD = 0.05;

async function fetchSource(src) {
  const file = join(cache, src.file);
  if (existsSync(file)) return file;
  process.stdout.write(`download ${src.file} ... `);
  const res = await fetch(src.url);
  if (!res.ok) throw new Error(`${src.url} -> ${res.status}`);
  writeFileSync(file, Buffer.from(await res.arrayBuffer()));
  console.log('ok');
  return file;
}

function decode(file, channels) {
  const r = spawnSync('ffmpeg', ['-v', 'error', '-i', file, '-f', 'f32le', '-ac', String(channels), '-ar', String(RATE), '-'], {
    maxBuffer: 1 << 29,
  });
  if (r.status !== 0) throw new Error(r.stderr.toString());
  const b = r.stdout;
  return new Float32Array(b.buffer, b.byteOffset, b.byteLength / 4).slice();
}

function frames(data, ch) {
  return data.length / ch;
}

function trim(data, ch, start = 0, end = 0) {
  const n = frames(data, ch);
  const a = Math.floor(start * RATE);
  const b = end > 0 ? Math.min(n, Math.floor(end * RATE)) : n;
  return data.slice(a * ch, b * ch);
}

function rms(data) {
  let s = 0;
  for (let i = 0; i < data.length; i++) s += data[i] * data[i];
  return Math.sqrt(s / data.length);
}

function peak(data) {
  let p = 0;
  for (let i = 0; i < data.length; i++) p = Math.max(p, Math.abs(data[i]));
  return p;
}

/** Jump at the wrap point relative to the average sample-to-sample step. */
function seamScore(data, ch) {
  const n = frames(data, ch);
  let step = 0;
  for (let i = 1; i < n; i++) for (let c = 0; c < ch; c++) step += Math.abs(data[i * ch + c] - data[(i - 1) * ch + c]);
  step /= (n - 1) * ch;
  let jump = 0;
  for (let c = 0; c < ch; c++) jump += Math.abs(data[c] - data[(n - 1) * ch + c]);
  jump /= ch;
  return step > 0 ? jump / step : 0;
}

function makeLoop(data, ch, fadeSec, curve) {
  const n = frames(data, ch);
  const f = Math.min(Math.floor(fadeSec * RATE), Math.floor(n / 3));
  const len = n - f;
  const res = new Float32Array(len * ch);
  for (let i = 0; i < len - f; i++) {
    for (let c = 0; c < ch; c++) res[i * ch + c] = data[(i + f) * ch + c];
  }
  for (let j = 0; j < f; j++) {
    const w = j / f;
    const fin = curve === 'power' ? Math.sin((w * Math.PI) / 2) : w;
    const fout = curve === 'power' ? Math.cos((w * Math.PI) / 2) : 1 - w;
    for (let c = 0; c < ch; c++) {
      res[(len - f + j) * ch + c] = data[(n - f + j) * ch + c] * fout + data[j * ch + c] * fin;
    }
  }
  return res;
}

function fadeEdges(data, ch, inSec, outSec) {
  const n = frames(data, ch);
  const fi = Math.floor(inSec * RATE);
  const fo = Math.floor(outSec * RATE);
  for (let i = 0; i < fi && i < n; i++) for (let c = 0; c < ch; c++) data[i * ch + c] *= i / fi;
  for (let i = 0; i < fo && i < n; i++) for (let c = 0; c < ch; c++) data[(n - 1 - i) * ch + c] *= i / fo;
  return data;
}

function scale(data, g) {
  for (let i = 0; i < data.length; i++) data[i] *= g;
  return data;
}

function writeWav(path, data, ch) {
  const n = frames(data, ch);
  const buf = Buffer.alloc(44 + n * ch * 2);
  buf.write('RIFF', 0);
  buf.writeUInt32LE(36 + n * ch * 2, 4);
  buf.write('WAVE', 8);
  buf.write('fmt ', 12);
  buf.writeUInt32LE(16, 16);
  buf.writeUInt16LE(1, 20);
  buf.writeUInt16LE(ch, 22);
  buf.writeUInt32LE(RATE, 24);
  buf.writeUInt32LE(RATE * ch * 2, 28);
  buf.writeUInt16LE(ch * 2, 32);
  buf.writeUInt16LE(16, 34);
  buf.write('data', 36);
  buf.writeUInt32LE(n * ch * 2, 40);
  for (let i = 0; i < data.length; i++) {
    const v = Math.max(-1, Math.min(1, data[i]));
    buf.writeInt16LE(Math.round(v * 32767), 44 + i * 2);
  }
  writeFileSync(path, buf);
}

function encode(wav, name, kind) {
  const q = kind === 'music' ? '5' : '4';
  const a = spawnSync('ffmpeg', ['-y', '-v', 'error', '-i', wav, '-c:a', 'libvorbis', '-q:a', q, join(out, `${name}.ogg`)]);
  if (a.status !== 0) throw new Error(a.stderr.toString());
  const b = spawnSync('ffmpeg', ['-y', '-v', 'error', '-i', wav, '-c:a', 'aac', '-b:a', kind === 'music' ? '128k' : '96k', join(out, `${name}.m4a`)]);
  if (b.status !== 0) throw new Error(b.stderr.toString());
}

const byId = Object.fromEntries(sources.map((s) => [s.id, s]));
const report = [];
const loops = {};

for (const o of outputs) {
  const src = byId[o.src];
  const file = await fetchSource(src);
  const ch = o.channels || 1;
  let data = decode(file, ch);
  data = trim(data, ch, o.trim?.[0] || 0, o.trim?.[1] || 0);
  let before = null;
  let after = null;
  if (o.kind === 'loop' || o.kind === 'music') {
    before = seamScore(data, ch);
    data = makeLoop(data, ch, o.xfade ?? 0.08, o.curve || 'linear');
    after = seamScore(data, ch);
    const r = rms(data);
    scale(data, (o.level ?? 0.12) / (r || 1));
  } else {
    fadeEdges(data, ch, 0.002, o.fadeOut ?? 0.03);
    const p = peak(data);
    scale(data, (o.level ?? 0.9) / (p || 1));
  }
  const p = peak(data);
  if (p > 0.99) scale(data, 0.99 / p);
  let encoded = data;
  if (o.kind === 'loop' || o.kind === 'music') {
    // Lossy encoders trim or smear the first and last few hundred samples,
    // which is exactly where a loop wraps. Pad both ends with the wrapped
    // signal and let the game loop the untouched middle (loopStart/loopEnd).
    const n = frames(data, ch);
    const pad = Math.round(LOOP_PAD * RATE);
    encoded = new Float32Array((n + 2 * pad) * ch);
    encoded.set(data.subarray((n - pad) * ch), 0);
    encoded.set(data, pad * ch);
    encoded.set(data.subarray(0, pad * ch), (pad + n) * ch);
    loops[o.name] = { start: pad / RATE, end: (pad + n) / RATE };
  }
  const wav = join(cache, `${o.name}.wav`);
  writeWav(wav, encoded, ch);
  encode(wav, o.name, o.kind);
  rmSync(wav);
  report.push({
    name: o.name,
    kind: o.kind,
    seconds: +(frames(data, ch) / RATE).toFixed(3),
    seamBefore: before === null ? '' : before.toFixed(1),
    seamAfter: after === null ? '' : after.toFixed(1),
  });
}

console.table(report);
writeFileSync(join(here, 'report.json'), JSON.stringify(report, null, 2));
writeFileSync(join(out, 'loops.json'), JSON.stringify(loops, null, 2));
