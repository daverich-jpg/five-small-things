import { SpringToggle, CssToggle } from './toggle';
import { characterize, cssLinear, overshootOf, response, zetaFor } from './spring';

const W_DEFAULT = 22.4;      // rad/s → response 0.28 s
const OS_DEFAULT = 0.08;
const REAL_TRAVEL_PX = 20;   // a 51 × 31 pt switch

const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;

/** cubic-bezier(x1,y1,x2,y2) evaluated at progress x (for drawing the CSS comparison). */
function bezier(x1: number, y1: number, x2: number, y2: number) {
  const B = (a: number, b: number, t: number) => 3 * a * t * (1 - t) ** 2 + 3 * b * t * t * (1 - t) + t ** 3;
  return (x: number) => {
    let t = x;
    for (let i = 0; i < 8; i++) {
      const dx = B(x1, x2, t) - x;
      const d = 3 * x1 * (1 - t) ** 2 + 6 * (x2 - x1) * t * (1 - t) + 3 * (1 - x2) * t * t;
      if (Math.abs(d) < 1e-6) break;
      t = Math.min(1, Math.max(0, t - dx / d));
    }
    return B(y1, y2, t);
  };
}
const ease = bezier(0.25, 0.1, 0.25, 1);

export function mountToggleSection(reduced: boolean) {
  let w = W_DEFAULT;
  let os = reduced ? 0 : OS_DEFAULT;

  // ── the big one ──
  const big = new SpringToggle($('tg-big'), { w, z: zetaFor(os), label: 'Demo switch', draggable: true });

  // ── the ladder: same speed, different damping, plus a CSS transition ──
  const ladder: { t: SpringToggle | CssToggle; os: number | null }[] = [];
  const rungs: [string, number | null][] = [['CSS ease, 300 ms', null], ['Spring, 0%', 0], ['Spring, 8%', 0.08], ['Spring, 30%', 0.3]];
  for (const [label, o] of rungs) {
    const cell = document.createElement('div');
    cell.className = 'rung';
    $('tg-ladder').appendChild(cell);
    const t = o === null ? new CssToggle(cell, label, '300ms ease') : new SpringToggle(cell, { w: W_DEFAULT, z: zetaFor(reduced ? 0 : o), label });
    const cap = document.createElement('span');
    cap.textContent = label;
    cell.appendChild(cap);
    ladder.push({ t, os: o });
  }
  $('tg-hammer').addEventListener('click', () => {
    // tap everything twice, 110 ms apart: CSS restarts from rest, springs turn around
    ladder.forEach(({ t }) => t.toggle());
    setTimeout(() => ladder.forEach(({ t }) => t.toggle()), 110);
  });

  // ── controls ──
  const osIn = $<HTMLInputElement>('tg-os'), wIn = $<HTMLInputElement>('tg-w');
  osIn.value = String(os * 100);
  wIn.value = String(w);
  const apply = () => {
    os = +osIn.value / 100;
    w = +wIn.value;
    big.setSpring(w, zetaFor(os));
    render();
  };
  osIn.addEventListener('input', apply);
  wIn.addEventListener('input', apply);
  $('tg-reset').addEventListener('click', () => { osIn.value = '8'; wIn.value = String(W_DEFAULT); apply(); });

  // ── measurement: what was actually painted, read from the DOM every frame ──
  let meas: { t0: number; x0: number; v0: number; target: number; pts: { t: number; y: number }[]; done: boolean } | null = null;
  const knobX = () => {
    const r = big.knob.getBoundingClientRect(), tr = big.el.getBoundingClientRect();
    const pad = Math.round(tr.height * 0.065), k = tr.height - pad * 2, travel = tr.width - pad * 2 - k;
    const grow = r.width - k;
    const anchor = Math.min(1, Math.max(0, big.pos.x));
    return (r.left - tr.left - pad + grow * anchor) / travel;
  };
  big.onChange = (on, from) => {
    meas = { t0: performance.now(), x0: from.x, v0: from.v, target: on ? 1 : 0, pts: [], done: false };
  };
  big.onMove = (_x, now) => {
    if (!meas || meas.done) return;
    const span = meas.target - meas.x0;
    if (Math.abs(span) < 1e-3) return;
    meas.pts.push({ t: (now - meas.t0) / 1000, y: (knobX() - meas.x0) / span });
    if (meas.pts.length % 3 === 0) render();
  };
  big.onSettle = () => { if (meas && !meas.done) { meas.done = true; render(); } };

  // ── spec + curve ──
  $('tg-copy').addEventListener('click', async () => {
    const c = cssLinear(w, zetaFor(os));
    const text = `transition: transform ${c.duration}ms ${c.easing};`;
    try { await navigator.clipboard.writeText(text); $('tg-copy').textContent = 'Copied'; }
    catch { $('tg-copy').textContent = 'Copy failed'; }
    setTimeout(() => { $('tg-copy').textContent = 'Copy as CSS'; }, 1400);
  });

  const svg = $('tg-curve');
  function render() {
    const z = zetaFor(os);
    const ch = characterize(w, z);
    const k = w * w, c = 2 * z * w;
    $('tg-os-out').textContent = `${(os * 100).toFixed(0)}%`;
    $('tg-w-out').textContent = `${(2 * Math.PI / w).toFixed(2)} s`;
    $('tg-kc').textContent = `k = ${k.toFixed(0)}, c = ${c.toFixed(1)}`;
    $('tg-zeta').textContent = z.toFixed(2);
    $('tg-over').textContent = `${(overshootOf(z) * 100).toFixed(1)}%`;
    $('tg-px').textContent = `${(overshootOf(z) * REAL_TRAVEL_PX).toFixed(1)} px on a real 51 pt switch`;
    $('tg-peak').textContent = ch.peakMs !== null ? `${ch.peakMs} ms` : 'none';
    $('tg-settle').textContent = `${ch.settleMs} ms`;
    $('tg-swiftui').textContent = `.spring(response: ${(2 * Math.PI / w).toFixed(2)}, dampingFraction: ${z.toFixed(2)})`;
    $('tg-default').hidden = Math.abs(os - OS_DEFAULT) < 0.001 && Math.abs(w - W_DEFAULT) < 0.01;

    // measured, from the last toggle of the big switch
    const m = meas;
    if (m && m.done && m.pts.length > 3) {
      let peak = -Infinity, settle = 0;
      for (const p of m.pts) { peak = Math.max(peak, p.y); if (Math.abs(p.y - 1) > 0.02) settle = p.t; }
      const fromRest = Math.abs(m.v0) < 0.05 && (Math.abs(m.x0) < 0.02 || Math.abs(m.x0 - 1) < 0.02);
      $('tg-meas').textContent = `${(Math.max(0, peak - 1) * 100).toFixed(1)}% · settles ${Math.round(settle * 1000)} ms`;
      $('tg-meas-note').textContent = fromRest
        ? `${m.pts.length} painted frames, read back from the DOM`
        : `started mid-flight (v₀ = ${m.v0.toFixed(1)} travel/s), so the prediction bends to match`;
    }

    const Wd = 320, H = 160, px = 10, py = 18, T = 0.6;
    const X = (t: number) => px + (t / T) * (Wd - px * 2);
    const Y = (y: number) => H - py - ((y + 0.15) / 1.5) * (H - py * 2);
    let s = `<line class="ax" x1="${px}" y1="${Y(0)}" x2="${Wd - px}" y2="${Y(0)}"/><line class="ax dash" x1="${px}" y1="${Y(1)}" x2="${Wd - px}" y2="${Y(1)}"/>`;
    s += `<rect class="band" x="${px}" y="${Y(1.02)}" width="${Wd - px * 2}" height="${Y(0.98) - Y(1.02)}"/>`;
    for (let ms = 100; ms < 600; ms += 100) s += `<line class="tick" x1="${X(ms / 1000)}" y1="${Y(0)}" x2="${X(ms / 1000)}" y2="${Y(0) + 4}"/><text class="lbl" x="${X(ms / 1000)}" y="${Y(0) + 14}" text-anchor="middle">${ms}</text>`;
    const path = (f: (t: number) => number) => {
      let d = '';
      for (let i = 0; i <= 120; i++) { const t = (i / 120) * T; d += `${i ? 'L' : 'M'}${X(t).toFixed(1)},${Y(f(t)).toFixed(1)}`; }
      return d;
    };
    s += `<path class="c ease" d="${path((t) => (t >= 0.3 ? 1 : ease(t / 0.3)))}"/>`;
    // prediction: from rest, or from wherever the measured toggle actually started
    const pred = m && m.done ? (t: number) => {
      const span = m.target - m.x0;
      return (response(w, z, t, m.x0, m.v0, m.target) - m.x0) / span;
    } : (t: number) => response(w, z, t);
    s += `<path class="c spring" d="${path(pred)}"/>`;
    if (ch.peakMs !== null && !(m && m.done && Math.abs(m.v0) > 0.05)) {
      const pt = ch.peakMs / 1000, pv = 1 + ch.overshoot;
      s += `<circle class="dot" cx="${X(pt)}" cy="${Y(pv)}" r="3"/><text class="lbl" x="${X(pt) + 6}" y="${Y(pv) - 5}">+${(ch.overshoot * 100).toFixed(1)}% at ${ch.peakMs} ms</text>`;
    }
    if (ch.settleMs / 1000 < T) s += `<line class="mark" x1="${X(ch.settleMs / 1000)}" y1="${Y(0)}" x2="${X(ch.settleMs / 1000)}" y2="${Y(1)}"/><text class="lbl" x="${X(ch.settleMs / 1000) + 5}" y="${Y(0.5)}">±2%</text>`;
    if (m && m.pts.length) s += m.pts.filter((p) => p.t <= T).map((p) => `<circle class="meas" cx="${X(p.t).toFixed(1)}" cy="${Y(Math.max(-0.15, Math.min(1.35, p.y))).toFixed(1)}" r="1.8"/>`).join('');
    svg.innerHTML = s;
  }
  render();
}
