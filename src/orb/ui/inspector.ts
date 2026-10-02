import { OrbEngine } from '../engine';
import { DEFS, GNode, ParamDef, CAT_COLORS, dragTaus } from '../graph';
import { el, fmt, unit, toDisplay, fromDisplay, decimals } from './format';

interface Row { pd: ParamDef; range?: HTMLInputElement; num?: HTMLInputElement; seg?: HTMLElement; select?: HTMLSelectElement; kf?: HTMLButtonElement; reset: HTMLButtonElement; root: HTMLElement }

export class Inspector {
  el: HTMLElement;
  e: OrbEngine;
  rows: Row[] = [];
  node: GNode | null = null;
  private statsEl: HTMLElement | null = null;

  constructor(host: HTMLElement, e: OrbEngine) {
    this.el = host;
    this.e = e;
    e.on('select', () => this.render());
    e.on('graph', () => {
      if (!this.node || !e.node(this.node.id)) this.render();
      else this.renderHeaderState();
    });
    e.on('param', (n: GNode, src: string) => { if (this.node && n.id === this.node.id && src !== 'ui') this.sync(); });
    e.on('timeline', () => this.syncKeys());
    e.on('keys', () => this.syncKeys());
    e.on('stats', () => this.renderStats());
    this.render();
  }

  render() {
    const n = this.e.node(this.e.selected) || null;
    this.node = n;
    this.rows = [];
    this.el.innerHTML = '';
    this.statsEl = null;
    if (!n) return this.renderOverview();
    const def = DEFS[n.kind];

    const head = el('div', 'insp-head');
    head.innerHTML = `
      <div class="insp-cat"><span class="dot" style="background:${CAT_COLORS[def.cat]}"></span>${def.cat}</div>
      <h3>${def.title}</h3>
      <p class="insp-blurb">${def.blurb}</p>
      ${def.formula ? `<code class="insp-formula">${def.formula}</code>` : ''}
      <div class="insp-state"></div>`;
    this.el.appendChild(head);
    this.renderHeaderState();

    if (n.kind === 'drag' || n.kind === 'system' || n.kind === 'props') {
      const tau = el('div', 'insp-tau');
      this.el.appendChild(tau);
      this.statsEl = tau;
      this.renderStats();
    }

    let group = '';
    let groupEl: HTMLElement = this.el;
    for (const pd of def.params) {
      if ((pd.group || '') !== group) {
        group = pd.group || '';
        if (group) {
          groupEl = el('fieldset', 'insp-group');
          const lg = el('legend', '', group);
          groupEl.appendChild(lg);
          if (pd.axis) {
            const quick = el('span', 'axis-quick');
            const presets: [string, number, number][] = n.kind === 'gravity'
              ? [['−Y', 0, -90], ['+Y', 0, 90], ['−X', 180, 0], ['+Z', 90, 0]]
              : [['X', 0, 0], ['Y', 0, 90], ['Z', 90, 0]];
            for (const [label, az, elv] of presets) {
              const b = el('button', 'chip', label);
              b.addEventListener('click', () => { this.e.setParams(n, { az, el: elv }, 'ui'); this.sync(); });
              quick.appendChild(b);
            }
            lg.appendChild(quick);
          }
          this.el.appendChild(groupEl);
        } else groupEl = this.el;
      }
      groupEl.appendChild(this.row(n, pd));
    }

    const foot = el('div', 'insp-foot');
    const resetAll = el('button', 'btn-ghost', 'Reset node');
    resetAll.addEventListener('click', () => {
      const vals: Record<string, number> = {};
      for (const pd of def.params) vals[pd.key] = pd.def;
      this.e.setParams(n, vals, 'ui');
      this.sync();
    });
    foot.appendChild(resetAll);
    if (n.keys && Object.keys(n.keys).length) {
      const clr = el('button', 'btn-ghost', 'Clear keyframes');
      clr.addEventListener('click', () => { n.keys = {}; this.e.emit('keys', n); this.render(); });
      foot.appendChild(clr);
    }
    this.el.appendChild(foot);
    this.sync();
  }

  private renderHeaderState() {
    const st = this.el.querySelector('.insp-state');
    if (!st || !this.node) return;
    const n = this.node;
    const active = this.e.compiled.active.has(n.id);
    st.innerHTML = n.bypass
      ? '<span class="pill warn">Bypassed</span>'
      : active ? '<span class="pill ok">Live in the simulation</span>' : '<span class="pill">Not connected — wire it into the Particle System to take effect</span>';
  }

  private row(n: GNode, pd: ParamDef): HTMLElement {
    const root = el('div', 'prow');
    const top = el('div', 'prow-top');
    const label = el('label', 'prow-label', pd.label);
    top.appendChild(label);
    const r: Row = { pd, root, reset: el('button', 'icon-btn reset', '↺') };
    r.reset.title = `Reset to ${fmt(pd, pd.def)}${unit(pd)}`;
    r.reset.addEventListener('click', () => { this.e.setParams(n, { [pd.key]: pd.def }, 'ui'); this.sync(); });

    if (pd.type === 'enum') {
      const opts = pd.options!;
      if (opts.length <= 2) {
        const seg = el('div', 'seg');
        opts.forEach((o, i) => {
          const b = el('button', '', o);
          b.addEventListener('click', () => { this.e.setParams(n, { [pd.key]: i }, 'ui'); this.sync(); });
          seg.appendChild(b);
        });
        r.seg = seg;
        root.append(top, seg);
      } else {
        const s = el('select', 'sel');
        opts.forEach((o, i) => { const op = el('option', '', o); op.value = String(i); s.appendChild(op); });
        s.addEventListener('change', () => this.e.setParams(n, { [pd.key]: +s.value }, 'ui'));
        r.select = s;
        root.append(top, s);
      }
      top.appendChild(r.reset);
    } else {
      const kf = el('button', 'icon-btn kf', '◆');
      kf.title = 'Keyframe at playhead (opens the timeline)';
      kf.addEventListener('click', () => {
        this.e.toggleKey(n, pd.key);
        this.e.emit('timeline-open');
        this.syncKeys();
      });
      r.kf = kf;
      const num = el('input', 'pnum') as HTMLInputElement;
      num.type = 'number';
      const dstep = pd.fmt === 'pct' ? pd.step * 100 : pd.step;
      num.step = String(dstep);
      num.min = String(toDisplay(pd, pd.min));
      num.max = String(toDisplay(pd, pd.max));
      num.addEventListener('change', () => {
        const v = fromDisplay(pd, parseFloat(num.value));
        if (!isNaN(v)) this.e.setParams(n, { [pd.key]: v }, 'ui');
        this.sync();
      });
      // drag the number left/right to scrub, like a 3D tool
      let sx = 0, sv = 0, scrub = false;
      num.addEventListener('pointerdown', (ev) => { sx = ev.clientX; sv = n.params[pd.key]; scrub = false; });
      num.addEventListener('pointermove', (ev) => {
        if (!(ev.buttons & 1)) return;
        const dx = ev.clientX - sx;
        if (!scrub && Math.abs(dx) > 4) { scrub = true; try { num.setPointerCapture(ev.pointerId); } catch {} num.blur(); }
        if (scrub) {
          const v = sv + (dx / 220) * (pd.max - pd.min) * (ev.shiftKey ? 0.1 : 1);
          this.e.setParams(n, { [pd.key]: pd.type === 'int' ? Math.round(v) : v }, 'ui');
          this.sync();
        }
      });
      const u = el('span', 'punit', unit(pd));
      top.append(num, u, r.reset, kf);
      const range = el('input', 'prange') as HTMLInputElement;
      range.type = 'range';
      range.min = String(pd.min);
      range.max = String(pd.max);
      range.step = String(pd.step);
      range.addEventListener('input', () => {
        this.e.setParams(n, { [pd.key]: +range.value }, 'ui');
        this.syncRow(r, n);
      });
      r.range = range;
      r.num = num;
      root.append(top, range);
    }
    this.rows.push(r);
    return root;
  }

  private syncRow(r: Row, n: GNode) {
    const v = n.params[r.pd.key];
    const pd = r.pd;
    if (r.range && document.activeElement !== r.range) r.range.value = String(v);
    if (r.range) r.range.style.setProperty('--fill', `${((v - pd.min) / (pd.max - pd.min)) * 100}%`);
    if (r.num && document.activeElement !== r.num) r.num.value = toDisplay(pd, v).toFixed(pd.fmt === 'pct' ? decimals(pd.step * 100) : decimals(pd.step));
    if (r.seg) [...r.seg.children].forEach((b, i) => b.classList.toggle('on', Math.round(v) === i));
    if (r.select && document.activeElement !== r.select) r.select.value = String(Math.round(v));
    r.reset.classList.toggle('dirty', Math.abs(v - pd.def) > pd.step * 0.5);
  }

  sync() {
    if (!this.node) return;
    for (const r of this.rows) this.syncRow(r, this.node);
    this.syncKeys();
    if (this.statsEl) this.renderStats();
  }

  syncKeys() {
    if (!this.node) return;
    const n = this.node;
    for (const r of this.rows) {
      if (!r.kf) continue;
      const has = !!n.keys?.[r.pd.key]?.length;
      r.kf.classList.toggle('has', has);
      r.kf.classList.toggle('on', this.e.hasKeyAt(n, r.pd.key));
      r.root.classList.toggle('animated', has);
    }
    if (this.e.timeline.playing) for (const r of this.rows) if (n.keys?.[r.pd.key]?.length) this.syncRow(r, n);
  }

  private renderStats() {
    if (this.statsEl) {
      const t = dragTaus(this.e.graph, this.e.compiled);
      this.statsEl.innerHTML = t
        ? `<div class="tau-title">Response time τ = m / k</div>
           <div class="tau-grid"><span>core</span><b>${fmtS(t.core)}</b><span>vortex</span><b>${fmtS(t.vortex)}</b><span>dust</span><b>${fmtS(t.dust)}</b></div>
           <div class="tau-note">Time to cover 63% of a change in the flow. 95% takes 3τ.</div>`
        : '<div class="tau-note">No live Drag node, so particles don’t feel the flow at all.</div>';
    }
    const ov = this.el.querySelector('.ov-stats');
    if (ov) {
      ov.innerHTML = `
        <div><span>Particles</span><b>${this.e.sim.count.toLocaleString()}</b></div>
        <div><span>Frame</span><b>${this.e.frameMs.toFixed(1)} ms</b></div>
        <div><span>Steps / frame</span><b>${this.e.stepsLastFrame} × 1/120 s</b></div>
        <div><span>Sim time</span><b>${this.e.simTime.toFixed(1)} s</b></div>`;
    }
  }

  private renderOverview() {
    const c = this.e.compiled;
    const box = el('div', 'insp-overview');
    box.innerHTML = `
      <div class="insp-cat"><span class="dot" style="background:#5cc8ff"></span>Simulation</div>
      <h3>Nothing selected</h3>
      <p class="insp-blurb">Click a node in the graph to edit it. Every value is live — drag one from end to end and watch the fluid answer.</p>
      <div class="ov-stats"></div>
      ${c.warnings.length ? `<ul class="ov-warn">${c.warnings.map((w) => `<li>${w}</li>`).join('')}</ul>` : '<p class="ov-ok">Graph is valid. Every connected node is in the shader.</p>'}
      <div class="ov-keys">
        <div><kbd>Drag</kbd> orbit</div><div><kbd>Shift</kbd>+drag / right-drag pan</div><div><kbd>Wheel</kbd> zoom</div>
        <div><kbd>Space</kbd> play / pause</div><div><kbd>Tab</kbd> add node</div><div><kbd>Del</kbd> remove node or wire</div>
        <div><kbd>Drag</kbd> a number to scrub it</div><div><kbd>Esc</kbd> back to the page</div>
      </div>`;
    this.el.appendChild(box);
    this.renderStats();
  }
}

const fmtS = (s: number) => (isFinite(s) ? `${s.toFixed(2)} s` : '∞');
