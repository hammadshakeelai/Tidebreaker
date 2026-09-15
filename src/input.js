// Keyboard, gamepad and touch mapped onto one analog control state. Digital
// keys are eased so the boat responds like it has a real wheel and throttle.
import { clamp } from './util.js';

const HELD = {
  throttle: ['KeyW', 'ArrowUp'],
  brake: ['KeyS', 'ArrowDown'],
  left: ['KeyA', 'ArrowLeft'],
  right: ['KeyD', 'ArrowRight'],
  boost: ['ShiftLeft', 'ShiftRight'],
  drift: ['Space'],
};

const PRESSED = {
  KeyC: 'camera',
  KeyR: 'cruise',
  KeyM: 'chart',
  Escape: 'pause',
  KeyP: 'pause',
  KeyT: 'sky',
  Enter: 'confirm',
  NumpadEnter: 'confirm',
  Backspace: 'restart',
  KeyH: 'hud',
  KeyF: 'fps',
};

const BLOCK_DEFAULT = new Set(['Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Backspace', 'Tab']);

function approach(v, target, rate, dt) {
  const d = target - v;
  const step = rate * dt;
  return Math.abs(d) <= step ? target : v + Math.sign(d) * step;
}

export class Input {
  constructor() {
    this.keys = new Set();
    this.handlers = new Map();
    this.state = { throttle: 0, steer: 0, boost: false, drift: false };
    this.cruise = false;
    this.cruiseLevel = 0.85;
    this.enabled = true;
    this.lastDevice = 'keyboard';
    this.padPrev = [];
    this.touch = { steer: 0, throttle: false, brake: false, boost: false, drift: false, active: false };

    addEventListener('keydown', (e) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLSelectElement) return;
      if (BLOCK_DEFAULT.has(e.code)) e.preventDefault();
      this.lastDevice = 'keyboard';
      if (!e.repeat && PRESSED[e.code]) this.emit(PRESSED[e.code], e);
      this.keys.add(e.code);
      if (this.cruise && HELD.brake.includes(e.code)) this.setCruise(false);
    });
    addEventListener('keyup', (e) => this.keys.delete(e.code));
    addEventListener('blur', () => this.keys.clear());
  }

  on(action, fn) {
    if (!this.handlers.has(action)) this.handlers.set(action, []);
    this.handlers.get(action).push(fn);
  }

  emit(action, event) {
    const list = this.handlers.get(action);
    if (list) for (const fn of list) fn(event);
  }

  held(name) {
    const codes = HELD[name];
    for (let i = 0; i < codes.length; i++) if (this.keys.has(codes[i])) return true;
    return false;
  }

  setCruise(on) {
    this.cruise = on;
    if (on) this.cruiseLevel = Math.max(0.8, this.state.throttle);
    this.emit('cruise-changed', on);
  }

  bindTouch(root) {
    const stick = root.querySelector('#touch-stick');
    const knob = root.querySelector('#touch-knob');
    let id = null;
    const move = (e) => {
      const r = stick.getBoundingClientRect();
      const dx = clamp((e.clientX - (r.left + r.width / 2)) / (r.width / 2), -1, 1);
      const dy = clamp((e.clientY - (r.top + r.height / 2)) / (r.height / 2), -1, 1);
      this.touch.steer = dx;
      knob.style.transform = `translate(${dx * 38}px, ${dy * 38}px)`;
    };
    stick.addEventListener('pointerdown', (e) => {
      id = e.pointerId;
      stick.setPointerCapture(id);
      this.touch.active = true;
      this.lastDevice = 'touch';
      move(e);
    });
    stick.addEventListener('pointermove', (e) => { if (e.pointerId === id) move(e); });
    const end = (e) => {
      if (e.pointerId !== id) return;
      id = null;
      this.touch.steer = 0;
      knob.style.transform = '';
    };
    stick.addEventListener('pointerup', end);
    stick.addEventListener('pointercancel', end);

    for (const btn of root.querySelectorAll('[data-touch]')) {
      const key = btn.dataset.touch;
      if (key === 'pause') {
        btn.addEventListener('pointerdown', () => this.emit('pause'));
        continue;
      }
      const set = (v) => (e) => {
        e.preventDefault();
        this.touch[key] = v;
        this.touch.active = true;
        this.lastDevice = 'touch';
        btn.classList.toggle('pressed', v);
      };
      btn.addEventListener('pointerdown', set(true));
      btn.addEventListener('pointerup', set(false));
      btn.addEventListener('pointercancel', set(false));
      btn.addEventListener('pointerleave', set(false));
    }
  }

  pollGamepad() {
    const pads = navigator.getGamepads ? navigator.getGamepads() : [];
    let pad = null;
    for (const p of pads) if (p && p.connected) { pad = p; break; }
    if (!pad) return null;
    const b = pad.buttons;
    const pressed = (i) => !!b[i] && b[i].pressed;
    const value = (i) => (b[i] ? b[i].value : 0);
    const edge = (i, action) => {
      const now = pressed(i);
      if (now && !this.padPrev[i]) this.emit(action);
      this.padPrev[i] = now;
    };
    edge(0, 'confirm');
    edge(3, 'camera');
    edge(1, 'cruise');
    edge(8, 'chart');
    edge(9, 'pause');
    edge(12, 'sky');
    let sx = pad.axes[0] || 0;
    const dz = 0.14;
    sx = Math.abs(sx) < dz ? 0 : Math.sign(sx) * ((Math.abs(sx) - dz) / (1 - dz));
    const throttle = value(7) - value(6);
    const s = {
      steer: sx * Math.abs(sx) * 0.35 + sx * 0.65,
      throttle,
      boost: pressed(0) || pressed(5),
      drift: pressed(2) || pressed(4),
    };
    if (Math.abs(s.steer) > 0.02 || Math.abs(throttle) > 0.02 || s.boost || s.drift) {
      this.lastDevice = 'gamepad';
      if (this.cruise && value(6) > 0.3) this.setCruise(false);
    }
    return s;
  }

  poll(dt) {
    const st = this.state;
    const pad = this.pollGamepad();
    if (!this.enabled) {
      st.throttle = approach(st.throttle, 0, 4, dt);
      st.steer = approach(st.steer, 0, 8, dt);
      st.boost = false;
      st.drift = false;
      return st;
    }

    if (this.lastDevice === 'gamepad' && pad) {
      st.steer = pad.steer;
      st.throttle = pad.throttle;
      st.boost = pad.boost;
      st.drift = pad.drift;
    } else if (this.lastDevice === 'touch') {
      const t = this.touch;
      st.steer = approach(st.steer, t.steer, 7, dt);
      st.throttle = approach(st.throttle, (t.throttle ? 1 : 0) - (t.brake ? 1 : 0), 5, dt);
      st.boost = t.boost;
      st.drift = t.drift;
    } else {
      const target = (this.held('right') ? 1 : 0) - (this.held('left') ? 1 : 0);
      const reversing = target !== 0 && Math.sign(target) !== Math.sign(st.steer);
      st.steer = approach(st.steer, target, target === 0 ? 7.5 : reversing ? 10 : 4.8, dt);
      const tt = (this.held('throttle') ? 1 : 0) - (this.held('brake') ? 1 : 0);
      st.throttle = approach(st.throttle, tt, tt === 0 ? 5 : 3.2, dt);
      st.boost = this.held('boost');
      st.drift = this.held('drift');
    }

    if (this.cruise && st.throttle < this.cruiseLevel && st.throttle >= 0) st.throttle = this.cruiseLevel;
    return st;
  }
}
