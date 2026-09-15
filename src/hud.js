// DOM HUD. Every write is cached so the DOM is only touched when a value
// actually changes, and transforms only update past a small threshold.
import { cardinal, formatDelta, formatTime, ordinal } from './util.js';

const $ = (id) => document.getElementById(id);
const SVG = 'http://www.w3.org/2000/svg';

export class Hud {
  constructor() {
    this.root = $('hud');
    this.el = {
      mode: $('hud-mode'), pips: [...$('hud-pips').children], standings: $('hud-standings'),
      bearing: $('hud-bearing'), count: $('hud-count'), target: $('hud-target'), dist: $('hud-dist'),
      rose: $('compass-rose'), targetArrow: $('compass-target'),
      clockLabel: $('hud-clock-label'), time: $('hud-time'), place: $('hud-place'),
      hMin: $('clock-hand-min'), hSec: $('clock-hand-sec'),
      speed: $('hud-speed'), needle: $('speed-needle'), boost: $('hud-boost'),
      sea: $('hud-sea'), sky: $('hud-sky'), state: $('hud-state'), dot: $('hud-dot'),
      cam: $('hud-cam'), camAction: $('hud-cam-action'), cruiseAction: $('hud-cruise-action'),
      keys: $('hud-keys'), countdown: $('countdown'), callout: $('callout'), split: $('split'),
      speedlines: $('speedlines'), fps: $('fps'),
    };
    this.rot = new Map();
    this.buildSpeedTicks();
    this.calloutTimer = 0;
    this.splitTimer = 0;
    this.standingsKey = '';
    this.keysFadeAt = 0;
  }

  buildSpeedTicks() {
    const g = $('speed-ticks');
    for (let i = 0; i <= 24; i++) {
      const a = -135 + (i / 24) * 270;
      const line = document.createElementNS(SVG, 'line');
      const major = i % 4 === 0;
      line.setAttribute('y1', '-27');
      line.setAttribute('y2', major ? '-21.5' : '-24');
      line.setAttribute('transform', `rotate(${a})`);
      if (major) line.setAttribute('style', 'stroke-width:1.4');
      g.appendChild(line);
    }
  }

  text(el, value) {
    if (el._v !== value) {
      el._v = value;
      el.textContent = value;
    }
  }

  rotate(el, deg, eps = 0.25) {
    const last = this.rot.get(el);
    if (last !== undefined && Math.abs(last - deg) < eps) return;
    this.rot.set(el, deg);
    el.setAttribute('transform', `rotate(${deg.toFixed(2)})`);
  }

  show(on) {
    this.root.hidden = !on;
    if (on) {
      this.el.keys.classList.remove('faded');
      this.keysFadeAt = performance.now() + 14000;
    }
  }

  setMode(label) {
    this.text(this.el.mode, label);
  }

  setCameraLabels(label, action) {
    this.text(this.el.cam, label);
    this.text(this.el.camAction, action);
  }

  setCruise(on) {
    this.text(this.el.cruiseAction, on ? 'Release cruise' : 'Engage cruise');
    this.el.cruiseAction.parentElement.classList.toggle('on', on);
  }

  setPips(lit, next, total = 5) {
    this.el.pips.forEach((p, i) => {
      p.classList.toggle('lit', i < lit);
      p.classList.toggle('next', i === next && i < total);
    });
  }

  countdown(value) {
    const el = this.el.countdown;
    el.textContent = value;
    el.classList.remove('pop');
    void el.offsetWidth;
    if (value) el.classList.add('pop');
  }

  callout(message, seconds = 1.8) {
    const el = this.el.callout;
    this.text(el, message);
    el.classList.add('show');
    this.calloutTimer = seconds;
  }

  split(delta, label) {
    const el = this.el.split;
    el.textContent = `${label} ${formatDelta(delta)}`;
    el.classList.toggle('good', delta <= 0);
    el.classList.toggle('bad', delta > 0);
    el.classList.add('show');
    this.splitTimer = 2.6;
  }

  setStandings(rows) {
    const key = rows.map((r) => `${r.name}:${r.gap}`).join('|');
    if (key === this.standingsKey) return;
    this.standingsKey = key;
    const ol = this.el.standings;
    ol.replaceChildren(
      ...rows.map((r, i) => {
        const li = document.createElement('li');
        if (r.me) li.className = 'me';
        const pos = document.createElement('span');
        pos.textContent = String(i + 1);
        const sw = document.createElement('span');
        sw.className = 'swatch';
        sw.style.background = r.color;
        const name = document.createElement('span');
        name.textContent = r.name;
        const gap = document.createElement('span');
        gap.className = 'gap';
        gap.textContent = r.gap;
        li.append(pos, sw, name, gap);
        return li;
      }),
    );
  }

  update(dt, d) {
    const e = this.el;
    this.text(e.speed, String(Math.round(d.knots)));
    this.rotate(e.needle, -135 + Math.min(1, d.knots / 80) * 270, 0.4);
    e.boost.style.transform = `scaleX(${d.boost.toFixed(3)})`;
    e.boost.classList.toggle('active', d.boosting);

    this.text(e.bearing, `${cardinal(d.bearing)} ${String(Math.round(d.bearing) % 360).padStart(3, '0')}°`);
    this.rotate(e.rose, -d.bearing, 0.5);
    this.rotate(e.targetArrow, d.targetRel, 0.5);
    this.text(e.count, d.count);
    this.text(e.target, d.target);
    this.text(e.dist, d.dist);

    this.text(e.clockLabel, d.clockLabel);
    this.text(e.time, d.clock);
    this.text(e.place, d.place);
    this.rotate(e.hSec, ((d.clockSeconds % 60) / 60) * 360, 1);
    this.rotate(e.hMin, ((d.clockSeconds / 60) % 60) / 60 * 360, 1);

    this.text(e.sea, d.sea);
    this.text(e.sky, d.sky);
    this.text(e.state, d.state);
    e.dot.classList.toggle('air', d.state === 'Airborne');
    e.dot.classList.toggle('drift', d.state === 'Power drift');

    e.speedlines.style.opacity = d.speedFx.toFixed(2);

    if (this.calloutTimer > 0) {
      this.calloutTimer -= dt;
      if (this.calloutTimer <= 0) e.callout.classList.remove('show');
    }
    if (this.splitTimer > 0) {
      this.splitTimer -= dt;
      if (this.splitTimer <= 0) e.split.classList.remove('show');
    }
    if (this.keysFadeAt && performance.now() > this.keysFadeAt) {
      e.keys.classList.add('faded');
      this.keysFadeAt = 0;
    }
  }

  fps(value) {
    this.text(this.el.fps, value);
  }
}

export { formatTime, ordinal };
