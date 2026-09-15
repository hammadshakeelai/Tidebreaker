// Nautical chart overlay (M). Drawn to a 2D canvas only while it is open.
import { LIVERIES } from './boat.js';

export class Chart {
  constructor(canvas, world) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.world = world;
    this.open = false;
    this.acc = 0;
    const cps = world.checkpoints;
    const xs = cps.map((c) => c.x);
    const zs = cps.map((c) => c.z);
    this.cx = (Math.min(...xs) + Math.max(...xs)) / 2;
    this.cz = (Math.min(...zs) + Math.max(...zs)) / 2;
    const span = Math.max(Math.max(...xs) - Math.min(...xs), Math.max(...zs) - Math.min(...zs)) + 420;
    this.scale = canvas.width / span;
  }

  toCanvas(x, z) {
    const w = this.canvas.width;
    return [w / 2 - (x - this.cx) * this.scale, w / 2 - (z - this.cz) * this.scale];
  }

  draw(entrants, playerNext, ghost) {
    const ctx = this.ctx;
    const w = this.canvas.width;
    const g = ctx.createLinearGradient(0, 0, 0, w);
    g.addColorStop(0, '#2c2150');
    g.addColorStop(1, '#3d2c63');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, w, w);

    ctx.strokeStyle = 'rgba(255, 236, 230, 0.06)';
    ctx.lineWidth = 1;
    for (let i = 0; i <= w; i += 60) {
      ctx.beginPath(); ctx.moveTo(i, 0); ctx.lineTo(i, w); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(0, i); ctx.lineTo(w, i); ctx.stroke();
    }

    for (const isl of this.world.islands) {
      const [x, y] = this.toCanvas(isl.x, isl.z);
      const r = isl.r * this.scale;
      if (x < -r || y < -r || x > w + r || y > w + r) continue;
      ctx.beginPath();
      ctx.arc(x, y, r * 1.25 + 3, 0, Math.PI * 2);
      ctx.fillStyle = 'rgba(92, 225, 230, 0.08)';
      ctx.fill();
      ctx.beginPath();
      ctx.arc(x, y, r, 0, Math.PI * 2);
      ctx.fillStyle = '#b35a56';
      ctx.fill();
    }

    const cps = this.world.checkpoints;
    ctx.setLineDash([6, 7]);
    ctx.strokeStyle = 'rgba(255, 207, 143, 0.55)';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    const last = cps[cps.length - 1];
    ctx.moveTo(...this.toCanvas(last.x, last.z));
    for (const cp of cps) ctx.lineTo(...this.toCanvas(cp.x, cp.z));
    ctx.stroke();
    ctx.setLineDash([]);

    ctx.font = '500 12px "IBM Plex Mono", monospace';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    cps.forEach((cp, i) => {
      const [x, y] = this.toCanvas(cp.x, cp.z);
      const next = i === playerNext;
      const lit = i < playerNext;
      ctx.beginPath();
      ctx.arc(x, y, next ? 13 : 10, 0, Math.PI * 2);
      ctx.fillStyle = next ? '#5ce1e6' : lit ? '#ffcf8f' : 'rgba(255, 241, 230, 0.2)';
      ctx.fill();
      ctx.fillStyle = next || lit ? '#2c2150' : '#fbf1ee';
      ctx.fillText(cp.gate ? 'F' : String(i + 1), x, y + 0.5);
      ctx.fillStyle = 'rgba(251, 241, 238, 0.75)';
      ctx.fillText(cp.name.toUpperCase(), x, y + 24);
    });

    const boat = (b, color, size, outline) => {
      const [x, y] = this.toCanvas(b.x, b.z);
      ctx.save();
      ctx.translate(x, y);
      ctx.rotate(Math.PI - b.heading);
      ctx.beginPath();
      ctx.moveTo(0, -size);
      ctx.lineTo(size * 0.6, size * 0.8);
      ctx.lineTo(-size * 0.6, size * 0.8);
      ctx.closePath();
      ctx.fillStyle = color;
      ctx.fill();
      if (outline) {
        ctx.strokeStyle = '#fff';
        ctx.lineWidth = 2;
        ctx.stroke();
      }
      ctx.restore();
    };
    if (ghost) boat(ghost, 'rgba(216, 251, 255, 0.45)', 8, false);
    for (const e of entrants) {
      if (!e.active) continue;
      const b = e.boat;
      boat({ x: b.pos.x, z: b.pos.z, heading: b.heading }, LIVERIES[b.livery].hull, b.isPlayer ? 11 : 8, b.isPlayer);
    }

    // North arrow
    ctx.save();
    ctx.translate(w - 40, 44);
    ctx.fillStyle = '#ffcf8f';
    ctx.beginPath();
    ctx.moveTo(0, -16); ctx.lineTo(6, 6); ctx.lineTo(0, 2); ctx.lineTo(-6, 6);
    ctx.closePath();
    ctx.fill();
    ctx.fillStyle = '#fbf1ee';
    ctx.fillText('N', 0, 20);
    ctx.restore();

    // Scale bar: 200 m
    const px = 200 * this.scale;
    ctx.strokeStyle = '#fbf1ee';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(24, w - 28); ctx.lineTo(24 + px, w - 28);
    ctx.stroke();
    ctx.textAlign = 'left';
    ctx.fillStyle = 'rgba(251, 241, 238, 0.75)';
    ctx.fillText('200 M', 24, w - 44);
  }
}
