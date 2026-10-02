import { OrbEngine } from '../engine';
import { PRESETS } from '../presets';
import { Inspector } from './inspector';
import { NodeEditor } from './nodes';
import { el } from './format';

export const COUNTS = [8192, 16384, 32768, 65536, 131072, 262144];

export class LabShell {
  root: HTMLElement;
  e: OrbEngine;
  view: HTMLElement;
  inspector: Inspector;
  nodes: NodeEditor;
  labelsEl: HTMLElement;
  private presetSel!: HTMLSelectElement;
  private tl!: HTMLElement;
  onClose: () => void = () => {};
  private applyingPreset = false;

  constructor(root: HTMLElement, e: OrbEngine) {
    this.root = root;
    this.e = e;
    root.innerHTML = `
      <header class="lab-bar">
        <button class="lab-back" data-act="close" title="Back to the page (Esc)"><span aria-hidden="true">←</span><span class="lab-num">01</span> The Orb</button>
        <div class="tb-group">
          <button class="tb-btn" data-act="play" title="Play / pause (Space)"></button>
          <button class="tb-btn" data-act="reset" title="Respawn every particle">Reset</button>
        </div>
        <label class="tb-field" title="Simulation speed"><span>Speed</span><input type="range" min="0.05" max="3" step="0.01" value="1" data-act="speed"><output>1.00×</output></label>
        <label class="tb-field"><span>Particles</span><select data-act="count"></select></label>
        <label class="tb-field"><span>Preset</span><select data-act="preset"></select></label>
        <div class="tb-group tb-pop-wrap">
          <button class="tb-btn" data-act="debug" aria-pressed="false">Debug</button>
          <div class="tb-pop" hidden></div>
        </div>
        <button class="tb-btn" data-act="timeline" aria-pressed="false" title="Keyframe timeline">◆ Timeline</button>
        <span class="tb-spacer"></span>
        <span class="tb-stats"></span>
      </header>
      <div class="lab-view"><div class="lab-labels"></div>
        <div class="lab-tl" hidden></div>
        <div class="lab-hint">Drag to orbit · Shift-drag to pan · Wheel to zoom · Select a node to get its handles</div>
      </div>
      <div class="lab-split" title="Drag to resize"></div>
      <nav class="lab-tabs"><button data-tab="inspector" class="on">Inspector</button><button data-tab="graph">Graph</button></nav>
      <aside class="lab-insp"></aside>
      <section class="lab-graph"></section>`;
    this.view = root.querySelector('.lab-view')!;
    this.labelsEl = root.querySelector('.lab-labels')!;
    this.inspector = new Inspector(root.querySelector('.lab-insp')!, e);
    this.nodes = new NodeEditor(root.querySelector('.lab-graph')!, e);
    this.tl = root.querySelector('.lab-tl')!;
    this.buildToolbar();
    this.buildDebug();
    this.buildTimeline();
    this.buildSplit();
    this.buildTabs();
    e.on('frame', () => this.drawLabels());
    e.on('stats', () => this.drawStats());
    e.on('timeline-open', () => this.setTimeline(true));
    window.addEventListener('keydown', (ev) => this.key(ev));
  }

  private q<T extends HTMLElement>(sel: string) { return this.root.querySelector(sel) as T; }

  private buildToolbar() {
    const e = this.e;
    const play = this.q<HTMLButtonElement>('[data-act="play"]');
    const syncPlay = () => { play.innerHTML = e.playing ? '❚❚ <span>Pause</span>' : '▶ <span>Play</span>'; play.setAttribute('aria-pressed', String(!e.playing)); };
    syncPlay();
    play.addEventListener('click', () => { e.playing = !e.playing; syncPlay(); });
    e.on('playing', syncPlay);
    this.q('[data-act="reset"]').addEventListener('click', () => e.reset());
    this.q('[data-act="close"]').addEventListener('click', () => this.onClose());

    const sp = this.q<HTMLInputElement>('[data-act="speed"]');
    const out = sp.nextElementSibling as HTMLOutputElement;
    sp.addEventListener('input', () => { e.speed = +sp.value; out.textContent = e.speed.toFixed(2) + '×'; });

    const cs = this.q<HTMLSelectElement>('[data-act="count"]');
    for (const c of COUNTS) { const o = el('option', '', c >= 1000 ? `${Math.round(c / 1024)}k` : String(c)); o.value = String(c); cs.appendChild(o); }
    cs.value = String(e.sim.count);
    cs.addEventListener('change', () => e.setCount(+cs.value));
    e.on('count', (n: number) => { cs.value = String(n); });

    const ps = this.q<HTMLSelectElement>('[data-act="preset"]');
    this.presetSel = ps;
    PRESETS.forEach((p, i) => { const o = el('option', '', p.name); o.value = String(i); ps.appendChild(o); });
    const custom = el('option', '', 'Custom'); custom.value = 'custom'; custom.disabled = true; ps.appendChild(custom);
    ps.addEventListener('change', () => {
      const p = PRESETS[+ps.value];
      if (!p) return;
      // swap the laws, keep the particles: the orb flows into its new state
      this.applyingPreset = true;
      e.setGraph(p.graph());
      e.select(null);
      this.applyingPreset = false;
      requestAnimationFrame(() => this.nodes.fit());
    });
    const markCustom = () => { if (!this.applyingPreset) ps.value = 'custom'; };
    e.on('param', (_n: unknown, src: string) => { if (src !== 'timeline') markCustom(); });
    e.on('graph', markCustom);
  }

  setPresetLabel(i: number | 'custom') { this.presetSel.value = String(i); }

  private buildDebug() {
    const e = this.e;
    const btn = this.q<HTMLButtonElement>('[data-act="debug"]');
    const pop = btn.nextElementSibling as HTMLElement;
    const layers: [keyof typeof e.debug, string][] = [
      ['velocity', 'Velocity vectors'], ['force', 'Force vectors'], ['trajectories', 'Particle trajectories'],
      ['axis', 'Vortex axis'], ['boundary', 'Sphere boundary'], ['flow', 'Flow field'], ['noise', 'Noise field'], ['radial', 'Radial field'],
    ];
    pop.innerHTML = `
      <label class="dbg-master"><input type="checkbox" data-k="on"> <b>Physics debug</b></label>
      <div class="dbg-list">${layers.map(([k, l]) => `<label><input type="checkbox" data-k="${k}"> ${l}</label>`).join('')}</div>
      <div class="dbg-sub">Particle colour</div>
      <div class="seg" data-k="color"><button data-v="0">Energy</button><button data-v="1">Velocity</button><button data-v="2">Acceleration</button></div>
      <label class="dbg-scale">Vector scale <input type="range" min="0.2" max="4" step="0.01" value="1" data-k="scale"></label>`;
    const sync = () => {
      btn.setAttribute('aria-pressed', String(e.debugOn));
      pop.querySelectorAll<HTMLInputElement>('input[type=checkbox]').forEach((c) => {
        c.checked = c.dataset.k === 'on' ? e.debugOn : !!(e.debug as any)[c.dataset.k!];
      });
      pop.querySelectorAll<HTMLButtonElement>('[data-k="color"] button').forEach((b) => b.classList.toggle('on', +b.dataset.v! === e.debug.colorMode));
      pop.classList.toggle('off', !e.debugOn);
    };
    btn.addEventListener('click', (ev) => {
      ev.stopPropagation();
      const open = pop.hidden;
      pop.hidden = !open;
      if (open && !e.debugOn) e.debugOn = true;
      sync();
    });
    pop.addEventListener('change', (ev) => {
      const t = ev.target as HTMLInputElement;
      if (t.dataset.k === 'on') e.debugOn = t.checked;
      else if (t.dataset.k === 'scale') e.debug.vectorScale = +t.value;
      else if (t.dataset.k) { (e.debug as any)[t.dataset.k] = t.checked; e.debugOn = true; }
      sync();
    });
    pop.addEventListener('input', (ev) => {
      const t = ev.target as HTMLInputElement;
      if (t.dataset.k === 'scale') e.debug.vectorScale = +t.value;
    });
    pop.addEventListener('click', (ev) => {
      const b = (ev.target as HTMLElement).closest('[data-k="color"] button') as HTMLButtonElement | null;
      if (b) { e.debug.colorMode = +b.dataset.v! as 0 | 1 | 2; e.debugOn = true; sync(); }
      ev.stopPropagation();
    });
    document.addEventListener('pointerdown', (ev) => {
      if (!pop.hidden && !(ev.target as HTMLElement).closest('.tb-pop-wrap')) pop.hidden = true;
    });
    sync();
  }

  private buildTimeline() {
    const e = this.e;
    const tl = this.tl;
    tl.innerHTML = `
      <button class="tb-btn sm" data-tl="play">▶</button>
      <div class="tl-track"><div class="tl-keys"></div><div class="tl-head"></div></div>
      <span class="tl-time">0.00 s</span>
      <label class="tl-len">loop <input type="number" min="1" max="60" step="0.5" value="8"> s</label>`;
    const track = tl.querySelector<HTMLElement>('.tl-track')!;
    const head = tl.querySelector<HTMLElement>('.tl-head')!;
    const time = tl.querySelector<HTMLElement>('.tl-time')!;
    const keys = tl.querySelector<HTMLElement>('.tl-keys')!;
    const pb = tl.querySelector<HTMLButtonElement>('[data-tl="play"]')!;
    const len = tl.querySelector<HTMLInputElement>('.tl-len input')!;
    const sync = () => {
      const t = e.timeline;
      head.style.left = (t.t / t.length) * 100 + '%';
      time.textContent = t.t.toFixed(2) + ' s';
      pb.textContent = t.playing ? '❚❚' : '▶';
      const n = e.node(e.selected);
      const ts = new Set<number>();
      if (n?.keys) for (const k in n.keys) n.keys[k].forEach((x) => ts.add(+x.t.toFixed(2)));
      keys.innerHTML = [...ts].map((x) => `<i style="left:${(x / t.length) * 100}%"></i>`).join('');
    };
    pb.addEventListener('click', () => { e.timeline.playing = !e.timeline.playing; sync(); });
    len.addEventListener('change', () => { e.timeline.length = Math.max(1, +len.value || 8); e.timeline.t %= e.timeline.length; sync(); });
    let scrubbing = false;
    const scrub = (ev: PointerEvent) => {
      const r = track.getBoundingClientRect();
      e.timeline.t = Math.max(0, Math.min(0.999, (ev.clientX - r.left) / r.width)) * e.timeline.length;
      (e as any).applyTimeline();
      e.emit('timeline');
    };
    track.addEventListener('pointerdown', (ev) => { scrubbing = true; try { track.setPointerCapture(ev.pointerId); } catch {} scrub(ev); });
    track.addEventListener('pointermove', (ev) => { if (scrubbing) scrub(ev); });
    track.addEventListener('pointerup', () => { scrubbing = false; });
    e.on('timeline', sync);
    e.on('keys', sync);
    e.on('select', sync);
    this.q('[data-act="timeline"]').addEventListener('click', () => this.setTimeline(tl.hidden));
    sync();
  }

  setTimeline(open: boolean) {
    this.tl.hidden = !open;
    this.q('[data-act="timeline"]').setAttribute('aria-pressed', String(open));
  }

  private buildSplit() {
    const split = this.q<HTMLElement>('.lab-split');
    let start = 0, h0 = 0;
    split.addEventListener('pointerdown', (ev) => {
      start = ev.clientY;
      h0 = this.q<HTMLElement>('.lab-graph').getBoundingClientRect().height;
      try { split.setPointerCapture(ev.pointerId); } catch {}
      split.classList.add('drag');
    });
    split.addEventListener('pointermove', (ev) => {
      if (!split.classList.contains('drag')) return;
      const h = Math.max(120, Math.min(window.innerHeight - 220, h0 - (ev.clientY - start)));
      this.root.style.setProperty('--graph-h', h + 'px');
    });
    split.addEventListener('pointerup', () => split.classList.remove('drag'));
  }

  private buildTabs() {
    this.root.querySelectorAll<HTMLButtonElement>('.lab-tabs button').forEach((b) => b.addEventListener('click', () => {
      this.root.dataset.tab = b.dataset.tab;
      this.root.querySelectorAll('.lab-tabs button').forEach((x) => x.classList.toggle('on', x === b));
      if (b.dataset.tab === 'graph') requestAnimationFrame(() => this.nodes.fit());
    }));
    this.root.dataset.tab = 'inspector';
  }

  private drawLabels() {
    if (this.e.mode !== 'lab') return;
    const html = this.e.labels.map((l) => {
      const p = this.e.cam.project(l.pos as any);
      return p.ok ? `<span style="transform:translate(${p.x.toFixed(1)}px,${p.y.toFixed(1)}px);color:${l.color}">${l.text}</span>` : '';
    }).join('');
    if (this.labelsEl.innerHTML !== html) this.labelsEl.innerHTML = html;
  }

  private drawStats() {
    const s = this.q<HTMLElement>('.tb-stats');
    const fps = this.e.fps;
    s.innerHTML = `<i class="${fps > 50 ? 'ok' : fps > 30 ? 'mid' : 'bad'}"></i>${fps.toFixed(0)} fps · ${this.e.frameMs.toFixed(1)} ms · ${(this.e.sim.count / 1000).toFixed(0)}k`;
  }

  private key(ev: KeyboardEvent) {
    if (this.e.mode !== 'lab') return;
    const tag = (ev.target as HTMLElement)?.tagName;
    const typing = tag === 'INPUT' && (ev.target as HTMLInputElement).type !== 'range' || tag === 'SELECT' || tag === 'TEXTAREA';
    if (ev.key === 'Escape') {
      const pop = this.root.querySelector<HTMLElement>('.tb-pop')!;
      const menu = this.root.querySelector<HTMLElement>('.ng-menu')!;
      if (!pop.hidden) pop.hidden = true;
      else if (!menu.hidden) this.nodes.closeMenu();
      else this.onClose();
      ev.preventDefault();
      return;
    }
    if (typing) return;
    if (ev.key === ' ') {
      this.e.playing = !this.e.playing;
      this.e.emit('playing');
      ev.preventDefault();
      return;
    }
    if (this.nodes.key(ev)) ev.preventDefault();
  }

  layout() { this.nodes.fit(); }
}
