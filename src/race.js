// Race director: countdown, checkpoints, AI skippers, standings, splits and
// the ghost of your best run (kept in localStorage).
import { Boat, LIVERIES, createBoatMesh } from './boat.js';
import { clamp, wrapAngle } from './util.js';

export const RIVALS = [
  { name: 'Marlin', livery: 'lagoon', skill: 0.985, boostHabit: 0.8 },
  { name: 'Coral', livery: 'saffron', skill: 0.955, boostHabit: 0.55 },
  { name: 'Kestrel', livery: 'orchid', skill: 0.925, boostHabit: 0.35 },
];

const BEST_KEY = 'tidebreaker.best.v1';
const GHOST_HZ = 20;

function loadBest() {
  try {
    const raw = localStorage.getItem(BEST_KEY);
    if (!raw) return null;
    const data = JSON.parse(raw);
    const bin = atob(data.ghost);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    data.samples = new Float32Array(bytes.buffer);
    return data;
  } catch {
    return null;
  }
}

function saveBest(time, splits, samples) {
  try {
    const bytes = new Uint8Array(samples.buffer, samples.byteOffset, samples.byteLength);
    let bin = '';
    for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
    localStorage.setItem(BEST_KEY, JSON.stringify({ v: 1, time, splits, ghost: btoa(bin), date: Date.now() }));
  } catch {
    // Storage full or blocked: the record simply isn't kept.
  }
}

class Entrant {
  constructor(boat, profile = null) {
    this.boat = boat;
    this.profile = profile;
    this.reset();
  }

  reset() {
    this.next = 0;
    this.wp = 0;
    this.finished = false;
    this.finishTime = 0;
    this.splits = [];
    this.stuck = 0;
    this.reverseTimer = 0;
    this.boostTimer = 0;
    this.controls = { throttle: 0, steer: 0, boost: false, drift: false };
  }
}

export class Race {
  constructor({ world, player, scene }) {
    this.world = world;
    this.scene = scene;
    this.player = new Entrant(player);
    this.rivals = RIVALS.map((p) => {
      const boat = new Boat({ name: p.name, livery: p.livery, specs: {} });
      scene.add(boat.mesh);
      return new Entrant(boat, p);
    });
    this.entrants = [this.player, ...this.rivals];
    this.ghostMesh = createBoatMesh('sunset', { ghost: true });
    this.ghostMesh.visible = false;
    scene.add(this.ghostMesh);

    this.mode = 'regatta';
    this.state = 'idle';
    this.time = 0;
    this.countdown = 0;
    this.best = loadBest();
    this.recording = [];
    this.recordAcc = 0;
    this.events = {};
  }

  on(name, fn) {
    this.events[name] = fn;
  }

  emit(name, ...args) {
    if (this.events[name]) this.events[name](...args);
  }

  get total() {
    return this.world.checkpoints.length;
  }

  get racing() {
    return this.state === 'racing';
  }

  start(mode) {
    this.mode = mode;
    this.time = 0;
    this.recording = [];
    this.recordAcc = 0;
    this.best = loadBest();
    const withRivals = mode === 'regatta';
    this.entrants.forEach((e, i) => {
      e.reset();
      const active = e === this.player || withRivals;
      e.boat.mesh.visible = active;
      e.active = active;
      const slot = this.world.gridSlot(e === this.player ? (withRivals ? 3 : 0) : i - 1);
      e.boat.place(slot.x, slot.z, slot.heading);
      e.boat.frozen = mode !== 'cruise';
    });
    this.world.resetBeacons(0);
    this.ghostMesh.visible = false;
    if (mode === 'cruise') {
      this.state = 'racing';
      this.emit('go');
    } else {
      this.state = 'countdown';
      this.countdown = 3.999;
      this.lastCount = 4;
    }
  }

  stop() {
    this.state = 'idle';
    this.ghostMesh.visible = false;
  }

  activeBoats() {
    return this.entrants.filter((e) => e.active).map((e) => e.boat);
  }

  /** Called once per fixed physics step before boats integrate. */
  preStep(dt) {
    for (const e of this.rivals) {
      if (!e.active) continue;
      if (this.state === 'racing' && !e.finished) this.driveAI(e, dt);
      else if (e.finished) {
        e.controls.throttle = 0.35;
        e.controls.steer = 0.25;
        e.controls.boost = false;
        e.controls.drift = false;
      }
    }
  }

  update(dt) {
    if (this.state === 'countdown') {
      this.countdown -= dt;
      const n = Math.ceil(this.countdown);
      if (n !== this.lastCount) {
        this.lastCount = n;
        if (n >= 1) this.emit('count', n);
      }
      if (this.countdown <= 0) {
        this.state = 'racing';
        this.entrants.forEach((e) => { e.boat.frozen = false; });
        this.emit('go');
      }
      return;
    }
    if (this.state !== 'racing' && this.state !== 'finished') return;

    this.time += dt;
    const cps = this.world.checkpoints;
    const start = (this.startPoint ||= this.world.gridSlot(0));
    for (const e of this.entrants) {
      if (!e.active || e.finished) continue;
      const cp = cps[e.next];
      const bx = e.boat.pos.x;
      const bz = e.boat.pos.z;
      let passed = Math.hypot(bx - cp.x, bz - cp.z) < cp.radius;
      // A crossing of the beacon line also counts, so a slightly wide pass
      // lights the beacon instead of forcing a loop back.
      const prev = e.next === 0 ? (e.splits.length ? cps[cps.length - 1] : start) : cps[e.next - 1];
      let ux = cp.x - prev.x;
      let uz = cp.z - prev.z;
      const len = Math.hypot(ux, uz) || 1;
      ux /= len;
      uz /= len;
      const along = (bx - cp.x) * ux + (bz - cp.z) * uz;
      const lateral = Math.abs((bx - cp.x) * -uz + (bz - cp.z) * ux);
      if (e.lineFor !== e.next) {
        e.lineFor = e.next;
        e.prevAlong = along;
      }
      if (!passed && e.prevAlong <= 0 && along > 0 && lateral < cp.radius * 1.9) passed = true;
      e.prevAlong = along;
      if (passed) this.pass(e);
    }

    if (this.player.active && !this.player.finished && this.mode !== 'cruise') {
      this.recordAcc += dt;
      while (this.recordAcc >= 1 / GHOST_HZ) {
        this.recordAcc -= 1 / GHOST_HZ;
        const b = this.player.boat;
        this.recording.push(b.pos.x, b.pos.y, b.pos.z, b.heading);
      }
    }
    this.updateGhost();
    this.rubberBand();
  }

  pass(e) {
    const index = e.next;
    const cp = this.world.checkpoints[index];
    e.splits[index] = this.time;
    e.next++;
    e.wp = 0;
    const isPlayer = e === this.player;

    if (this.mode === 'cruise' && isPlayer) {
      this.world.setBeaconState(index, 'lit');
      e.boat.boost = Math.min(1, e.boat.boost + 0.25);
      if (e.next >= this.total) {
        e.next = 0;
        this.world.resetBeacons(0);
        this.emit('lap', cp);
      } else {
        this.world.setBeaconState(e.next, 'next');
        this.emit('checkpoint', e, index, cp, null);
      }
      return;
    }

    if (isPlayer) {
      e.boat.boost = Math.min(1, e.boat.boost + 0.25);
      this.world.setBeaconState(index, 'lit');
      if (e.next < this.total) this.world.setBeaconState(e.next, 'next');
      const bestSplit = this.best?.splits?.[index];
      const delta = Number.isFinite(bestSplit) ? this.time - bestSplit : null;
      this.emit('checkpoint', e, index, cp, delta);
    }

    if (e.next >= this.total) {
      e.finished = true;
      e.finishTime = this.time;
      e.boat.frozen = false;
      if (isPlayer) this.finishPlayer();
    }
  }

  finishPlayer() {
    const time = this.time;
    const place = this.entrants.filter((e) => e.active && e.finished && e.finishTime < time).length + 1;
    const prev = this.best;
    const isRecord = !prev || time < prev.time;
    const splits = this.player.splits.slice();
    if (isRecord) saveBest(time, splits, new Float32Array(this.recording));
    this.state = 'finished';
    this.emit('finish', { time, place, field: this.entrants.filter((e) => e.active).length, isRecord, prev, splits, mode: this.mode });
    this.best = loadBest();
  }

  updateGhost() {
    const best = this.best;
    const show = best && best.samples && this.mode !== 'cruise' && this.state === 'racing';
    if (!show) {
      this.ghostMesh.visible = false;
      return;
    }
    const s = best.samples;
    const count = s.length / 4;
    const f = this.time * GHOST_HZ;
    const i = Math.floor(f);
    if (i >= count - 1) {
      this.ghostMesh.visible = false;
      return;
    }
    const t = f - i;
    const a = i * 4;
    const b = a + 4;
    this.ghostMesh.visible = true;
    this.ghostMesh.position.set(s[a] + (s[b] - s[a]) * t, s[a + 1] + (s[b + 1] - s[a + 1]) * t, s[a + 2] + (s[b + 2] - s[a + 2]) * t);
    this.ghostMesh.rotation.y = s[a + 3] + wrapAngle(s[b + 3] - s[a + 3]) * t;
  }

  /** Keep the pack close without making it obvious. */
  rubberBand() {
    const p = this.player;
    const pp = this.progressOf(p);
    for (const e of this.rivals) {
      if (!e.active) continue;
      const gap = this.progressOf(e) - pp;
      let mul = e.profile.skill;
      if (!p.finished) {
        if (gap > 140) mul *= 0.93;
        else if (gap > 60) mul *= 0.97;
        else if (gap < -160) mul *= 1.07;
        else if (gap < -70) mul *= 1.03;
      }
      e.boat.speedMul = mul;
    }
  }

  /** Metres of course covered, for standings and rubber-banding. */
  progressOf(e) {
    const cps = this.world.checkpoints;
    if (e.finished) return 1e6 - e.finishTime;
    let dist = 0;
    for (let i = 0; i < e.next; i++) {
      const prev = i === 0 ? this.world.gridSlot(0) : cps[i - 1];
      dist += Math.hypot(cps[i].x - prev.x, cps[i].z - prev.z);
    }
    const target = cps[e.next];
    const prev = e.next === 0 ? this.world.gridSlot(0) : cps[e.next - 1];
    const leg = Math.hypot(target.x - prev.x, target.z - prev.z);
    const left = Math.hypot(target.x - e.boat.pos.x, target.z - e.boat.pos.z);
    return dist + Math.max(0, leg - left);
  }

  standings() {
    const rows = this.entrants
      .filter((e) => e.active)
      .map((e) => ({ e, p: this.progressOf(e) }))
      .sort((a, b) => b.p - a.p);
    const leader = rows[0]?.e;
    return rows.map(({ e }) => {
      let gap = '';
      if (e !== leader && leader) {
        const k = e.next - 1;
        if (k >= 0 && Number.isFinite(leader.splits[k]) && Number.isFinite(e.splits[k])) {
          gap = `+${(e.splits[k] - leader.splits[k]).toFixed(1)}`;
        } else gap = '·';
      }
      return { name: e === this.player ? 'You' : e.boat.name, color: LIVERIES[e.boat.livery].hull, gap, me: e === this.player };
    });
  }

  playerPlace() {
    const rows = this.entrants.filter((e) => e.active).map((e) => ({ e, p: this.progressOf(e) })).sort((a, b) => b.p - a.p);
    return { place: rows.findIndex((r) => r.e === this.player) + 1, field: rows.length };
  }

  nearestRival() {
    let best = null;
    let bestD = Infinity;
    for (const e of this.rivals) {
      if (!e.active) continue;
      const d = Math.hypot(e.boat.pos.x - this.player.boat.pos.x, e.boat.pos.z - this.player.boat.pos.z);
      if (d < bestD) { bestD = d; best = e.boat; }
    }
    return best;
  }

  driveAI(e, dt) {
    const b = e.boat;
    const c = e.controls;
    const legs = this.world.legs;
    const leg = legs[e.next];
    if (!leg) return;
    let target = leg[Math.min(e.wp, leg.length - 1)];
    let d = Math.hypot(target.x - b.pos.x, target.z - b.pos.z);
    if (e.wp < leg.length - 1 && d < 34) {
      e.wp++;
      target = leg[e.wp];
      d = Math.hypot(target.x - b.pos.x, target.z - b.pos.z);
    }
    let ax = target.x;
    let az = target.z;
    if (e.wp === leg.length - 1) {
      const cp = this.world.checkpoints[e.next];
      const nextLeg = legs[e.next + 1];
      if (nextLeg && d < 45) {
        const w = (1 - d / 45) * 0.35;
        ax += (nextLeg[0].x - ax) * w;
        az += (nextLeg[0].z - az) * w;
      }
      // Never aim outside the beacon ring.
      const ox = ax - cp.x;
      const oz = az - cp.z;
      const lim = cp.radius * 0.55;
      const ol = Math.hypot(ox, oz);
      if (ol > lim) {
        ax = cp.x + (ox / ol) * lim;
        az = cp.z + (oz / ol) * lim;
      }
    }
    const desired = Math.atan2(ax - b.pos.x, az - b.pos.z);
    let err = wrapAngle(desired - b.heading);

    // Give other boats a little room.
    for (const o of this.entrants) {
      if (o === e || !o.active) continue;
      const dx = o.boat.pos.x - b.pos.x;
      const dz = o.boat.pos.z - b.pos.z;
      const dd = Math.hypot(dx, dz);
      if (dd > 16 || dd < 0.1) continue;
      const ahead = dx * Math.sin(b.heading) + dz * Math.cos(b.heading);
      if (ahead < 0) continue;
      const side = dx * -Math.cos(b.heading) + dz * Math.sin(b.heading);
      err += (side > 0 ? 1 : -1) * 0.35 * (1 - dd / 16);
    }

    const speed = b.speed;
    c.steer = clamp(-err * 2.3 + b.yawRate * 0.28, -1, 1);
    c.throttle = Math.abs(err) > 1.1 && speed > 15 ? 0.5 : 1;
    c.drift = Math.abs(err) > 0.5 && speed > 15;
    e.boostTimer -= dt;
    if (e.boostTimer <= 0) {
      e.boostTimer = 0.5 + Math.random();
      c.boost = Math.abs(err) < 0.2 && b.boost > 0.35 && Math.random() < (e.profile ? e.profile.boostHabit : 0.7);
    }
    if (Math.abs(err) > 0.35) c.boost = false;

    // Unstick after a collision.
    if (speed < 2.5 && !b.frozen) e.stuck += dt;
    else e.stuck = Math.max(0, e.stuck - dt * 2);
    if (e.stuck > 1.6) {
      e.reverseTimer = 1.1;
      e.stuck = 0;
    }
    if (e.reverseTimer > 0) {
      e.reverseTimer -= dt;
      c.throttle = -1;
      c.steer = err > 0 ? 1 : -1;
      c.boost = false;
      c.drift = false;
    }
  }
}
