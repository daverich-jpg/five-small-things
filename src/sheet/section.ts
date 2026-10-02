import { Sheet, Release, fingerVelocity, project } from './sheet';
import { advance } from '../toggle/spring';

const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;
const fmtV = (v: number) => `${Math.round(Math.abs(v)).toLocaleString()} px/s`;

/** Velocity of CSS `ease` (cubic-bezier(.25,.1,.25,1)) over a move of `dist` px in `dur` s, at time t. */
function easeVelocity(t: number, dist: number, dur: number) {
  if (t < 0 || t > dur) return 0;
  const B = (a: number, b: number, u: number) => 3 * a * u * (1 - u) ** 2 + 3 * b * u * u * (1 - u) + u ** 3;
  const dB = (a: number, b: number, u: number) => 3 * a * (1 - u) ** 2 + 6 * (b - a) * u * (1 - u) + 3 * (1 - b) * u * u;
  let u = t / dur;
  for (let i = 0; i < 8; i++) u = Math.min(1, Math.max(0, u - (B(0.25, 0.25, u) - t / dur) / Math.max(dB(0.25, 0.25, u), 1e-4)));
  return (dB(0.1, 1, u) / Math.max(dB(0.25, 0.25, u), 1e-4)) * (dist / dur);
}

interface Rec {
  t0: number;                 // release time
  release: Release | null;
  finger: { t: number; v: number }[];
  sheet: { t: number; v: number }[];
  lastY: number | null;
  lastT: number;
  done: boolean;
}

export function mountSheetSection(reduced: boolean) {
  const screen = $('sh-screen'), panel = $('sh-panel');
  const sheet = new Sheet(screen, panel);
  if (reduced) sheet.z = 1;
  (window as any).sheet = sheet; // handy for poking at it from the console

  // ── recording: finger velocity until release, painted sheet velocity after ──
  let rec: Rec | null = null;
  const origBegin = sheet.begin.bind(sheet);
  sheet.begin = (py, t) => {
    rec = { t0: 0, release: null, finger: [], sheet: [], lastY: null, lastT: 0, done: false };
    origBegin(py, t);
  };
  sheet.onRelease = (r) => {
    if (!rec) return;
    rec.t0 = r.t;
    rec.release = r;
    rec.finger.push({ t: r.t, v: r.v });
    renderSpec(r);
  };
  sheet.onFrame = (y, now) => {
    const r = rec;
    if (!r || r.done) return;
    if (!r.release) {
      r.finger.push({ t: now, v: fingerVelocity(sheet.samples, now) });
    } else {
      if (r.lastY !== null && now > r.lastT) r.sheet.push({ t: (now + r.lastT) / 2, v: ((y - r.lastY) / (now - r.lastT)) * 1000 });
      if (now - r.t0 > 750) { r.done = true; draw(); }
    }
    r.lastY = y;
    r.lastT = now;
    if (r.release) draw();
  };
  sheet.onSettle = () => { if (rec && rec.release && !rec.done) { rec.done = true; draw(); } };

  // ── controls ──
  const modeBtns = document.querySelectorAll<HTMLButtonElement>('#sh-mode button');
  modeBtns.forEach((b) => b.addEventListener('click', () => {
    sheet.handoff = b.dataset.mode as 'spring' | 'css';
    modeBtns.forEach((x) => x.classList.toggle('on', x === b));
    $('sh-mode-note').textContent = sheet.handoff === 'spring'
      ? 'The spring starts at the finger’s speed.'
      : 'The transition starts from rest, whatever your finger was doing.';
  }));
  // ── spring controls: every value is live, the next throw uses it ──
  // reduced motion only changes the default (no overshoot); an explicit slider choice always wins
  const DEF = { resp: 2 * Math.PI / 15, z: reduced ? 1 : 0.86, carry: 100, decel: 0.998 };
  const rIn = $<HTMLInputElement>('sh-resp'), zIn = $<HTMLInputElement>('sh-zeta');
  const cIn = $<HTMLInputElement>('sh-carry'), dIn = $<HTMLInputElement>('sh-decel');
  const fill = (i: HTMLInputElement) => i.style.setProperty('--fill', `${((+i.value - +i.min) / (+i.max - +i.min)) * 100}%`);
  const applySpring = () => {
    const resp = +rIn.value, z = +zIn.value;
    sheet.w = (2 * Math.PI) / resp;
    sheet.z = z;
    sheet.carry = +cIn.value / 100;
    sheet.decel = +dIn.value;
    [rIn, zIn, cIn, dIn].forEach(fill);
    $('sh-resp-out').textContent = `${resp.toFixed(2)} s`;
    $('sh-zeta-out').textContent = z.toFixed(2);
    $('sh-carry-out').textContent = `${cIn.value}%`;
    $('sh-decel-out').textContent = sheet.decel.toFixed(4).replace(/0+$/, '');
    const k = sheet.w * sheet.w, c = 2 * sheet.z * sheet.w;
    $('sh-spring').textContent = `ω ${sheet.w.toFixed(1)}, ζ ${sheet.z.toFixed(2)}, v₀ = ${cIn.value === '100' ? 'finger' : `${cIn.value}% of finger`}`;
    $('sh-spring-note').textContent = `k ${k.toFixed(0)}, c ${c.toFixed(1)} · ${sheet.z < 1 ? 'can overshoot when thrown' : 'never overshoots'}`;
    $('sh-proj-note').textContent = `a 1,500 px/s flick coasts ${Math.round(project(1500, sheet.decel))} px`;
    // mini preview: a 1,500 px/s upward throw from half to full, position over 900 ms
    const dist = sheet.snaps[1] - sheet.snaps[0];
    const v0 = -1500 * sheet.carry;
    let d = '', peak = 0;
    for (let i = 0; i <= 90; i++) {
      const t = (i / 90) * 0.9;
      const off = advance(dist, v0, sheet.w, sheet.z, t)[0]; // distance still to go
      const prog = 1 - off / dist;
      peak = Math.max(peak, prog);
      d += `${i ? 'L' : 'M'}${(4 + (t / 0.9) * 212).toFixed(1)},${(48 - prog * 36).toFixed(1)}`;
    }
    $('sh-mini').innerHTML = `<line class="ax dash" x1="4" y1="12" x2="216" y2="12"/><line class="ax" x1="4" y1="48" x2="216" y2="48"/><path class="c spring" d="${d}"/><text class="lbl" x="216" y="9" text-anchor="end">${peak > 1.005 ? `+${Math.round((peak - 1) * dist)} px past full` : 'no overshoot'}</text>`;
    $('sh-spring-reset').hidden = Math.abs(resp - DEF.resp) < 0.005 && Math.abs(z - DEF.z) < 0.005 && +cIn.value === DEF.carry && Math.abs(sheet.decel - DEF.decel) < 1e-5;
  };
  [rIn, zIn, cIn, dIn].forEach((i) => i.addEventListener('input', applySpring));
  $('sh-spring-reset').addEventListener('click', () => {
    rIn.value = String(DEF.resp); zIn.value = String(DEF.z); cIn.value = String(DEF.carry); dIn.value = String(DEF.decel);
    applySpring();
  });
  rIn.value = String(DEF.resp); zIn.value = String(DEF.z); cIn.value = String(DEF.carry); dIn.value = String(DEF.decel);
  applySpring();

  const proj = $<HTMLInputElement>('sh-proj-on');
  proj.addEventListener('change', () => { sheet.showProjection = proj.checked; });

  // a scripted flick for people with a mouse: accelerate, release at speed
  $('sh-fling').addEventListener('click', () => {
    if (sheet.dragging) return;
    const H = sheet.H;
    const up = sheet.target > H * 0.3;
    const dir = up ? -1 : 1;
    const t0 = performance.now();
    const py0 = 0;
    const a = 11000; // px/s²
    sheet.begin(py0, t0);
    const step = (now: number) => {
      const t = (now - t0) / 1000;
      if (t < 0.15) {
        // feed several samples per frame, like a real touch digitiser
        for (let k = 3; k >= 0; k--) {
          const tk = Math.max(0, t - k * 0.004);
          sheet.move(py0 + dir * 0.5 * a * tk * tk, t0 + tk * 1000);
        }
        requestAnimationFrame(step);
      } else sheet.end(now);
    };
    requestAnimationFrame(step);
  });

  // ── spec ──
  function renderSpec(r: Release) {
    $('sh-rel').textContent = fmtV(r.v);
    $('sh-coast').textContent = `${Math.round(Math.abs(project(r.v, sheet.decel)))} px`;
    const names = ['full', 'half', 'peek'];
    const i = sheet.snaps.indexOf(r.target);
    const fingerNearest = sheet.snaps.reduce((b, s) => (Math.abs(s - r.y) < Math.abs(b - r.y) ? s : b), sheet.snaps[0]);
    $('sh-pick').textContent = names[i] ?? '—';
    $('sh-pick-note').textContent = fingerNearest !== r.target
      ? `your finger stopped nearest ${names[sheet.snaps.indexOf(fingerNearest)]}; the flick meant ${names[i]}`
      : 'the finger and the flick agreed';
  }

  // ── graph: velocity across the hand-off ──
  const svg = $('sh-curve');
  function draw() {
    const r = rec;
    const W = 320, H = 170, px = 12, py = 16, T0 = -0.25, T1 = 0.7;
    const X = (t: number) => px + ((t - T0) / (T1 - T0)) * (W - px * 2);
    let s = '';
    if (!r || !r.release) { svg.innerHTML = `<text class="lbl" x="${W / 2}" y="${H / 2}" text-anchor="middle">Fling the sheet to record a hand-off.</text>`; return; }
    const rel = r.release;
    // plot speed toward the target, so both directions read the same way
    const sgn = rel.target < rel.y || (rel.target === rel.y && rel.v < 0) ? -1 : 1;
    const finger = r.finger.map((p) => ({ t: (p.t - r.t0) / 1000, v: p.v * sgn })).filter((p) => p.t >= T0);
    const painted = r.sheet.map((p) => ({ t: (p.t - r.t0) / 1000, v: p.v * sgn })).filter((p) => p.t <= T1);
    const pred: { t: number; v: number }[] = [];
    for (let i = 0; i <= 100; i++) {
      const t = (i / 100) * T1;
      const v = rel.handoff === 'spring'
        ? advance(rel.y - rel.target, rel.v * rel.carry, rel.w, rel.z, t)[1]
        : easeVelocity(t, rel.target - rel.y, 0.3);
      pred.push({ t, v: v * sgn });
    }
    const vmax = Math.max(400, ...finger.map((p) => Math.abs(p.v)), ...painted.map((p) => Math.abs(p.v)), ...pred.map((p) => Math.abs(p.v))) * 1.1;
    const Y = (v: number) => py + (1 - (v + vmax * 0.25) / (vmax * 1.25)) * (H - py * 2);
    s += `<line class="ax" x1="${px}" y1="${Y(0)}" x2="${W - px}" y2="${Y(0)}"/>`;
    s += `<line class="mark" x1="${X(0)}" y1="${py - 6}" x2="${X(0)}" y2="${H - py}"/><text class="lbl" x="${X(0) + 4}" y="${py}">release</text>`;
    for (const ms of [-200, 200, 400, 600]) s += `<text class="lbl" x="${X(ms / 1000)}" y="${H - 2}" text-anchor="middle">${ms > 0 ? '+' : ''}${ms}</text>`;
    s += `<path class="c spring" d="${pred.map((p, i) => `${i ? 'L' : 'M'}${X(p.t).toFixed(1)},${Y(p.v).toFixed(1)}`).join('')}"/>`;
    s += finger.map((p) => `<circle class="meas" cx="${X(p.t).toFixed(1)}" cy="${Y(p.v).toFixed(1)}" r="1.9"/>`).join('');
    s += painted.map((p) => `<circle class="paint" cx="${X(p.t).toFixed(1)}" cy="${Y(p.v).toFixed(1)}" r="1.9"/>`).join('');
    svg.innerHTML = s;

    // the number that matters: speed at the instant of release, before vs after.
    // Fit a line through the first painted frames and read it at t = 0, so a spring
    // that is (correctly) accelerating hard toward a far snap isn't mistaken for a jump.
    const early = painted.filter((p) => p.t > 0).slice(0, 3);
    if (early.length === 3) {
      // Lagrange quadratic through the first three painted frames, evaluated at t = 0
      const [a, b, c] = early;
      const L = (p: typeof a, q: typeof a, r: typeof a) => p.v * ((0 - q.t) * (0 - r.t)) / ((p.t - q.t) * (p.t - r.t));
      const at0 = L(a, b, c) + L(b, a, c) + L(c, a, b);
      const toward = rel.v * sgn; // finger speed toward the snap (negative = away from it)
      const before = Math.abs(rel.v), after = at0;
      $('sh-hand').textContent = `${fmtV(before)} → ${fmtV(after)}`;
      if (before < 30) $('sh-hand-note').textContent = 'you let go from rest, so there was nothing to hand over';
      else {
        const kept = after / toward;
        const meant = rel.handoff === 'spring' ? rel.carry : 0;
        $('sh-hand-note').textContent = meant < 0.999 && rel.handoff === 'spring'
          ? `${Math.round(kept * 100)}% carried across (you set it to hand over ${Math.round(meant * 100)}%)`
          : Math.abs(kept - 1) < 0.1
          ? `${Math.round(kept * 100)}% of the finger’s speed carried across the release`
          : rel.handoff === 'css'
            ? `the transition restarted at ${fmtV(after)}, whatever your finger was doing`
            : `${Math.round(kept * 100)}% carried across — the sheet hit a frame drop`;
      }
    }
  }
  draw();
}
