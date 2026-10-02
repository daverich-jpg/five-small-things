import { OrbEngine } from './orb/engine';
import { PRESETS, DEFAULT_PRESET } from './orb/presets';
import { DEFS, dragTaus, GNode } from './orb/graph';
import { LabShell } from './orb/ui/lab';
import { fmt, unit } from './orb/ui/format';
import { StepProbe } from './orb/probe';
import { mountToggleSection } from './toggle/section';
import { mountSheetSection } from './sheet/section';

const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches && !new URLSearchParams(location.search).has('motion');
const SNAPPY = 'cubic-bezier(0.16, 1, 0.3, 1)';

mountToggleSection(reduced);
mountSheetSection(reduced);

const stage = document.getElementById('orb-stage')!;
const home = document.getElementById('orb-canvas-home')!;
const labEl = document.getElementById('lab')!;
const canvas = document.createElement('canvas');
canvas.className = 'orb-canvas';
home.appendChild(canvas);

let engine: OrbEngine;
try {
  engine = new OrbEngine(canvas, PRESETS[DEFAULT_PRESET].graph());
} catch (err: any) {
  stage.classList.add('failed');
  home.innerHTML = `<p class="stage-error">${err.message}<br><small>Try a recent Chrome, Safari or Firefox with hardware acceleration on.</small></p>`;
  throw err;
}

const weak = (navigator.hardwareConcurrency || 8) <= 4 || matchMedia('(max-width: 600px)').matches;
engine.setCount(weak ? 32768 : 65536);
engine.cam.dist = matchMedia('(max-width: 600px)').matches ? 5.6 : 4.9;
// Anticipatory loading: run 6 s of physics behind the shimmer before the first
// visible frame, so the orb arrives already formed instead of assembling on screen.
engine.prewarm(1);
engine.prewarmAsync(5).then(() => {
  engine.start();
  requestAnimationFrame(() => stage.classList.add('ready'));
});
(window as any).orb = engine; // handy for poking at it from the console
document.getElementById('orb-count')!.textContent = engine.sim.count.toLocaleString();
engine.on('count', (n: number) => { document.getElementById('orb-count')!.textContent = n.toLocaleString(); });

// Reduced motion: the orb is a frozen frame until asked.
const playBtn = document.getElementById('stage-play')!;
if (reduced) {
  engine.playing = false;
  playBtn.hidden = false;
  playBtn.addEventListener('click', () => { engine.playing = true; playBtn.hidden = true; });
}

// Only simulate when someone can see it.
new IntersectionObserver(([en]) => { if (engine.mode === 'inline') engine.visible = en.isIntersecting; }, { threshold: 0.02 }).observe(stage);
document.addEventListener('visibilitychange', () => { engine.visible = !document.hidden && (engine.mode === 'lab' || stage.getBoundingClientRect().bottom > 0); });

// ── inline controls: bound to whichever node of that kind is in the graph ──
const inline = [...document.querySelectorAll<HTMLInputElement>('#orb-inline input')];
function bound(input: HTMLInputElement): { n: GNode; key: string } | null {
  const [kind, key] = input.dataset.bind!.split('.');
  const n = engine.graph.nodes.find((x) => x.kind === kind && engine.compiled.active.has(x.id) && !x.bypass);
  return n ? { n, key } : null;
}
function syncInline() {
  for (const input of inline) {
    const b = bound(input);
    const label = input.closest('label')!;
    label.classList.toggle('off', !b);
    const [kind, key] = input.dataset.bind!.split('.');
    const pd = DEFS[kind].params.find((p) => p.key === key)!;
    input.min = String(pd.min);
    input.max = String(kind === 'vortex' ? 24 : pd.max);
    input.step = String(pd.step);
    input.disabled = !b;
    const v = b ? b.n.params[key] : pd.def;
    if (document.activeElement !== input) input.value = String(v);
    input.style.setProperty('--fill', `${((v - pd.min) / (+input.max - pd.min)) * 100}%`);
    (input.nextElementSibling as HTMLOutputElement).textContent = b ? `${fmt(pd, v)}${unit(pd) === 'rad/s' ? '' : unit(pd)}` : '—';
  }
}
for (const input of inline) {
  input.addEventListener('input', () => {
    const b = bound(input);
    if (b) engine.setParams(b.n, { [b.key]: +input.value }, 'ui');
  });
}

// ── the curve: drawn from the live drag/mass parameters ──
const svg = document.getElementById('curve')!;
function drawCurve() {
  const t = dragTaus(engine.graph, engine.compiled);
  const tauEl = document.getElementById('spec-tau')!;
  const settleEl = document.getElementById('spec-settle')!;
  const W = 320, H = 150, px = 10, py = 14, T = 3;
  const X = (s: number) => px + (s / T) * (W - px * 2);
  const Y = (v: number) => H - py - v * (H - py * 2);
  let out = `<line class="ax" x1="${px}" y1="${Y(0)}" x2="${W - px}" y2="${Y(0)}"/><line class="ax dash" x1="${px}" y1="${Y(1)}" x2="${W - px}" y2="${Y(1)}"/>`;
  for (let s = 1; s < T; s++) out += `<line class="tick" x1="${X(s)}" y1="${Y(0)}" x2="${X(s)}" y2="${Y(0) + 4}"/>`;
  if (!t) {
    tauEl.textContent = 'no drag';
    settleEl.textContent = '—';
    svg.innerHTML = out + `<text x="${W / 2}" y="${H / 2}" class="lbl" text-anchor="middle">No drag: particles ignore the flow.</text>`;
    return;
  }
  const path = (tau: number) => {
    let d = '';
    for (let i = 0; i <= 90; i++) {
      const s = (i / 90) * T;
      const v = isFinite(tau) && tau > 0 ? 1 - Math.exp(-s / tau) : 0;
      d += `${i ? 'L' : 'M'}${X(s).toFixed(1)},${Y(v).toFixed(1)}`;
    }
    return d;
  };
  out += `<path class="c dust" d="${path(t.dust)}"/><path class="c core" d="${path(t.core)}"/><path class="c vortex" d="${path(t.vortex)}"/>`;
  const settle = 3 * t.vortex;
  if (settle < T) out += `<line class="mark" x1="${X(settle)}" y1="${Y(0)}" x2="${X(settle)}" y2="${Y(0.95)}"/><circle class="dot" cx="${X(settle)}" cy="${Y(0.95)}" r="3"/><text class="lbl" x="${X(settle) + 6}" y="${Y(0.95) + 14}">95%</text>`;
  // the measurement: real particle velocities read back from the GPU
  const pts = probe.normalised().filter((p) => p.t <= T);
  if (pts.length > 1) {
    out += `<path class="meas-line" d="${pts.map((p, i) => `${i ? 'L' : 'M'}${X(p.t).toFixed(1)},${Y(Math.max(-0.1, Math.min(1.25, p.y))).toFixed(1)}`).join('')}"/>`;
    out += pts.map((p) => `<circle class="meas" cx="${X(p.t).toFixed(1)}" cy="${Y(Math.max(-0.1, Math.min(1.25, p.y))).toFixed(1)}" r="1.6"/>`).join('');
    const m = probe.m!;
    if (m.done && m.tau !== undefined && m.tau < T) {
      out += `<line class="meas-mark" x1="${X(m.tau)}" y1="${Y(0)}" x2="${X(m.tau)}" y2="${Y(0.632)}"/><text class="lbl amber" x="${X(m.tau) + 5}" y="${Y(0) - 6}">τ measured</text>`;
    }
  }
  svg.innerHTML = out;
  tauEl.textContent = `${t.vortex.toFixed(2)} s`;
  settleEl.textContent = `${settle.toFixed(2)} s`;
}

// ── Yank: step the spin, then measure the response from the live particles ──
const probe = new StepProbe(engine);
const yank = document.getElementById('yank') as HTMLButtonElement;
const tauM = document.getElementById('spec-tau-m')!;
const tauNote = document.getElementById('spec-tau-note')!;
const settleM = document.getElementById('spec-settle-m')!;
const over = document.getElementById('spec-over')!;
const overNote = document.getElementById('spec-over-note')!;
yank.addEventListener('click', () => {
  const v = engine.graph.nodes.find((n) => n.kind === 'vortex' && engine.compiled.active.has(n.id) && !n.bypass);
  if (!v) return;
  if (!engine.playing) { engine.playing = true; playBtn.hidden = true; }
  const from = v.params.strength;
  const to = from < 9 ? 14 : 4;
  probe.start(to / Math.max(from, 0.1));
  engine.setParams(v, { strength: to }, 'ui');
  yank.classList.add('measuring');
  yank.textContent = 'Measuring…';
  tauM.textContent = '…';
  tauNote.textContent = `spin ${from.toFixed(0)} → ${to} rad/s, sampling 2,048 particles`;
});
engine.on('frame', () => {
  if (!probe.sample()) return;
  drawCurve();
  const m = probe.m!;
  if (m.done) {
    yank.classList.remove('measuring');
    yank.textContent = 'Yank the spin';
    tauM.textContent = m.tau !== undefined ? `${m.tau.toFixed(2)} s` : 'n/a';
    tauNote.textContent = 'from real particle velocities';
    settleM.textContent = m.settle !== undefined ? `· measured ${m.settle.toFixed(2)} s` : '';
    over.textContent = `${((m.overshoot ?? 0) * 100).toFixed(0)}%`;
    overNote.textContent = 'measured. First-order drag can’t overshoot; anything here is the flow itself';
  }
});

let pending = false;
const refreshDoc = () => {
  if (pending) return;
  pending = true;
  requestAnimationFrame(() => { pending = false; syncInline(); drawCurve(); });
};
engine.on('param', refreshDoc);
engine.on('graph', refreshDoc);
refreshDoc();

// ── the lab: the stage morphs into the editor ──
const lab = new LabShell(labEl, engine);
let open = false;

function openLab() {
  if (open) return;
  open = true;
  const from = stage.getBoundingClientRect();
  labEl.hidden = false;
  document.body.classList.add('lab-open');
  lab.view.prepend(canvas);
  engine.mode = 'lab';
  engine.start();
  engine.visible = true;
  if (reduced) { engine.playing = true; playBtn.hidden = true; }
  engine.emit('playing');
  lab.layout();
  if (!reduced) {
    const vw = innerWidth, vh = innerHeight;
    labEl.animate(
      [
        { clipPath: `inset(${from.top}px ${vw - from.right}px ${vh - from.bottom}px ${from.left}px round 18px)` },
        { clipPath: 'inset(0px 0px 0px 0px round 0px)' },
      ],
      { duration: 620, easing: SNAPPY },
    );
    // panels arrive after the viewport has claimed the space
    const parts: [string, number][] = [['.lab-bar', 140], ['.lab-insp', 220], ['.lab-graph', 280]];
    for (const [sel, delay] of parts) {
      labEl.querySelector(sel)?.animate(
        [{ opacity: 0, transform: sel === '.lab-insp' ? 'translateX(16px)' : 'translateY(12px)' }, { opacity: 1, transform: 'none' }],
        { duration: 420, delay, easing: SNAPPY, fill: 'backwards' },
      );
    }
  }
  history.replaceState(null, '', '#lab');
}

function closeLab() {
  if (!open) return;
  open = false;
  const done = () => {
    labEl.hidden = true;
    document.body.classList.remove('lab-open');
    home.prepend(canvas);
    engine.mode = 'inline';
    engine.select(null);
    refreshDoc();
    history.replaceState(null, '', '#orb');
  };
  if (reduced) return done();
  const to = stage.getBoundingClientRect();
  const vw = innerWidth, vh = innerHeight;
  const a = labEl.animate(
    [
      { clipPath: 'inset(0px 0px 0px 0px round 0px)' },
      { clipPath: `inset(${Math.max(0, to.top)}px ${vw - to.right}px ${Math.max(0, vh - to.bottom)}px ${to.left}px round 18px)` },
    ],
    { duration: 380, easing: 'cubic-bezier(0.7, 0, 0.84, 0)' },
  );
  a.onfinish = done;
}

document.getElementById('open-lab')!.addEventListener('click', openLab);
lab.onClose = closeLab;
if (location.hash === '#lab') requestAnimationFrame(openLab);
