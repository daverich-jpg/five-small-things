import { GL, UVal } from './gl';
import { Sim, SIM_DT } from './sim';
import { Renderer, Overlay, DebugFlags } from './render';
import { OrbitCamera } from './camera';
import { Graph, GNode, Compiled, compile, frameUniforms, DEFS } from './graph';
import { buildGizmos, Handle, Label, nodeAutoDebug } from './gizmos';
import { V3 } from './math';

type Fn = (...a: any[]) => void;

export interface Timeline { playing: boolean; t: number; length: number }

const ease = (x: number) => x * x * (3 - 2 * x);

export class OrbEngine {
  canvas: HTMLCanvasElement;
  gl: GL;
  sim: Sim;
  renderer: Renderer;
  cam = new OrbitCamera();
  overlay = new Overlay();
  graph!: Graph;
  compiled!: Compiled;
  uniforms: Record<string, UVal> = {};
  compileError: string | null = null;

  playing = true;
  speed = 1;
  simTime = 0;
  acc = 0;
  mode: 'inline' | 'lab' = 'inline';
  visible = true;
  selected: string | null = null;
  debugOn = false;
  debug: DebugFlags = {
    velocity: false, force: false, trajectories: false, axis: true, boundary: true,
    flow: false, noise: false, radial: false, colorMode: 0, vectorScale: 1,
  };
  timeline: Timeline = { playing: false, t: 0, length: 8 };
  fps = 60;
  frameMs = 16;
  stepsLastFrame = 0;

  handles: Handle[] = [];
  labels: Label[] = [];
  hover: Handle | null = null;
  dragAnchor: V3 = [0, 0, 0];
  dragOffset: V3 = [0, 0, 0];

  private listeners: Record<string, Set<Fn>> = {};
  private last = 0;
  private fpsAcc = 0;
  private fpsN = 0;
  private histTick = 0;
  private raf = 0;
  private dpr = 1;

  constructor(canvas: HTMLCanvasElement, graph: Graph) {
    this.canvas = canvas;
    const gl = canvas.getContext('webgl2', { antialias: false, alpha: false, premultipliedAlpha: false, powerPreference: 'high-performance' });
    if (!gl) throw new Error('WebGL2 is not available in this browser.');
    if (!gl.getExtension('EXT_color_buffer_float')) throw new Error('This GPU can’t render to float textures (EXT_color_buffer_float), which the simulation needs.');
    this.gl = gl;
    this.sim = new Sim(gl);
    this.renderer = new Renderer(gl);
    this.setGraph(graph);
    this.bindInput();
  }

  on(ev: string, fn: Fn) { (this.listeners[ev] ||= new Set()).add(fn); return () => this.listeners[ev].delete(fn); }
  emit(ev: string, ...a: any[]) { this.listeners[ev]?.forEach((f) => f(...a)); }

  // ── graph ───────────────────────────────────────────────
  setGraph(g: Graph) {
    this.graph = g;
    if (this.selected && !g.nodes.some((n) => n.id === this.selected)) this.selected = null;
    this.recompile();
  }

  /** Structure changed (nodes/wires/bypass): regenerate the GLSL. Parameters never need this. */
  recompile() {
    const c = compile(this.graph);
    try {
      this.sim.setLibrary(c.lib);
      this.renderer.setLibrary(c.lib);
      this.compiled = c;
      this.compileError = null;
    } catch (err: any) {
      console.error(err);
      this.compileError = String(err.message || err);
      if (!this.compiled) this.compiled = c;
      else this.compiled = { ...this.compiled, warnings: [...c.warnings, 'Shader error — last working graph is still running.'] };
    }
    this.uniforms = frameUniforms(this.graph, this.compiled);
    this.emit('graph');
  }

  node(id: string | null): GNode | undefined { return id ? this.graph.nodes.find((n) => n.id === id) : undefined; }

  /** Set parameters live. If a parameter is keyframed, edit the key under the playhead. */
  setParams(n: GNode, values: Record<string, number>, source: 'ui' | 'gizmo' | 'timeline' = 'gizmo') {
    for (const k in values) {
      const pd = DEFS[n.kind].params.find((p) => p.key === k);
      let v = values[k];
      if (pd) v = Math.min(pd.max, Math.max(pd.min, v));
      n.params[k] = v;
      if (source !== 'timeline' && n.keys?.[k]?.length) this.setKey(n, k, v);
    }
    this.emit('param', n, source);
  }

  select(id: string | null) {
    if (this.selected === id) return;
    this.selected = id;
    this.emit('select', id);
  }

  // ── keyframes ──────────────────────────────────────────
  setKey(n: GNode, k: string, v: number) {
    const keys = ((n.keys ||= {})[k] ||= []);
    const t = this.timeline.t;
    const hit = keys.find((x) => Math.abs(x.t - t) < 0.06);
    if (hit) hit.v = v;
    else { keys.push({ t, v }); keys.sort((a, b) => a.t - b.t); }
  }
  toggleKey(n: GNode, k: string) {
    const keys = ((n.keys ||= {})[k] ||= []);
    const t = this.timeline.t;
    const i = keys.findIndex((x) => Math.abs(x.t - t) < 0.06);
    if (i >= 0) keys.splice(i, 1);
    else { keys.push({ t, v: n.params[k] }); keys.sort((a, b) => a.t - b.t); }
    if (!keys.length) delete n.keys![k];
    this.emit('keys', n);
  }
  hasKeyAt(n: GNode, k: string) { return !!n.keys?.[k]?.some((x) => Math.abs(x.t - this.timeline.t) < 0.06); }

  private applyTimeline() {
    const T = this.timeline.length, t = this.timeline.t;
    for (const n of this.graph.nodes) {
      if (!n.keys) continue;
      const vals: Record<string, number> = {};
      for (const k in n.keys) {
        const ks = n.keys[k];
        if (!ks.length) continue;
        if (ks.length === 1) { vals[k] = ks[0].v; continue; }
        // looped interpolation: the last key eases back into the first across the wrap
        let a = ks[ks.length - 1], b = ks[0], ta = a.t - T, tb = b.t;
        for (let i = 0; i < ks.length; i++) {
          if (ks[i].t <= t) { a = ks[i]; ta = a.t; b = ks[(i + 1) % ks.length]; tb = i + 1 < ks.length ? b.t : b.t + T; }
        }
        if (t < ks[0].t) { a = ks[ks.length - 1]; ta = a.t - T; b = ks[0]; tb = b.t; }
        const x = tb - ta > 1e-6 ? (t - ta) / (tb - ta) : 0;
        vals[k] = a.v + (b.v - a.v) * ease(Math.min(1, Math.max(0, x)));
      }
      if (Object.keys(vals).length) this.setParams(n, vals, 'timeline');
    }
  }

  // ── simulation control ────────────────────────────────
  reset() { this.sim.needsReset = true; this.simTime = 0; this.acc = 0; }
  setCount(n: number) { this.sim.setCount(n); this.emit('count', this.sim.count); }

  /** Run the physics ahead of the first visible frame so the orb is already formed. */
  prewarm(seconds: number) {
    this.uniforms = frameUniforms(this.graph, this.compiled);
    const steps = Math.round(seconds / SIM_DT);
    for (let i = 0; i < steps; i++) {
      this.sim.step(SIM_DT, this.simTime, this.uniforms);
      this.simTime += SIM_DT;
      if (i % 2 === 0) this.sim.recordHistory();
    }
  }

  /** Same, spread over frames (under the loading shimmer) so the page never blocks. */
  prewarmAsync(seconds: number, perFrame = 40): Promise<void> {
    this.uniforms = frameUniforms(this.graph, this.compiled);
    let left = Math.round(seconds / SIM_DT);
    return new Promise((resolve) => {
      const tick = () => {
        const n = Math.min(perFrame, left);
        for (let i = 0; i < n; i++) {
          this.sim.step(SIM_DT, this.simTime, this.uniforms);
          this.simTime += SIM_DT;
          if (i % 2 === 0) this.sim.recordHistory();
        }
        left -= n;
        if (left > 0) requestAnimationFrame(tick);
        else resolve();
      };
      tick();
    });
  }

  start() {
    if (this.raf) return;
    this.last = performance.now();
    const loop = (now: number) => {
      this.raf = requestAnimationFrame(loop);
      this.frame(now);
    };
    this.raf = requestAnimationFrame(loop);
  }
  stop() { cancelAnimationFrame(this.raf); this.raf = 0; }

  private resize() {
    const c = this.canvas;
    this.dpr = Math.min(window.devicePixelRatio || 1, 2);
    const w = Math.max(1, Math.round(c.clientWidth * this.dpr));
    const h = Math.max(1, Math.round(c.clientHeight * this.dpr));
    if (c.width !== w || c.height !== h) { c.width = w; c.height = h; }
    this.renderer.resize(w, h);
  }

  frame(now: number) {
    const dt = Math.min((now - this.last) / 1000, 0.1);
    this.last = now;
    this.fpsAcc += dt; this.fpsN++;
    if (this.fpsAcc > 0.5) { this.fps = this.fpsN / this.fpsAcc; this.frameMs = (this.fpsAcc / this.fpsN) * 1000; this.fpsAcc = 0; this.fpsN = 0; this.emit('stats'); }
    if (!this.visible) return;

    this.resize();
    this.cam.update(dt, this.canvas.clientWidth, this.canvas.clientHeight);

    if (this.timeline.playing && this.playing) {
      this.timeline.t = (this.timeline.t + dt * this.speed) % this.timeline.length;
      this.applyTimeline();
      this.emit('timeline');
    }

    this.uniforms = frameUniforms(this.graph, this.compiled);

    // fixed-step integration: frame-rate independent, never more than 8 steps per frame
    let steps = 0;
    if (this.playing) {
      this.acc += dt * this.speed;
      while (this.acc >= SIM_DT && steps < 8) {
        this.sim.step(SIM_DT, this.simTime, this.uniforms);
        this.simTime += SIM_DT;
        this.acc -= SIM_DT;
        steps++;
      }
      if (steps === 8) this.acc = 0;
      if (steps && ++this.histTick % 2 === 0) this.sim.recordHistory();
    }
    this.stepsLastFrame = steps;
    this.uniforms.uTime = this.simTime;

    // overlay
    this.overlay.clear();
    this.labels = [];
    let dbg: DebugFlags | null = null;
    if (this.mode === 'lab') {
      this.handles = buildGizmos(this, this.overlay, this.labels);
      for (const h of this.handles) {
        const hot = this.hover?.id === h.id || this.dragging?.id === h.id;
        this.overlay.point(h.pos, h.color, h.size * (hot ? 1.35 : 1));
      }
      const auto = nodeAutoDebug(this.node(this.selected));
      dbg = this.debugOn ? { ...this.debug } : Object.keys(auto).length ? { ...this.debug, velocity: false, force: false, trajectories: false, flow: false, noise: false, radial: false, colorMode: 0 } : null;
      if (dbg) Object.assign(dbg, auto);
    } else this.handles = [];

    this.renderer.render(this.sim, this.cam, this.uniforms, this.dpr, dbg, this.overlay);
    this.emit('frame');
  }

  // ── input ──────────────────────────────────────────────
  dragging: Handle | null = null;

  private pick(x: number, y: number): Handle | null {
    let best: Handle | null = null, bd = 16;
    for (const h of this.handles) {
      const p = this.cam.project(h.pos);
      if (!p.ok) continue;
      const d = Math.hypot(p.x - x, p.y - y);
      if (d < bd) { bd = d; best = h; }
    }
    return best;
  }

  private bindInput() {
    const c = this.canvas;
    const pointers = new Map<number, { x: number; y: number }>();
    let mode: 'orbit' | 'pan' | 'handle' | 'pinch' | null = null;
    let lastT = 0;
    let pinchD = 0;
    let downAt = { x: 0, y: 0 };
    const local = (e: PointerEvent) => { const r = c.getBoundingClientRect(); return { x: e.clientX - r.left, y: e.clientY - r.top }; };

    c.addEventListener('contextmenu', (e) => e.preventDefault());
    c.addEventListener('pointerdown', (e) => {
      const p = local(e);
      pointers.set(e.pointerId, p);
      try { c.setPointerCapture(e.pointerId); } catch {}
      this.cam.stopCoast();
      lastT = performance.now();
      downAt = p;
      if (pointers.size === 2) {
        const [a, b] = [...pointers.values()];
        pinchD = Math.hypot(a.x - b.x, a.y - b.y);
        mode = 'pinch';
        return;
      }
      const h = this.mode === 'lab' ? this.pick(p.x, p.y) : null;
      if (h) {
        mode = 'handle';
        this.dragging = h;
        h.begin?.(this.cam.ray(p.x, p.y));
        c.style.cursor = h.cursor === 'grab' ? 'grabbing' : h.cursor || 'grabbing';
        this.emit('gizmo-start');
      } else if (e.button === 2 || e.button === 1 || e.shiftKey) mode = 'pan';
      else mode = 'orbit';
    });
    c.addEventListener('pointermove', (e) => {
      const p = local(e);
      const prev = pointers.get(e.pointerId);
      if (!prev) {
        if (this.mode === 'lab') {
          const h = this.pick(p.x, p.y);
          if (h !== this.hover) { this.hover = h; c.style.cursor = h ? h.cursor || 'grab' : ''; }
        }
        return;
      }
      pointers.set(e.pointerId, p);
      const now = performance.now();
      const dt = (now - lastT) / 1000;
      lastT = now;
      if (mode === 'pinch' && pointers.size === 2) {
        const [a, b] = [...pointers.values()];
        const d = Math.hypot(a.x - b.x, a.y - b.y);
        if (pinchD > 0) this.cam.zoom(pinchD / d);
        pinchD = d;
      } else if (mode === 'orbit') this.cam.orbit(p.x - prev.x, p.y - prev.y, dt);
      else if (mode === 'pan') this.cam.pan(p.x - prev.x, p.y - prev.y);
      else if (mode === 'handle' && this.dragging) this.dragging.drag(this.cam.ray(p.x, p.y));
    });
    const up = (e: PointerEvent) => {
      const p = pointers.get(e.pointerId);
      pointers.delete(e.pointerId);
      if (mode === 'orbit' && p && Math.hypot(p.x - downAt.x, p.y - downAt.y) < 3 && this.mode === 'lab') {
        // click on empty viewport: keep the camera still, don't deselect (selection is a graph concept)
        this.cam.stopCoast();
      }
      if (mode === 'handle') this.emit('gizmo-end');
      if (pointers.size === 0) { mode = null; this.dragging = null; c.style.cursor = this.hover ? this.hover.cursor || 'grab' : ''; }
    };
    c.addEventListener('pointerup', up);
    c.addEventListener('pointercancel', up);
    c.addEventListener('wheel', (e) => {
      if (this.mode !== 'lab' && !e.ctrlKey) return; // inline: let the page scroll
      e.preventDefault();
      this.cam.zoom(Math.exp(e.deltaY * 0.0012));
    }, { passive: false });
  }

}
