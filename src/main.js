import '@fontsource/cormorant-garamond/300.css';
import '@fontsource/cormorant-garamond/400.css';
import '@fontsource/cormorant-garamond/500.css';
import '@fontsource/ibm-plex-mono/400.css';
import '@fontsource/ibm-plex-mono/500.css';
import '@fontsource-variable/figtree';
import './style.css';

import {
  Clock, DirectionalLight, FogExp2, HemisphereLight, PerspectiveCamera, SRGBColorSpace, Scene, WebGLRenderer,
} from 'three';
import { sea, waveUniforms } from './waves.js';
import { Palette, paletteUniforms } from './palette.js';
import { Ocean } from './ocean.js';
import { Sky } from './sky.js';
import { World } from './world.js';
import { Boat } from './boat.js';
import { Wake, Spray } from './wake.js';
import { Race } from './race.js';
import { CameraRig } from './camera.js';
import { Input } from './input.js';
import { Hud } from './hud.js';
import { Chart } from './chart.js';
import { AudioEngine } from './audio.js';
import { clamp, formatDelta, formatTime, headingToBearing, ordinal } from './util.js';

const $ = (id) => document.getElementById(id);

// ------------------------------------------------------------ settings
const SETTINGS_KEY = 'tidebreaker.settings.v1';
const settings = { sky: 'sunrise', volume: 0.8, music: 0.5, quality: 'auto', shake: true, fps: false, muted: false };
try {
  Object.assign(settings, JSON.parse(localStorage.getItem(SETTINGS_KEY) || '{}'));
} catch {
  /* defaults */
}
const saveSettings = () => {
  try {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
  } catch {
    /* ignore */
  }
};

// ------------------------------------------------------------ renderer
const canvas = $('scene');
let renderer;
try {
  renderer = new WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance', stencil: false });
} catch (err) {
  $('loader-label').textContent = 'WebGL 2 is not available in this browser';
  throw err;
}
renderer.outputColorSpace = SRGBColorSpace;
const MAX_DPR = Math.min(window.devicePixelRatio || 1, 1.75);
let dpr = settings.quality === 'low' ? Math.min(1, MAX_DPR) : Math.min(1.5, MAX_DPR);
renderer.setPixelRatio(dpr);
renderer.setSize(innerWidth, innerHeight, false);

const scene = new Scene();
scene.fog = new FogExp2(0xf0b7ab, 0.001);
const camera = new PerspectiveCamera(60, innerWidth / innerHeight, 0.3, 6000);

const sunLight = new DirectionalLight(0xffd7b0, 2.6);
const hemiLight = new HemisphereLight(0xf6b6cb, 0x3a3c96, 1.25);
scene.add(sunLight, sunLight.target, hemiLight);

const sky = new Sky();
scene.add(sky.group);
const ocean = new Ocean(settings.quality === 'low' ? 'low' : 'high');
scene.add(ocean.mesh);
const world = new World(scene);

const player = new Boat({ name: 'You', livery: 'sunset', isPlayer: true });
scene.add(player.mesh);
const race = new Race({ world, player, scene });

const spray = new Spray(1400);
scene.add(spray.points);
const wakes = new Map();
for (const e of race.entrants) {
  const w = new Wake({ intensity: e.boat === player ? 1 : 0.6 });
  wakes.set(e.boat, w);
  scene.add(w.mesh);
}

const palette = new Palette();
palette.bind({ scene, sunLight, hemiLight, cloudMaterial: sky.cloudMaterial });
palette.set(settings.sky, true);

const rig = new CameraRig(camera);
rig.shakeEnabled = settings.shake;
const input = new Input();
input.bindTouch($('touch'));
const hud = new Hud();
const chart = new Chart($('chart-canvas'), world);
const audio = new AudioEngine();
audio.volume = settings.volume;
audio.musicVolume = settings.music;
audio.muted = settings.muted;

const isTouch = matchMedia('(pointer: coarse)').matches;

// ------------------------------------------------------------ game state
let mode = 'menu'; // menu | race | results
let paused = false;
let simTime = 0;
let acc = 0;
const STEP = 1 / 120;

function stageHarbour() {
  race.stop();
  race.entrants.forEach((e) => {
    const isPlayer = e === race.player;
    const slot = world.gridSlot(0);
    e.boat.place(slot.x, slot.z, slot.heading);
    e.boat.frozen = true;
    // The harbour shot is just your boat on open water.
    e.active = isPlayer;
    e.boat.mesh.visible = isPlayer;
    e.controls.throttle = 0;
    e.controls.steer = 0;
  });
  world.resetBeacons(0);
  wakes.forEach((w) => w.reset());
}

function showScreen(id) {
  for (const s of ['menu', 'pause', 'results']) $(s).hidden = s !== id;
}

function refreshMenu() {
  const best = race.best;
  $('menu-best').textContent = best ? formatTime(best.time) : 'None yet';
  $('menu-sky').textContent = palette.preset.label;
  $('menu-sound').textContent = audio.muted ? 'Off' : 'On';
}

function goToMenu() {
  mode = 'menu';
  paused = false;
  input.setCruise(false);
  hud.setCruise(false);
  hud.show(false);
  $('touch').hidden = true;
  $('chart').hidden = true;
  chart.open = false;
  stageHarbour();
  refreshMenu();
  showScreen('menu');
  audio.duck(false);
  audio.setMusicLevel(1, 1.2);
}

const MODE_LABELS = { regatta: 'The golden regatta', trial: 'Time trial · ghost run', cruise: 'Free cruise' };

function startRace(kind) {
  mode = 'race';
  paused = false;
  showScreen(null);
  input.setCruise(false);
  hud.setCruise(false);
  hud.show(true);
  hud.setMode(MODE_LABELS[kind]);
  hud.setPips(0, 0);
  hud.setStandings([]);
  hud.setCameraLabels(rig.label, rig.nextActionLabel);
  $('touch').hidden = !isTouch;
  race.start(kind);
  wakes.forEach((w) => w.reset());
  rig.snap(player);
  audio.duck(false);
  audio.setMusicLevel(kind === 'cruise' ? 0.55 : 0.0, 1.5);
  audio.ui('ui_open', 0.8);
}

function setPaused(on) {
  if (mode !== 'race') return;
  paused = on;
  $('pause').hidden = !on;
  audio.duck(on);
  audio.ui(on ? 'ui_open' : 'ui_close', 0.7);
}

// ------------------------------------------------------------ race events
race.on('count', (n) => {
  hud.countdown(String(n));
  audio.play('ui_select', { bus: 'ui', gain: 1, rate: 0.8 });
  audio.play('ui_bong', { bus: 'ui', gain: 0.6, rate: 0.75 });
});

race.on('go', () => {
  if (race.mode === 'cruise') {
    hud.callout('Free cruise · the sea is yours', 2.4);
    return;
  }
  hud.countdown('Go');
  audio.play('ui_go', { bus: 'ui', gain: 1 });
  audio.play('boost_whoosh', { gain: 0.6, rate: 0.9 });
});

race.on('checkpoint', (e, index, cp, delta) => {
  audio.play('beacon_bell', { gain: 0.9, rate: 0.84 + index * 0.07 });
  const lit = Math.min(race.player.next, 5);
  hud.setPips(lit, race.player.next);
  if (cp.gate) return;
  hud.callout(`${cp.name} lit · boost +25%`, 1.8);
  if (delta !== null) hud.split(delta, cp.name);
});

race.on('lap', () => {
  audio.play('finish_gong', { gain: 0.7 });
  hud.callout('Circuit complete · beacons reset', 2.4);
  hud.setPips(0, 0);
});

race.on('finish', (r) => {
  audio.play('finish_gong', { gain: 0.95 });
  audio.play('ui_confirm', { bus: 'ui', gain: 0.9, delay: 0.35 });
  hud.callout(r.isRecord ? 'New tide record' : 'Finished', 2);
  rig.addTrauma(0.2);
  setTimeout(() => showResults(r), 1700);
});

function showResults(r) {
  if (mode !== 'race') return;
  mode = 'results';
  input.setCruise(false);
  hud.show(false);
  $('touch').hidden = true;
  $('res-kicker').textContent = r.mode === 'trial' ? 'Time trial complete' : 'Regatta complete';
  $('res-title').textContent = r.mode === 'trial' ? (r.isRecord ? 'Record run' : 'Run complete') : `${ordinal(r.place)} place`;
  $('res-time').textContent = formatTime(r.time);
  const deltaEl = $('res-delta');
  if (r.prev) {
    const d = r.time - r.prev.time;
    deltaEl.textContent = r.isRecord ? `New tide record · ${formatDelta(d)}` : `${formatDelta(d)} off the record`;
    deltaEl.className = `res-delta mono ${d <= 0 ? 'good' : 'bad'}`;
  } else {
    deltaEl.textContent = 'First tide record set';
    deltaEl.className = 'res-delta mono good';
  }
  const tbody = $('res-splits').tBodies[0];
  tbody.replaceChildren(
    ...world.checkpoints.map((cp, i) => {
      const tr = document.createElement('tr');
      const name = document.createElement('td');
      name.textContent = cp.name;
      const t = document.createElement('td');
      t.textContent = formatTime(r.splits[i]);
      const d = document.createElement('td');
      const prev = r.prev?.splits?.[i];
      if (Number.isFinite(prev)) {
        const dd = r.splits[i] - prev;
        d.textContent = formatDelta(dd);
        d.className = dd <= 0 ? 'good' : 'bad';
      } else d.textContent = '·';
      tr.append(name, t, d);
      return tr;
    }),
  );
  showScreen('results');
  audio.setMusicLevel(0.8, 2);
  audio.ui('ui_open', 0.7);
}

// ------------------------------------------------------------ boat feedback
player.onLand = (impact, air) => {
  audio.landing(impact, air);
  if (impact > 3) spray.burst(player.pos.x, player.pos.y, player.pos.z, clamp(impact / 12, 0.2, 1));
  rig.addTrauma(clamp((impact - 3) / 18, 0, 0.45));
  if (air > 0.9 && mode === 'race') hud.callout(`Big air · ${air.toFixed(1)} s · boost refilled`, 1.6);
};
player.onHit = (strength, kind) => {
  audio.hit(strength, kind);
  rig.addTrauma(clamp(strength / 24, 0.1, 0.6));
};
for (const e of race.rivals) {
  e.boat.onLand = (impact) => {
    if (impact > 4 && e.boat.pos.distanceTo(camera.position) < 160) spray.burst(e.boat.pos.x, e.boat.pos.y, e.boat.pos.z, clamp(impact / 14, 0.2, 0.8));
  };
}

// ------------------------------------------------------------ input actions
input.on('camera', () => {
  if (mode !== 'race') return;
  rig.cycle();
  hud.setCameraLabels(rig.label, rig.nextActionLabel);
  audio.ui('ui_click', 0.8);
});
input.on('cruise', () => {
  if (mode !== 'race' || paused) return;
  input.setCruise(!input.cruise);
});
input.on('cruise-changed', (on) => {
  hud.setCruise(on);
  if (mode === 'race') {
    hud.callout(on ? 'Cruise engaged' : 'Cruise released', 1.2);
    audio.ui(on ? 'ui_confirm' : 'ui_close', 0.5);
  }
});
input.on('chart', () => {
  if (mode === 'results') return;
  chart.open = !chart.open;
  $('chart').hidden = !chart.open;
  audio.ui(chart.open ? 'ui_open' : 'ui_close', 0.7);
});
input.on('pause', () => {
  if (chart.open) {
    chart.open = false;
    $('chart').hidden = true;
    return;
  }
  if (mode === 'race') setPaused(!paused);
});
input.on('confirm', () => {
  if (mode === 'menu' && !$('menu').hidden) startRace('regatta');
  else if (mode === 'results') startRace(race.mode);
  else if (paused) setPaused(false);
});
input.on('restart', () => {
  if (mode === 'race') startRace(race.mode);
});
input.on('sky', () => {
  const p = palette.cycle();
  settings.sky = palette.key;
  saveSettings();
  refreshMenu();
  if (mode === 'race') hud.callout(p.label, 1.4);
  audio.play('soft_whoosh', { bus: 'ui', gain: 0.5 });
});
input.on('hud', () => {
  if (mode === 'race') $('hud').hidden = !$('hud').hidden;
});
input.on('fps', () => {
  settings.fps = !settings.fps;
  $('set-fps').checked = settings.fps;
  $('fps').hidden = !settings.fps;
  saveSettings();
});

// ------------------------------------------------------------ DOM wiring
for (const btn of document.querySelectorAll('[data-mode]')) {
  btn.addEventListener('click', () => startRace(btn.dataset.mode));
}
for (const btn of document.querySelectorAll('[data-action]')) {
  btn.addEventListener('click', () => input.emit(btn.dataset.action));
}
for (const btn of document.querySelectorAll('[data-pause]')) {
  btn.addEventListener('click', () => {
    const a = btn.dataset.pause;
    if (a === 'resume') setPaused(false);
    else if (a === 'restart') startRace(race.mode);
    else goToMenu();
  });
}
for (const btn of document.querySelectorAll('[data-results]')) {
  btn.addEventListener('click', () => (btn.dataset.results === 'again' ? startRace(race.mode) : goToMenu()));
}
for (const el of document.querySelectorAll('.btn, .hud-actions button, .link')) {
  el.addEventListener('pointerenter', () => audio.hover());
  el.addEventListener('click', () => audio.ui('ui_click', 0.9));
}
$('menu-sky').addEventListener('click', () => input.emit('sky'));
$('menu-sound').addEventListener('click', () => {
  settings.muted = audio.toggleMute();
  saveSettings();
  refreshMenu();
});

const volume = $('set-volume');
const music = $('set-music');
const quality = $('set-quality');
const shake = $('set-shake');
const fpsBox = $('set-fps');
volume.value = settings.volume;
music.value = settings.music;
quality.value = settings.quality;
shake.checked = settings.shake;
fpsBox.checked = settings.fps;
$('fps').hidden = !settings.fps;
volume.addEventListener('input', () => { settings.volume = +volume.value; audio.setVolume(settings.volume); saveSettings(); });
music.addEventListener('input', () => { settings.music = +music.value; audio.setMusicVolume(settings.music); saveSettings(); });
quality.addEventListener('change', () => { settings.quality = quality.value; applyQuality(true); saveSettings(); });
shake.addEventListener('change', () => { settings.shake = shake.checked; rig.shakeEnabled = shake.checked; saveSettings(); });
fpsBox.addEventListener('change', () => { settings.fps = fpsBox.checked; $('fps').hidden = !settings.fps; saveSettings(); });

const unlockAudio = () => {
  audio.unlock();
  audio.decodeAll().then(() => {
    audio.startMusic();
    audio.setMusicLevel(mode === 'menu' || mode === 'results' ? 1 : race.mode === 'cruise' ? 0.55 : 0, 1.5);
  });
};
addEventListener('pointerdown', unlockAudio, { capture: true });
addEventListener('keydown', unlockAudio, { capture: true });

// ------------------------------------------------------------ quality
let frameAcc = 0;
let frameCount = 0;
let slowStreak = 0;

function applyQuality(reset = false) {
  const q = settings.quality;
  document.body.classList.toggle('q-low', q === 'low');
  if (q === 'low') {
    ocean.setQuality('low');
    dpr = Math.min(1, MAX_DPR);
  } else if (q === 'high') {
    ocean.setQuality('high');
    dpr = MAX_DPR;
  } else if (reset) {
    ocean.setQuality('high');
    dpr = Math.min(1.5, MAX_DPR);
  }
  renderer.setPixelRatio(dpr);
  onResize();
}

function adaptQuality(rawDt) {
  frameAcc += rawDt;
  frameCount++;
  if (frameAcc < 1) return;
  const ms = (frameAcc / frameCount) * 1000;
  if (settings.fps) hud.fps(`${Math.round(1000 / ms)} fps · ${dpr.toFixed(2)}x`);
  frameAcc = 0;
  frameCount = 0;
  if (settings.quality !== 'auto' || document.hidden) return;
  if (ms > 21) {
    slowStreak++;
    if (dpr > 0.7) {
      dpr = Math.max(0.7, dpr - 0.15);
      renderer.setPixelRatio(dpr);
      onResize();
    } else if (slowStreak > 3 && ocean.quality !== 'low') {
      ocean.setQuality('low');
      document.body.classList.add('q-low');
    }
  } else if (ms < 13.5) {
    slowStreak = 0;
    if (dpr < Math.min(1.5, MAX_DPR)) {
      dpr = Math.min(Math.min(1.5, MAX_DPR), dpr + 0.1);
      renderer.setPixelRatio(dpr);
      onResize();
    }
  }
}

function onResize() {
  renderer.setSize(innerWidth, innerHeight, false);
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
  spray.setViewportHeight(innerHeight * renderer.getPixelRatio());
}
addEventListener('resize', onResize);
onResize();

// ------------------------------------------------------------ simulation
const PLAYER_IDLE = { throttle: 0, steer: 0, boost: false, drift: false };
let wasBoosting = false;
let boundaryCooldown = 0;

// Debug hooks for automated play-tests: time scale and an autopilot for the player.
const debug = { timeScale: 1, autopilot: false };
window.tidebreakerDebug = debug;

function simulate(dt, controls) {
  acc += dt;
  let steps = 0;
  const boats = race.entrants;
  const maxSteps = 10 * Math.max(1, debug.timeScale);
  while (acc >= STEP && steps < maxSteps) {
    simTime += STEP;
    sea.time = simTime;
    race.preStep(STEP);
    if (debug.autopilot && race.racing && !race.player.finished) race.driveAI(race.player, STEP);
    for (const e of boats) {
      if (!e.active) continue;
      let c = e.controls;
      if (e === race.player) c = mode !== 'race' ? PLAYER_IDLE : debug.autopilot ? e.controls : controls;
      e.boat.step(STEP, c, world.colliders, simTime);
    }
    for (let i = 0; i < boats.length; i++) {
      if (!boats[i].active) continue;
      for (let j = i + 1; j < boats.length; j++) {
        if (!boats[j].active) continue;
        const hit = Boat.bump(boats[i].boat, boats[j].boat);
        if (hit > 3 && (i === 0 || j === 0)) {
          audio.hit(hit * 1.4, 'boat');
          rig.addTrauma(clamp(hit / 20, 0.1, 0.4));
        }
      }
    }
    const b = world.bounds;
    for (const e of boats) {
      if (!e.active) continue;
      const dx = e.boat.pos.x - b.x;
      const dz = e.boat.pos.z - b.z;
      const d = Math.hypot(dx, dz);
      if (d > b.r) {
        const nx = dx / d, nz = dz / d;
        const vn = e.boat.vx * nx + e.boat.vz * nz;
        if (vn > 0) {
          e.boat.vx -= vn * nx * 1.6;
          e.boat.vz -= vn * nz * 1.6;
        }
        e.boat.pos.x = b.x + nx * b.r;
        e.boat.pos.z = b.z + nz * b.r;
        if (e === race.player && boundaryCooldown <= 0 && mode === 'race') {
          hud.callout('Open sea ends here · turn back', 1.6);
          boundaryCooldown = 3;
        }
      }
    }
    acc -= STEP;
    steps++;
  }
  if (steps >= 10) acc = 0;
  return acc / STEP;
}

// ------------------------------------------------------------ frame
const clock = new Clock();
let hudAcc = 0;
let standingsAcc = 0;
let chartAcc = 0;

function frame() {
  requestAnimationFrame(frame);
  const rawDt = clock.getDelta();
  const dt = Math.min(rawDt, 1 / 20) * debug.timeScale;
  adaptQuality(rawDt);
  boundaryCooldown -= dt;

  let alpha = 1;
  const controls = input.poll(dt);
  if (!paused) {
    alpha = simulate(dt, controls);
    race.update(dt);
    palette.update(dt);
  }
  const renderTime = simTime - (1 - alpha) * STEP;
  waveUniforms.uTime.value = renderTime;

  for (const e of race.entrants) {
    if (!e.active) continue;
    e.boat.render(alpha);
    if (!paused) {
      wakes.get(e.boat).update(e.boat, renderTime);
      const near = e.boat.isPlayer || e.boat.pos.distanceToSquared(camera.position) < 220 * 220;
      if (near) spray.emitForBoat(e.boat, dt, e.boat.isPlayer ? 1 : 0.6);
    }
  }
  if (!paused) spray.update(dt);

  if (player.boosting && !wasBoosting && mode === 'race') audio.play('boost_whoosh', { gain: 0.7, rate: 0.95 + Math.random() * 0.1 });
  wasBoosting = player.boosting;

  world.update(dt, renderTime);
  rig.update(dt, player, mode !== 'race');
  sky.update(camera, dt);
  ocean.update(camera);

  const sd = paletteUniforms.uSunDir.value;
  sunLight.position.set(player.pos.x + sd.x * 200, player.pos.y + sd.y * 200, player.pos.z + sd.z * 200);
  sunLight.target.position.copy(player.pos);

  audio.update(dt, player, {
    active: mode === 'race' && !paused,
    nearestRival: race.mode === 'regatta' && mode === 'race' ? race.nearestRival() : null,
    listener: player,
  });

  if (mode === 'race') updateHud(dt);

  if (chart.open) {
    chartAcc -= dt;
    if (chartAcc <= 0) {
      chartAcc = 0.1;
      chart.draw(race.entrants, race.player.next, race.ghostMesh.visible ? { x: race.ghostMesh.position.x, z: race.ghostMesh.position.z, heading: race.ghostMesh.rotation.y } : null);
    }
  }

  renderer.render(scene, camera);
}

function updateHud(dt) {
  hudAcc += dt;
  standingsAcc -= dt;
  const knots = player.speed * 1.94384;
  const bearing = headingToBearing(player.heading);
  const next = Math.min(race.player.next, world.checkpoints.length - 1);
  const cp = world.checkpoints[next];
  const dx = cp.x - player.pos.x;
  const dz = cp.z - player.pos.z;
  const targetBearing = headingToBearing(Math.atan2(dx, dz));
  const rel = ((targetBearing - bearing + 540) % 360) - 180;
  const lit = Math.min(race.player.next, 5);

  let clockLabel = 'Race time';
  let clockText = formatTime(race.time);
  let clockSeconds = race.time;
  let place = palette.preset.label;
  if (race.mode === 'cruise') {
    const minutes = 6 * 60 + 35 + simTime / 10;
    clockLabel = "Ship's time";
    clockText = `${String(Math.floor(minutes / 60) % 24).padStart(2, '0')}:${String(Math.floor(minutes % 60)).padStart(2, '0')}`;
    clockSeconds = minutes * 60;
  } else if (race.mode === 'regatta') {
    const p = race.playerPlace();
    place = `${ordinal(p.place)} of ${p.field}`;
  } else {
    place = race.best ? `Record ${formatTime(race.best.time)}` : 'No record yet';
  }
  if (race.state === 'countdown') clockText = formatTime(0);

  let state = 'Steady';
  if (player.airborne) state = 'Airborne';
  else if (player.drifting) state = 'Power drift';
  else if (player.boosting) state = 'Boosting';
  else if (input.cruise) state = 'Cruise';

  hud.update(dt, {
    knots,
    boost: player.boost,
    boosting: player.boosting,
    bearing,
    targetRel: rel,
    count: `${lit}/5`,
    target: race.player.finished ? 'Finished · well sailed' : cp.gate ? 'Cross the Tidebreak Gate' : `Light the ${cp.name} beacon`,
    dist: `${Math.round(Math.hypot(dx, dz))} m`,
    clockLabel,
    clock: clockText,
    clockSeconds,
    place,
    sea: knots < 18 ? 'Idling in the swell' : knots < 46 ? 'Riding tide' : 'Skipping the crests',
    sky: palette.preset.sky,
    state,
    speedFx: clamp((knots - 52) / 22, 0, 1) * 0.8 + (player.boosting ? 0.25 : 0),
  });

  if (standingsAcc <= 0) {
    standingsAcc = 0.25;
    hud.setStandings(race.mode === 'regatta' ? race.standings() : []);
  }
}

// ------------------------------------------------------------ boot
async function boot() {
  const fill = $('loader-fill');
  const label = $('loader-label');
  stageHarbour();
  rig.snap(player);
  let audioProgress = 0;
  const audioPromise = audio.fetchAll((p) => {
    audioProgress = p;
    fill.style.width = `${Math.round(20 + p * 70)}%`;
  });
  label.textContent = 'Tuning the swell';
  fill.style.width = '12%';
  await new Promise((r) => requestAnimationFrame(r));
  renderer.compile(scene, camera);
  label.textContent = 'Loading the soundscape';
  await audioPromise;
  fill.style.width = '100%';
  label.textContent = audioProgress >= 1 ? 'Ready' : 'Ready (audio unavailable)';
  applyQuality();
  requestAnimationFrame(frame);
  setTimeout(() => {
    $('loader').classList.add('done');
    goToMenu();
  }, 250);
}

boot();

// Handy for debugging and automated screenshots.
window.tidebreaker = { race, player, rig, palette, startRace, goToMenu, input, audio, settings };
