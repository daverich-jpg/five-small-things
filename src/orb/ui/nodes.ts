import { OrbEngine } from '../engine';
import { DEFS, MENU, PORT_COLORS, CAT_COLORS, GNode, Wire, PortType, makeNode, newId, outType, compatible, createsCycle } from '../graph';
import { el, fmt, unit } from './format';

interface PortRef { node: string; port: string; dir: 'in' | 'out' }

export class NodeEditor {
  root: HTMLElement;
  e: OrbEngine;
  vp: HTMLElement;
  world: HTMLElement;
  svg: SVGSVGElement;
  menu: HTMLElement;
  zoom = 0.82;
  panX = 20;
  panY = 16;
  selWire: string | null = null;
  portPos = new Map<string, { x: number; y: number }>();
  nodeEls = new Map<string, HTMLElement>();
  temp: { from: PortRef; x: number; y: number } | null = null;
  pendingConnect: PortRef | null = null;
  menuAt = { x: 0, y: 0 };
  private wireHover: string | null = null;

  constructor(host: HTMLElement, e: OrbEngine) {
    this.root = host;
    this.e = e;
    host.innerHTML = `
      <div class="ng-bar">
        <span class="ng-title">Physics graph</span>
        <button class="btn-ghost sm" data-act="add">+ Node</button>
        <button class="btn-ghost sm" data-act="fit">Fit</button>
        <span class="ng-legend">${(['volume', 'flow', 'force', 'props', 'particles'] as PortType[]).map((t) => `<span><i style="background:${PORT_COLORS[t]}"></i>${t}</span>`).join('')}</span>
        <span class="ng-warn"></span>
      </div>
      <div class="ng-vp"><div class="ng-world"><svg class="ng-wires" width="1" height="1"></svg></div><div class="ng-menu" hidden></div></div>`;
    this.vp = host.querySelector('.ng-vp')!;
    this.world = host.querySelector('.ng-world')!;
    this.svg = host.querySelector('.ng-wires')!;
    this.menu = host.querySelector('.ng-menu')!;
    host.querySelector('[data-act="add"]')!.addEventListener('click', (ev) => {
      const r = this.vp.getBoundingClientRect();
      this.openMenu(r.width / 2 - 110, 10, null);
      ev.stopPropagation();
    });
    host.querySelector('[data-act="fit"]')!.addEventListener('click', () => this.fit());
    e.on('graph', () => this.render());
    e.on('select', () => this.syncSelection());
    e.on('param', (n: GNode) => this.updateSummary(n));
    this.bind();
    this.render();
  }

  // ── rendering ──────────────────────────────────────────
  render() {
    const g = this.e.graph;
    const c = this.e.compiled;
    this.world.querySelectorAll('.node').forEach((n) => n.remove());
    this.nodeEls.clear();
    for (const n of g.nodes) {
      const def = DEFS[n.kind];
      const d = el('div', `node cat-${def.cat.toLowerCase()}`);
      d.dataset.id = n.id;
      d.classList.toggle('inactive', !c.active.has(n.id));
      d.classList.toggle('bypass', !!n.bypass);
      d.style.left = n.x + 'px';
      d.style.top = n.y + 'px';
      const ins = def.inputs.map((p) => `<div class="pin" data-port="${p.key}" data-dir="in"><span class="pdot" style="--pc:${PORT_COLORS[p.type]}"></span>${p.label}${p.multi ? '<em>+</em>' : ''}</div>`).join('');
      const outs = def.outputs.map((p) => {
        const t = p.type === 'field' ? outType(g, n.id) : p.type;
        return `<div class="pout" data-port="${p.key}" data-dir="out">${t === 'field' ? p.label : t}<span class="pdot" style="--pc:${PORT_COLORS[t]}"></span></div>`;
      }).join('');
      d.innerHTML = `
        <div class="nh"><span class="ncat" style="background:${CAT_COLORS[def.cat]}"></span><span class="ntitle">${def.title}</span>
          <button class="nbyp" title="Bypass (B)">${n.bypass ? '○' : '●'}</button></div>
        <div class="nports"><div class="ncol">${ins}</div><div class="ncol r">${outs}</div></div>
        <div class="nsum"></div>`;
      this.world.appendChild(d);
      this.nodeEls.set(n.id, d);
      this.updateSummary(n);
    }
    this.measurePorts();
    this.syncSelection();
    this.drawWires();
    this.applyTransform();
    const warn = this.root.querySelector('.ng-warn')!;
    warn.textContent = this.e.compileError ? 'Shader error — see console' : c.warnings[0] || '';
    warn.classList.toggle('on', !!(this.e.compileError || c.warnings.length));
  }

  updateSummary(n: GNode) {
    const d = this.nodeEls.get(n.id);
    if (!d) return;
    const def = DEFS[n.kind];
    const s = d.querySelector('.nsum')!;
    const show = def.params.filter((p) => !p.group || p.group === 'Populations').slice(0, 2);
    s.innerHTML = show.map((p) => `<span>${p.label}</span><b>${fmt(p, n.params[p.key])}${p.type === 'enum' ? '' : unit(p)}</b>`).join('');
    d.classList.toggle('animated', !!(n.keys && Object.keys(n.keys).length));
  }

  private measurePorts() {
    this.portPos.clear();
    for (const [id, d] of this.nodeEls) {
      d.querySelectorAll<HTMLElement>('.pin, .pout').forEach((p) => {
        const dot = p.querySelector<HTMLElement>('.pdot')!;
        // offsets relative to node origin (layout units, unaffected by zoom)
        let x = dot.offsetLeft + dot.offsetWidth / 2, y = dot.offsetTop + dot.offsetHeight / 2;
        let o: HTMLElement | null = dot.offsetParent as HTMLElement;
        while (o && o !== d) { x += o.offsetLeft; y += o.offsetTop; o = o.offsetParent as HTMLElement; }
        this.portPos.set(`${id}:${p.dataset.dir}:${p.dataset.port}`, { x, y });
      });
    }
  }

  private portXY(node: string, dir: 'in' | 'out', port: string) {
    const n = this.e.node(node);
    const o = this.portPos.get(`${node}:${dir}:${port}`);
    if (!n || !o) return null;
    return { x: n.x + o.x, y: n.y + o.y };
  }

  private path(a: { x: number; y: number }, b: { x: number; y: number }) {
    const dx = Math.max(40, Math.abs(b.x - a.x) * 0.5);
    return `M${a.x},${a.y} C${a.x + dx},${a.y} ${b.x - dx},${b.y} ${b.x},${b.y}`;
  }

  drawWires() {
    const g = this.e.graph;
    const c = this.e.compiled;
    let html = '';
    for (const w of g.wires) {
      const a = this.portXY(w.from.node, 'out', w.from.port);
      const b = this.portXY(w.to.node, 'in', w.to.port);
      if (!a || !b) continue;
      const t = outType(g, w.from.node);
      const col = PORT_COLORS[t];
      const bad = c.invalidWires.has(w.id);
      const live = c.active.has(w.to.node) && c.active.has(w.from.node) && !bad;
      const d = this.path(a, b);
      const sel = this.selWire === w.id;
      html += `<path class="wire-hit" data-wire="${w.id}" d="${d}"/>`;
      html += `<path class="wire${bad ? ' bad' : ''}${live ? ' live' : ''}${sel ? ' sel' : ''}${this.wireHover === w.id ? ' hov' : ''}" d="${d}" stroke="${bad ? '#ff6b6b' : col}"/>`;
      if (sel) {
        const mx = (a.x + b.x) / 2, my = (a.y + b.y) / 2;
        html += `<g class="wire-x" data-wire-del="${w.id}" transform="translate(${mx},${my})"><circle r="9"/><path d="M-3.5,-3.5 L3.5,3.5 M3.5,-3.5 L-3.5,3.5"/></g>`;
      }
    }
    if (this.temp) {
      const a = this.temp.from.dir === 'out' ? this.portXY(this.temp.from.node, 'out', this.temp.from.port)! : { x: this.temp.x, y: this.temp.y };
      const b = this.temp.from.dir === 'out' ? { x: this.temp.x, y: this.temp.y } : this.portXY(this.temp.from.node, 'in', this.temp.from.port)!;
      html += `<path class="wire temp" d="${this.path(a, b)}"/>`;
    }
    this.svg.innerHTML = html;
  }

  private applyTransform() {
    this.world.style.transform = `translate(${this.panX}px, ${this.panY}px) scale(${this.zoom})`;
    this.vp.style.backgroundPosition = `${this.panX}px ${this.panY}px`;
    this.vp.style.backgroundSize = `${22 * this.zoom}px ${22 * this.zoom}px`;
  }

  syncSelection() {
    for (const [id, d] of this.nodeEls) d.classList.toggle('selected', id === this.e.selected);
  }

  fit() {
    const g = this.e.graph;
    if (!g.nodes.length) return;
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (const n of g.nodes) {
      const d = this.nodeEls.get(n.id);
      x0 = Math.min(x0, n.x); y0 = Math.min(y0, n.y);
      x1 = Math.max(x1, n.x + (d?.offsetWidth || 180)); y1 = Math.max(y1, n.y + (d?.offsetHeight || 100));
    }
    const r = this.vp.getBoundingClientRect();
    const pad = 24;
    this.zoom = Math.min(1.1, Math.max(0.3, Math.min((r.width - pad * 2) / (x1 - x0), (r.height - pad * 2) / (y1 - y0))));
    this.panX = (r.width - (x1 - x0) * this.zoom) / 2 - x0 * this.zoom;
    this.panY = (r.height - (y1 - y0) * this.zoom) / 2 - y0 * this.zoom;
    this.applyTransform();
  }

  // ── structure edits ───────────────────────────────────
  connect(a: PortRef, b: PortRef): boolean {
    const out = a.dir === 'out' ? a : b;
    const inp = a.dir === 'out' ? b : a;
    if (out.dir !== 'out' || inp.dir !== 'in' || out.node === inp.node) return false;
    const g = this.e.graph;
    const tn = g.nodes.find((n) => n.id === inp.node)!;
    const pdef = DEFS[tn.kind].inputs.find((p) => p.key === inp.port)!;
    if (!compatible(outType(g, out.node), pdef.type)) return false;
    if (createsCycle(g, out.node, inp.node)) return false;
    if (g.wires.some((w) => w.from.node === out.node && w.to.node === inp.node && w.to.port === inp.port)) return false;
    if (!pdef.multi) g.wires = g.wires.filter((w) => !(w.to.node === inp.node && w.to.port === inp.port));
    g.wires.push({ id: 'w' + Math.random().toString(36).slice(2, 8), from: { node: out.node, port: out.port }, to: { node: inp.node, port: inp.port } });
    this.e.recompile();
    return true;
  }

  removeWire(id: string) {
    this.e.graph.wires = this.e.graph.wires.filter((w) => w.id !== id);
    if (this.selWire === id) this.selWire = null;
    this.e.recompile();
  }

  removeNode(id: string) {
    const g = this.e.graph;
    g.nodes = g.nodes.filter((n) => n.id !== id);
    g.wires = g.wires.filter((w) => w.from.node !== id && w.to.node !== id);
    if (this.e.selected === id) this.e.select(null);
    this.e.recompile();
  }

  addNode(kind: string, x: number, y: number) {
    const g = this.e.graph;
    const n = makeNode(kind, newId(g), Math.round(x), Math.round(y));
    g.nodes.push(n);
    this.e.recompile();
    if (this.pendingConnect) {
      const def = DEFS[kind];
      const pc = this.pendingConnect;
      if (pc.dir === 'out') {
        const t = outType(g, pc.node);
        const p = def.inputs.find((i) => compatible(t, i.type));
        if (p) this.connect(pc, { node: n.id, port: p.key, dir: 'in' });
      } else {
        const tn = g.nodes.find((x) => x.id === pc.node)!;
        const want = DEFS[tn.kind].inputs.find((i) => i.key === pc.port)!.type;
        const p = def.outputs.find((o) => compatible(o.type, want));
        if (p) this.connect({ node: n.id, port: p.key, dir: 'out' }, pc);
      }
      this.pendingConnect = null;
    }
    this.e.select(n.id);
  }

  toggleBypass(id: string) {
    const n = this.e.node(id);
    if (!n) return;
    n.bypass = !n.bypass;
    this.e.recompile();
  }

  // ── add-node menu ─────────────────────────────────────
  openMenu(x: number, y: number, pending: PortRef | null) {
    this.pendingConnect = pending;
    this.menuAt = { x: (x - this.panX) / this.zoom, y: (y - this.panY) / this.zoom };
    const g = this.e.graph;
    let filter: ((k: string) => boolean) | null = null;
    if (pending) {
      if (pending.dir === 'out') {
        const t = outType(g, pending.node);
        filter = (k) => DEFS[k].inputs.some((i) => compatible(t, i.type));
      } else {
        const tn = g.nodes.find((n) => n.id === pending.node)!;
        const want = DEFS[tn.kind].inputs.find((i) => i.key === pending.port)!.type;
        filter = (k) => DEFS[k].outputs.some((o) => compatible(o.type, want));
      }
    }
    const groups = MENU.map(({ cat, kinds }) => ({ cat, kinds: filter ? kinds.filter(filter) : kinds })).filter((gr) => gr.kinds.length);
    this.menu.innerHTML = `<input class="ng-search" placeholder="Search nodes…" />` + groups.map((gr) => `
      <div class="mgrp"><div class="mcat"><i style="background:${CAT_COLORS[gr.cat]}"></i>${gr.cat}</div>
      ${gr.kinds.map((k) => `<button data-kind="${k}" title="${DEFS[k].blurb.replace(/"/g, '&quot;')}">${DEFS[k].title}</button>`).join('')}</div>`).join('');
    const vr = this.vp.getBoundingClientRect();
    this.menu.style.left = Math.max(6, Math.min(x, vr.width - 236)) + 'px';
    this.menu.style.top = Math.max(6, Math.min(y, vr.height - 60)) + 'px';
    this.menu.hidden = false;
    const search = this.menu.querySelector<HTMLInputElement>('.ng-search')!;
    search.focus();
    search.addEventListener('input', () => {
      const q = search.value.toLowerCase();
      this.menu.querySelectorAll<HTMLButtonElement>('button[data-kind]').forEach((b) => { b.hidden = !b.textContent!.toLowerCase().includes(q); });
    });
    search.addEventListener('keydown', (ev) => {
      if (ev.key === 'Enter') {
        const b = [...this.menu.querySelectorAll<HTMLButtonElement>('button[data-kind]')].find((x) => !x.hidden);
        b?.click();
      }
      if (ev.key === 'Escape') { ev.stopPropagation(); this.closeMenu(); }
    });
  }
  closeMenu() { this.menu.hidden = true; this.pendingConnect = null; }

  // ── interaction ───────────────────────────────────────
  private toWorld(cx: number, cy: number) {
    const r = this.vp.getBoundingClientRect();
    return { x: (cx - r.left - this.panX) / this.zoom, y: (cy - r.top - this.panY) / this.zoom };
  }

  private portFrom(t: EventTarget | null): PortRef | null {
    const p = (t as HTMLElement)?.closest?.('.pin, .pout') as HTMLElement | null;
    if (!p) return null;
    const nd = p.closest('.node') as HTMLElement;
    return { node: nd.dataset.id!, port: p.dataset.port!, dir: p.dataset.dir as 'in' | 'out' };
  }

  private markTargets(from: PortRef | null) {
    const g = this.e.graph;
    this.world.querySelectorAll<HTMLElement>('.pin, .pout').forEach((p) => {
      p.classList.remove('ok', 'no');
      if (!from) return;
      const nd = (p.closest('.node') as HTMLElement).dataset.id!;
      const dir = p.dataset.dir;
      if (dir === from.dir || nd === from.node) { p.classList.add('no'); return; }
      let ok: boolean;
      if (from.dir === 'out') {
        const tn = g.nodes.find((n) => n.id === nd)!;
        const it = DEFS[tn.kind].inputs.find((i) => i.key === p.dataset.port)!.type;
        ok = compatible(outType(g, from.node), it) && !createsCycle(g, from.node, nd);
      } else {
        const tn = g.nodes.find((n) => n.id === from.node)!;
        const it = DEFS[tn.kind].inputs.find((i) => i.key === from.port)!.type;
        ok = compatible(outType(g, nd), it) && !createsCycle(g, nd, from.node);
      }
      p.classList.add(ok ? 'ok' : 'no');
    });
  }

  private bind() {
    const vp = this.vp;
    let drag: { kind: 'node' | 'pan' | 'wire'; id?: string; sx: number; sy: number; ox: number; oy: number; moved: boolean } | null = null;

    vp.addEventListener('pointerdown', (ev) => {
      if (ev.button === 2) return;
      const target = ev.target as HTMLElement;
      if (target.closest('.ng-menu')) return;
      this.closeMenu();
      const del = target.closest('[data-wire-del]') as HTMLElement | null;
      if (del) { this.removeWire(del.getAttribute('data-wire-del')!); return; }
      if (target.closest('.nbyp')) {
        const id = (target.closest('.node') as HTMLElement).dataset.id!;
        this.toggleBypass(id);
        return;
      }
      const port = this.portFrom(target);
      if (port) {
        ev.preventDefault();
        let from = port;
        if (port.dir === 'in') {
          // grabbing a connected input picks the wire up from its source
          const w = this.e.graph.wires.filter((x) => x.to.node === port.node && x.to.port === port.port).pop();
          if (w) {
            this.e.graph.wires = this.e.graph.wires.filter((x) => x.id !== w.id);
            from = { node: w.from.node, port: w.from.port, dir: 'out' };
            this.e.recompile();
          }
        }
        const p = this.toWorld(ev.clientX, ev.clientY);
        this.temp = { from, x: p.x, y: p.y };
        drag = { kind: 'wire', sx: ev.clientX, sy: ev.clientY, ox: 0, oy: 0, moved: false };
        this.markTargets(from);
        try { vp.setPointerCapture(ev.pointerId); } catch {}
        this.drawWires();
        return;
      }
      const wireHit = target.closest('[data-wire]') as SVGElement | null;
      if (wireHit) {
        this.selWire = wireHit.getAttribute('data-wire');
        this.e.select(null);
        this.drawWires();
        return;
      }
      const nodeEl = target.closest('.node') as HTMLElement | null;
      if (nodeEl) {
        const n = this.e.node(nodeEl.dataset.id!)!;
        this.e.select(n.id);
        if (this.selWire) { this.selWire = null; this.drawWires(); }
        drag = { kind: 'node', id: n.id, sx: ev.clientX, sy: ev.clientY, ox: n.x, oy: n.y, moved: false };
        try { vp.setPointerCapture(ev.pointerId); } catch {}
        return;
      }
      drag = { kind: 'pan', sx: ev.clientX, sy: ev.clientY, ox: this.panX, oy: this.panY, moved: false };
      try { vp.setPointerCapture(ev.pointerId); } catch {}
    });

    vp.addEventListener('pointermove', (ev) => {
      if (!drag) {
        const w = (ev.target as Element).closest?.('[data-wire]')?.getAttribute('data-wire') || null;
        if (w !== this.wireHover) { this.wireHover = w; this.drawWires(); }
        return;
      }
      const dx = ev.clientX - drag.sx, dy = ev.clientY - drag.sy;
      if (Math.abs(dx) + Math.abs(dy) > 3) drag.moved = true;
      if (drag.kind === 'pan') {
        this.panX = drag.ox + dx; this.panY = drag.oy + dy;
        this.applyTransform();
      } else if (drag.kind === 'node') {
        const n = this.e.node(drag.id!)!;
        n.x = Math.round(drag.ox + dx / this.zoom);
        n.y = Math.round(drag.oy + dy / this.zoom);
        const d = this.nodeEls.get(n.id)!;
        d.style.left = n.x + 'px'; d.style.top = n.y + 'px';
        this.drawWires();
      } else if (drag.kind === 'wire' && this.temp) {
        const p = this.toWorld(ev.clientX, ev.clientY);
        this.temp.x = p.x; this.temp.y = p.y;
        this.drawWires();
      }
    });

    const end = (ev: PointerEvent) => {
      if (!drag) return;
      if (drag.kind === 'wire' && this.temp) {
        const from = this.temp.from;
        this.temp = null;
        this.markTargets(null);
        const hit = this.portFrom(document.elementFromPoint(ev.clientX, ev.clientY));
        if (hit) this.connect(from, hit);
        else if (drag.moved) {
          const r = vp.getBoundingClientRect();
          this.openMenu(ev.clientX - r.left, ev.clientY - r.top, from);
        }
        this.drawWires();
      } else if (drag.kind === 'pan' && !drag.moved) {
        this.e.select(null);
        if (this.selWire) { this.selWire = null; this.drawWires(); }
      }
      drag = null;
    };
    vp.addEventListener('pointerup', end);
    vp.addEventListener('pointercancel', end);

    vp.addEventListener('wheel', (ev) => {
      if ((ev.target as HTMLElement).closest('.ng-menu')) return;
      ev.preventDefault();
      const r = vp.getBoundingClientRect();
      const mx = ev.clientX - r.left, my = ev.clientY - r.top;
      // pinch (ctrl) or a notched mouse wheel zooms; two-finger trackpad scroll pans
      if (ev.ctrlKey || ev.deltaMode === 1 || (ev.deltaX === 0 && Math.abs(ev.deltaY) >= 50)) {
        const z = Math.min(1.8, Math.max(0.3, this.zoom * Math.exp(-ev.deltaY * (ev.ctrlKey ? 0.01 : 0.0015))));
        this.panX = mx - ((mx - this.panX) * z) / this.zoom;
        this.panY = my - ((my - this.panY) * z) / this.zoom;
        this.zoom = z;
      } else {
        this.panX -= ev.deltaX; this.panY -= ev.deltaY;
      }
      this.applyTransform();
    }, { passive: false });

    vp.addEventListener('contextmenu', (ev) => {
      ev.preventDefault();
      const r = vp.getBoundingClientRect();
      this.openMenu(ev.clientX - r.left, ev.clientY - r.top, null);
    });

    vp.addEventListener('dblclick', (ev) => {
      const t = ev.target as HTMLElement;
      const w = t.closest('[data-wire]');
      if (w) this.removeWire(w.getAttribute('data-wire')!);
    });

    this.menu.addEventListener('click', (ev) => {
      const b = (ev.target as HTMLElement).closest('button[data-kind]') as HTMLButtonElement | null;
      if (!b) return;
      const pc = this.pendingConnect;
      this.menu.hidden = true;
      this.pendingConnect = pc;
      this.addNode(b.dataset.kind!, this.menuAt.x, this.menuAt.y);
    });
  }

  /** Keyboard shortcuts while the lab is open (called by the lab shell). */
  key(ev: KeyboardEvent): boolean {
    const tag = (ev.target as HTMLElement)?.tagName;
    if (tag === 'INPUT' || tag === 'SELECT' || tag === 'TEXTAREA') return false;
    if (ev.key === 'Delete' || ev.key === 'Backspace') {
      if (this.selWire) { this.removeWire(this.selWire); return true; }
      if (this.e.selected) { this.removeNode(this.e.selected); return true; }
    }
    if (ev.key === 'Tab') {
      const r = this.vp.getBoundingClientRect();
      this.openMenu(r.width / 2 - 110, 20, null);
      return true;
    }
    if ((ev.key === 'b' || ev.key === 'B') && this.e.selected) { this.toggleBypass(this.e.selected); return true; }
    if ((ev.key === 'd' || ev.key === 'D') && (ev.metaKey || ev.ctrlKey) && this.e.selected) {
      const n = this.e.node(this.e.selected)!;
      const g = this.e.graph;
      const copy: GNode = { ...JSON.parse(JSON.stringify(n)), id: newId(g), x: n.x + 30, y: n.y + 30 };
      g.nodes.push(copy);
      this.e.recompile();
      this.e.select(copy.id);
      return true;
    }
    return false;
  }
}

export type { Wire };
