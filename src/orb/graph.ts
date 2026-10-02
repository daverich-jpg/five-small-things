import { dirFromAngles, V3 } from './math';

export type PortType = 'volume' | 'flow' | 'force' | 'field' | 'props' | 'particles';
export type Category = 'Source' | 'Force' | 'Modifier' | 'Particles' | 'Output';

export interface ParamDef {
  key: string;
  label: string;
  type: 'num' | 'int' | 'enum';
  def: number;
  min: number;
  max: number;
  step: number;
  unit?: string;
  fmt?: 'pct' | 'deg';
  options?: string[];
  group?: string;
  axis?: 'az' | 'el'; // part of a direction pair → gets X/Y/Z quick buttons
}

export interface PortDef { key: string; label: string; type: PortType; multi?: boolean }

export interface NodeDef {
  kind: string;
  title: string;
  cat: Category;
  inputs: PortDef[];
  outputs: PortDef[];
  params: ParamDef[];
  blurb: string;
  formula?: string;
}

export interface Key { t: number; v: number }
export interface GNode {
  id: string;
  kind: string;
  x: number;
  y: number;
  params: Record<string, number>;
  bypass?: boolean;
  keys?: Record<string, Key[]>;
}
export interface Wire { id: string; from: { node: string; port: string }; to: { node: string; port: string } }
export interface Graph { nodes: GNode[]; wires: Wire[] }

export const PORT_COLORS: Record<PortType, string> = {
  volume: '#f2b45c',
  flow: '#5cc8ff',
  force: '#b48cff',
  field: '#9aa3b2',
  props: '#7ee08a',
  particles: '#eef0f4',
};
export const CAT_COLORS: Record<Category, string> = {
  Source: '#f2b45c',
  Force: '#7aa8ff',
  Modifier: '#9aa3b2',
  Particles: '#7ee08a',
  Output: '#eef0f4',
};

const num = (key: string, label: string, def: number, min: number, max: number, step: number, extra: Partial<ParamDef> = {}): ParamDef =>
  ({ key, label, type: 'num', def, min, max, step, ...extra });
const int = (key: string, label: string, def: number, min: number, max: number): ParamDef =>
  ({ key, label, type: 'int', def, min, max, step: 1 });
const en = (key: string, label: string, def: number, options: string[]): ParamDef =>
  ({ key, label, type: 'enum', def, min: 0, max: options.length - 1, step: 1, options });
const center = (g = 'Center'): ParamDef[] => [
  num('cx', 'X', 0, -2.5, 2.5, 0.01, { group: g }),
  num('cy', 'Y', 0, -2.5, 2.5, 0.01, { group: g }),
  num('cz', 'Z', 0, -2.5, 2.5, 0.01, { group: g }),
];
const pop = (g: string, d: number[]): ParamDef[] => [
  num(g[0] + 'rot', 'Rotation influence', d[0], 0, 3, 0.01, { group: g }),
  num(g[0] + 'turb', 'Turbulence', d[1], 0, 3, 0.01, { group: g }),
  num(g[0] + 'att', 'Center attraction', d[2], 0, 8, 0.01, { group: g }),
  num(g[0] + 'drag', 'Drag', d[3], 0, 3, 0.01, { group: g }),
  num(g[0] + 'mass', 'Mass', d[4], 0.1, 5, 0.01, { group: g }),
  num(g[0] + 'conf', 'Confinement', d[5], 0, 2, 0.01, { group: g }),
  num(g[0] + 'size', 'Size', d[6], 0.2, 4, 0.01, { group: g }),
  num(g[0] + 'dens', 'Density (ρp/ρf)', d[7], 0.2, 6, 0.01, { group: g }),
];

const FLOW_OUT: PortDef[] = [{ key: 'out', label: 'flow', type: 'flow' }];
const FORCE_OUT: PortDef[] = [{ key: 'out', label: 'force', type: 'force' }];
const FIELD_IN: PortDef[] = [{ key: 'in', label: 'in', type: 'field' }];
const FIELD_OUT: PortDef[] = [{ key: 'out', label: 'out', type: 'field' }];
const PROPS_OUT: PortDef[] = [{ key: 'out', label: 'props', type: 'props' }];
const PARTICLES_IN: PortDef[] = [{ key: 'in', label: 'particles', type: 'particles' }];

export const DEFS: Record<string, NodeDef> = {
  // ── SOURCE ────────────────────────────────────────────
  sphere: {
    kind: 'sphere', title: 'Sphere Volume', cat: 'Source', inputs: [], outputs: [{ key: 'out', label: 'volume', type: 'volume' }],
    blurb: 'Seeds particles inside a sphere and holds them with a soft restoring field. Push hard enough and they leave.',
    formula: 'F = −n̂ · k · pen²   (inside the shell, fades past the escape threshold)',
    params: [
      num('radius', 'Radius', 1, 0.3, 2.5, 0.01, { unit: 'u' }),
      num('strength', 'Boundary strength', 0.8, 0, 2, 0.01),
      num('softness', 'Softness', 0.4, 0.05, 1, 0.01),
      num('damping', 'Damping', 0.5, 0, 2, 0.01),
      num('escape', 'Escape threshold', 0.6, 0, 1, 0.01),
      ...center(),
    ],
  },
  emitter: {
    kind: 'emitter', title: 'Particle Emitter', cat: 'Source', inputs: [], outputs: [{ key: 'out', label: 'volume', type: 'volume' }],
    blurb: 'Emits particles from a spherical shell. No confinement: what leaves, leaves.',
    params: [
      num('radius', 'Shell radius', 1, 0.2, 2.5, 0.01, { unit: 'u' }),
      num('speed', 'Launch speed', -1.5, -6, 6, 0.01, { unit: 'u/s' }),
      num('spread', 'Spread', 0.4, 0, 1, 0.01),
      ...center(),
    ],
  },
  point: {
    kind: 'point', title: 'Point Source', cat: 'Source', inputs: [], outputs: [{ key: 'out', label: 'volume', type: 'volume' }],
    blurb: 'Every particle is born at one point with a random launch velocity.',
    params: [num('speed', 'Launch speed', 2.5, 0, 10, 0.01, { unit: 'u/s' }), num('spread', 'Spread', 1, 0, 1, 0.01), ...center()],
  },

  // ── FORCES ────────────────────────────────────────────
  vortex: {
    kind: 'vortex', title: 'Vortex', cat: 'Force', inputs: [], outputs: FLOW_OUT,
    blurb: 'A rotating velocity field around an axis — solid-body at falloff 0, Lamb–Oseen at 1 — plus Hill’s spherical vortex for the circulation that keeps it a ball.',
    formula: 'v = (ω × r) · profile(ρ)   — a velocity, so it acts through Drag',
    params: [
      num('strength', 'Angular velocity', 8, 0, 40, 0.01, { unit: 'rad/s' }),
      num('core', 'Radius', 0.6, 0.05, 2, 0.01, { unit: '×R' }),
      num('falloff', 'Falloff', 0.65, 0, 1, 0.01),
      num('spiral', 'Spiral inflow', 0.08, -1, 1, 0.01),
      num('poloidal', 'Poloidal flow', 0.4, -6, 6, 0.01, { unit: 'u/s' }),
      en('dir', 'Direction', 0, ['Counter-clockwise', 'Clockwise']),
      num('az', 'Azimuth', 0, -180, 180, 0.5, { fmt: 'deg', group: 'Axis', axis: 'az' }),
      num('el', 'Elevation', 90, -90, 90, 0.5, { fmt: 'deg', group: 'Axis', axis: 'el' }),
    ],
  },
  radial: {
    kind: 'radial', title: 'Radial Force', cat: 'Force', inputs: [], outputs: FORCE_OUT,
    blurb: 'Pushes along the line to the orb’s center. Volume modes scale with distance; center modes are a softened point mass.',
    formula: 'F = ±n̂ · strength · shape(r) · falloff(r)',
    params: [
      en('mode', 'Mode', 0, ['Inward attraction', 'Outward pressure', 'Center attraction', 'Center repulsion']),
      num('strength', 'Strength', 2.5, 0, 30, 0.01, { unit: 'u/s²' }),
      num('radius', 'Influence radius', 1.6, 0.2, 4, 0.01, { unit: 'u' }),
      num('falloff', 'Falloff', 0.3, 0, 1, 0.01),
    ],
  },
  gravity: {
    kind: 'gravity', title: 'Gravity', cat: 'Force', inputs: [], outputs: FORCE_OUT,
    blurb: 'Uniform acceleration. Competes with the vortex for who gets to shape the orb.',
    formula: 'F = m · g',
    params: [
      num('strength', 'Strength', 3, 0, 20, 0.01, { unit: 'u/s²' }),
      num('az', 'Azimuth', 0, -180, 180, 0.5, { fmt: 'deg', group: 'Direction', axis: 'az' }),
      num('el', 'Elevation', -90, -90, 90, 0.5, { fmt: 'deg', group: 'Direction', axis: 'el' }),
    ],
  },
  drag: {
    kind: 'drag', title: 'Drag', cat: 'Force', inputs: [{ key: 'flow', label: 'flow', type: 'flow', multi: true }], outputs: FORCE_OUT,
    blurb: 'Couples particles to the moving air. This is where inertia lives: particles lag the field by τ = m / k. Pressure coupling is the force that bends the air itself — without it, every vortex is a centrifuge.',
    formula: 'F = k·(u − v) + m·(ρf/ρp)·Du/Dt   drag solved implicitly',
    params: [num('coef', 'Coefficient', 0.35, 0, 3, 0.005), num('coupling', 'Pressure coupling', 1, 0, 1.5, 0.01)],
  },
  curl: {
    kind: 'curl', title: 'Curl Noise', cat: 'Force', inputs: [], outputs: FLOW_OUT,
    blurb: 'A divergence-free swirl field. It bends paths without ever bunching or tearing the fluid.',
    formula: 'v = ∇ × ψ(p, t)',
    params: [
      num('scale', 'Scale', 2.5, 0.2, 8, 0.01),
      num('strength', 'Strength', 0.4, 0, 4, 0.01, { unit: 'u/s' }),
      num('speed', 'Speed', 0.7, 0, 3, 0.01),
      num('evolution', 'Evolution', 0.3, 0, 3, 0.01),
      int('octaves', 'Octaves', 3, 1, 4),
    ],
  },
  turbulence: {
    kind: 'turbulence', title: 'Turbulence', cat: 'Force', inputs: [], outputs: FLOW_OUT,
    blurb: 'Multi-octave curl noise with a radial falloff. Drag it past 100% and the vortex forgets it was a vortex.',
    formula: 'v = Σ gainⁱ · ∇ × ψ(2ⁱ p, t) · w(r)',
    params: [
      num('strength', 'Strength', 0.25, 0, 2.5, 0.01, { fmt: 'pct' }),
      num('scale', 'Noise scale', 1.6, 0.2, 8, 0.01),
      num('speed', 'Noise speed', 0.4, 0, 3, 0.01),
      num('evolution', 'Noise evolution', 0.5, 0, 3, 0.01),
      num('falloff', 'Turbulence falloff', 0.3, -1, 1, 0.01),
      int('octaves', 'Octaves', 4, 1, 5),
      num('gain', 'Roughness', 0.5, 0.25, 0.85, 0.01),
    ],
  },
  attractor: {
    kind: 'attractor', title: 'Attractor', cat: 'Force', inputs: [], outputs: FORCE_OUT,
    blurb: 'A softened point mass you can drag around the viewport.',
    formula: 'F = n̂ · s · r / (r² + a²)^(3/2)',
    params: [num('strength', 'Strength', 6, 0, 40, 0.01, { unit: 'u/s²' }), num('radius', 'Softening', 0.4, 0.05, 2, 0.01), ...center('Position').map((p, i) => ({ ...p, def: [0.9, 0.5, 0][i] }))],
  },
  repulsor: {
    kind: 'repulsor', title: 'Repulsor', cat: 'Force', inputs: [], outputs: FORCE_OUT,
    blurb: 'An attractor with the sign flipped. Carves a hole the flow has to go around.',
    formula: 'F = −n̂ · s · r / (r² + a²)^(3/2)',
    params: [num('strength', 'Strength', 6, 0, 40, 0.01, { unit: 'u/s²' }), num('radius', 'Softening', 0.35, 0.05, 2, 0.01), ...center('Position').map((p, i) => ({ ...p, def: [-0.8, -0.3, 0.2][i] }))],
  },

  // ── MODIFIERS ─────────────────────────────────────────
  falloff: {
    kind: 'falloff', title: 'Falloff', cat: 'Modifier', inputs: FIELD_IN, outputs: FIELD_OUT,
    blurb: 'Weights a field by distance from the orb’s center.',
    params: [num('inner', 'Inner', 0.3, 0, 2, 0.01, { unit: '×R' }), num('outer', 'Outer', 1, 0, 3, 0.01, { unit: '×R' }), en('invert', 'Shape', 0, ['Fade out', 'Fade in'])],
  },
  multiply: {
    kind: 'multiply', title: 'Multiply', cat: 'Modifier', inputs: FIELD_IN, outputs: FIELD_OUT,
    blurb: 'Scales a field. Negative values reverse it.', params: [num('factor', 'Factor', 1, -4, 4, 0.01)],
  },
  add: {
    kind: 'add', title: 'Add', cat: 'Modifier', inputs: [{ key: 'a', label: 'a', type: 'field' }, { key: 'b', label: 'b', type: 'field' }], outputs: FIELD_OUT,
    blurb: 'Sums two fields of the same type.', params: [],
  },
  clamp: {
    kind: 'clamp', title: 'Clamp', cat: 'Modifier', inputs: FIELD_IN, outputs: FIELD_OUT,
    blurb: 'Caps a field’s magnitude without changing its direction.', params: [num('max', 'Max magnitude', 6, 0, 40, 0.01)],
  },
  remap: {
    kind: 'remap', title: 'Remap', cat: 'Modifier', inputs: FIELD_IN, outputs: FIELD_OUT,
    blurb: 'Remaps a field’s magnitude from one range to another.',
    params: [num('inMin', 'In min', 0, 0, 20, 0.01), num('inMax', 'In max', 4, 0, 20, 0.01), num('outMin', 'Out min', 0, 0, 20, 0.01), num('outMax', 'Out max', 4, 0, 20, 0.01)],
  },
  noise: {
    kind: 'noise', title: 'Noise', cat: 'Modifier', inputs: FIELD_IN, outputs: FIELD_OUT,
    blurb: 'Modulates a field’s strength with slowly moving scalar noise — gusts.',
    params: [num('amount', 'Amount', 0.6, 0, 2, 0.01), num('scale', 'Scale', 1.5, 0.2, 8, 0.01), num('speed', 'Speed', 1, 0, 4, 0.01)],
  },

  // ── PARTICLES ─────────────────────────────────────────
  system: {
    kind: 'system', title: 'Particle System', cat: 'Particles',
    inputs: [
      { key: 'source', label: 'source', type: 'volume' },
      { key: 'forces', label: 'forces', type: 'force', multi: true },
      { key: 'props', label: 'properties', type: 'props', multi: true },
    ],
    outputs: [{ key: 'out', label: 'particles', type: 'particles' }],
    blurb: 'Integrates every particle: semi-implicit Euler, fixed 1/120 s step, drag solved implicitly.',
    formula: 'v′ = (v + dt·A/m) / (1 + dt·k/m),   p′ = p + v′·dt',
    params: [
      num('core', 'Core share', 0.15, 0, 0.6, 0.005, { fmt: 'pct', group: 'Populations' }),
      num('dust', 'Dust share', 0.25, 0, 0.8, 0.005, { fmt: 'pct', group: 'Populations' }),
      num('mass', 'Mass scale', 1, 0.2, 4, 0.01),
    ],
  },
  props: {
    kind: 'props', title: 'Particle Properties', cat: 'Particles', inputs: [], outputs: PROPS_OUT,
    blurb: 'How each population responds to the same forces. Same field, three temperaments.',
    params: [
      ...pop('Core', [1.3, 1.2, 2.2, 1.6, 0.6, 1.2, 0.7, 1]),
      ...pop('Vortex', [1, 0.7, 1, 1, 1, 1, 1, 1.15]),
      ...pop('Dust', [0.55, 1.6, 0.35, 0.4, 2.4, 0.55, 1.5, 2.6]),
    ],
  },
  lifetime: {
    kind: 'lifetime', title: 'Lifetime', cat: 'Particles', inputs: [], outputs: PROPS_OUT,
    blurb: 'Particles are recycled, never deleted. Fades hide the rebirth.',
    params: [num('min', 'Min', 6, 0.3, 30, 0.1, { unit: 's' }), num('max', 'Max', 14, 0.3, 40, 0.1, { unit: 's' }), num('fadeIn', 'Fade in', 0.6, 0, 3, 0.01, { unit: 's' }), num('fadeOut', 'Fade out', 0.2, 0, 0.8, 0.01, { fmt: 'pct' })],
  },
  velocity: {
    kind: 'velocity', title: 'Velocity', cat: 'Particles', inputs: [], outputs: PROPS_OUT,
    blurb: 'Birth velocity and the speed limit. Newborns inherit the local flow so they don’t visibly “start”.',
    params: [num('inherit', 'Inherit flow', 0.85, 0, 1.5, 0.01, { fmt: 'pct' }), num('random', 'Random', 0.3, 0, 5, 0.01, { unit: 'u/s' }), num('max', 'Max speed', 25, 1, 60, 0.1, { unit: 'u/s' })],
  },
  size: {
    kind: 'size', title: 'Size', cat: 'Particles', inputs: [], outputs: PROPS_OUT,
    blurb: 'World-space particle size, with extra variation for dust.',
    params: [num('base', 'Base size', 0.0065, 0.001, 0.03, 0.0001, { unit: 'u' }), num('variation', 'Variation', 0.45, 0, 1, 0.01), num('dustVar', 'Dust variation', 0.85, 0, 1, 0.01)],
  },

  // ── OUTPUT ────────────────────────────────────────────
  prender: {
    kind: 'prender', title: 'Particle Renderer', cat: 'Output', inputs: PARTICLES_IN, outputs: [],
    blurb: 'Additive soft points. Brightness follows speed, so energy is visible.',
    params: [
      num('size', 'Size', 1, 0.2, 4, 0.01), num('opacity', 'Opacity', 0.35, 0, 1, 0.01), num('brightness', 'Brightness', 1, 0, 4, 0.01),
      num('speedGlow', 'Velocity brightness', 0.8, 0, 2, 0.01), num('hue', 'Hue shift', 0, -180, 180, 1, { fmt: 'deg' }),
    ],
  },
  trender: {
    kind: 'trender', title: 'Trail Renderer', cat: 'Output', inputs: PARTICLES_IN, outputs: [],
    blurb: 'Stretches each particle along its velocity. Fast particles streak; slow ones stay dust.',
    params: [
      num('length', 'Trail length', 0.05, 0, 0.2, 0.001, { unit: 's' }), num('width', 'Trail width', 0.8, 0.2, 1.5, 0.01),
      num('opacity', 'Trail opacity', 0.9, 0, 1.5, 0.01), num('threshold', 'Velocity threshold', 0.8, 0, 8, 0.01, { unit: 'u/s' }),
    ],
  },
  glow: {
    kind: 'glow', title: 'Glow Renderer', cat: 'Output', inputs: PARTICLES_IN, outputs: [],
    blurb: 'Bloom. Light from dense regions bleeds outward, which reads as heat.',
    params: [num('intensity', 'Intensity', 0.9, 0, 3, 0.01), num('radius', 'Radius', 0.65, 0, 1, 0.01), num('threshold', 'Threshold', 0.25, 0, 2, 0.01)],
  },
};

export const MENU: { cat: Category; kinds: string[] }[] = [
  { cat: 'Source', kinds: ['sphere', 'emitter', 'point'] },
  { cat: 'Force', kinds: ['vortex', 'radial', 'gravity', 'drag', 'curl', 'turbulence', 'attractor', 'repulsor'] },
  { cat: 'Modifier', kinds: ['falloff', 'multiply', 'add', 'clamp', 'remap', 'noise'] },
  { cat: 'Particles', kinds: ['system', 'props', 'lifetime', 'velocity', 'size'] },
  { cat: 'Output', kinds: ['prender', 'trender', 'glow'] },
];

// ── graph helpers ─────────────────────────────────────────

let uid = 1;
export function newId(g: Graph) {
  const used = new Set(g.nodes.map((n) => n.id));
  let id: string;
  do id = 'n' + uid++; while (used.has(id));
  return id;
}

export function makeNode(kind: string, id: string, x: number, y: number, params: Record<string, number> = {}): GNode {
  const def = DEFS[kind];
  const p: Record<string, number> = {};
  for (const pd of def.params) p[pd.key] = pd.def;
  return { id, kind, x, y, params: { ...p, ...params } };
}

export function outType(g: Graph, nodeId: string, seen = new Set<string>()): PortType {
  const n = g.nodes.find((x) => x.id === nodeId);
  if (!n) return 'field';
  const def = DEFS[n.kind];
  const t = def.outputs[0]?.type ?? 'field';
  if (t !== 'field' || seen.has(nodeId)) return t;
  seen.add(nodeId);
  for (const w of g.wires) if (w.to.node === nodeId) {
    const r = outType(g, w.from.node, seen);
    if (r !== 'field') return r;
  }
  return 'field';
}

export function compatible(a: PortType, b: PortType) {
  if (a === b) return true;
  const fieldish = (t: PortType) => t === 'flow' || t === 'force' || t === 'field';
  return (a === 'field' && fieldish(b)) || (b === 'field' && fieldish(a));
}

/** Would a wire from → to create a cycle? */
export function createsCycle(g: Graph, from: string, to: string) {
  const stack = [to];
  const seen = new Set<string>();
  while (stack.length) {
    const n = stack.pop()!;
    if (n === from) return true;
    if (seen.has(n)) continue;
    seen.add(n);
    for (const w of g.wires) if (w.from.node === n) stack.push(w.to.node);
  }
  return false;
}

// ── compiler ──────────────────────────────────────────────

export interface Compiled {
  lib: string;
  emitted: string[];
  active: Set<string>;
  invalidWires: Set<string>;
  systemId: string | null;
  sourceId: string | null;
  props: Record<string, string>; // kind → node id
  renderers: Record<string, string>;
  hasFlow: boolean;
  warnings: string[];
}

const U = (id: string, k: string) => `u_${id}_${k}`;

function emitNode(n: GNode, inputs: string[], type: 'flow' | 'force'): string {
  const u = (k: string) => U(n.id, k);
  const fsig = `F force_${n.id}(vec3 p, vec3 v, Pop pop)`;
  const vsig = `vec3 flow_${n.id}(vec3 p, Pop pop)`;
  const sig = type === 'flow' ? vsig : fsig;
  const call = (fn: string) => (type === 'flow' ? `${fn}(p, pop)` : `${fn}(p, v, pop)`);
  switch (n.kind) {
    case 'vortex':
      return `${vsig} {
  vec3 ax = ${u('axis')};
  vec3 d = p - uCenter;
  vec3 rp = d - ax * dot(d, ax);
  float rho2 = dot(rp, rp);
  float rc = max(${u('core')} * uR, 1e-3);
  float lamb = rc * rc / (rho2 + 1e-5) * (1.0 - exp(-rho2 / (rc * rc)));
  float prof = mix(1.0, lamb, ${u('falloff')});
  vec3 t = cross(ax, rp) * ${u('strength')} * prof;
  // Hill's spherical vortex: a divergence-free poloidal circulation that fills the sphere —
  // up the axis, out over the top, down the outside. With the swirl it makes helices.
  float z = dot(d, ax);
  float a2 = uR * uR;
  float hill = 1.0 - smoothstep(0.9, 1.25, sqrt(rho2 + z * z) / uR);
  // spiral: a stagnation-point secondary flow (in at the equator, out through both poles).
  // ∇·(−ρ + 2z) = 0, so it organizes the vortex without piling material up anywhere.
  vec3 s = (-rp + ax * (2.0 * z)) * abs(${u('strength')}) * ${u('spiral')} * 0.5 * hill;
  vec3 pol = (rp * (1.5 * z / a2) + ax * (1.5 * (1.0 - (2.0 * rho2 + z * z) / a2))) * ${u('poloidal')} * hill;
  return (t + s + pol) * pop.rot;
}`;
    case 'curl':
      return `${vsig} {
  vec3 q = (p - uCenter) * ${u('scale')} + vec3(0.0, -uTime * ${u('speed')}, 0.0);
  return curlFbm(q, uTime * ${u('evolution')}, int(${u('octaves')} + 0.5), 2.0, 0.5) * ${u('strength')} * pop.turb;
}`;
    case 'turbulence':
      return `${vsig} {
  vec3 q = (p - uCenter) * ${u('scale')} + vec3(uTime * ${u('speed')} * 0.37, -uTime * ${u('speed')}, 0.0);
  float r = clamp(length(p - uCenter) / uR, 0.0, 1.0);
  float f = ${u('falloff')};
  float w = f >= 0.0 ? mix(1.0, smoothstep(0.0, 1.0, r) * 1.6, f) : mix(1.0, (1.0 - smoothstep(0.0, 1.0, r)) * 1.6, -f);
  return curlFbm(q, uTime * ${u('evolution')}, int(${u('octaves')} + 0.5), 2.03, ${u('gain')}) * ${u('strength')} * 3.0 * w * pop.turb;
}`;
    case 'radial':
      return `${fsig} {
  vec3 d = p - uCenter;
  float r = length(d);
  vec3 n = d / max(r, 1e-4);
  float R = ${u('radius')};
  float w = 1.0 - smoothstep(R * (1.0 - ${u('falloff')}) - 1e-3, R, r);
  float m = ${u('mode')};
  float sgn = (m < 0.5 || (m > 1.5 && m < 2.5)) ? -1.0 : 1.0;
  float shape;
  if (m < 1.5) shape = r / uR;
  else { float a = 0.2 * uR; shape = r / pow(r * r + a * a, 1.5) * a * a * 2.598; }
  return F(n * sgn * ${u('strength')} * shape * w * pop.attract * pop.mass, 0.0);
}`;
    case 'gravity':
      return `${fsig} { return F(${u('dir')} * ${u('strength')} * pop.mass, 0.0); }`;
    case 'attractor':
    case 'repulsor': {
      const sgn = n.kind === 'attractor' ? '1.0' : '-1.0';
      return `${fsig} {
  vec3 d = vec3(${u('cx')}, ${u('cy')}, ${u('cz')}) - p;
  float r = length(d);
  float a = ${u('radius')};
  float shape = r / pow(r * r + a * a, 1.5) * a * a * 2.598;
  return F(d / max(r, 1e-4) * ${sgn} * ${u('strength')} * shape * pop.attract * pop.mass, 0.0);
}`;
    }
    case 'drag': {
      const sum = inputs.length ? inputs.map((f) => `${f}(q, pop)`).join(' + ') : 'vec3(0.0)';
      // Maxey–Riley, trimmed: Stokes drag toward the local flow, plus the pressure-gradient
      // ("fluid acceleration") term ρf/ρp · Du/Dt. Du/Dt is taken along the streamline.
      return `vec3 airflow_${n.id}(vec3 q, Pop pop) { return ${sum}; }
${fsig} {
  float k = ${u('coef')} * 6.0 * pop.drag;
  vec3 a;
  if (${u('coupling')} > 0.0) {
    // central difference along the particle's path: second-order, so it adds no drift
    const float h = 0.012;
    vec3 ua = airflow_${n.id}(p + v * (0.5 * h), pop);
    vec3 ub = airflow_${n.id}(p - v * (0.5 * h), pop);
    vec3 uf = 0.5 * (ua + ub);
    a = k * uf + (ua - ub) / h * pop.mass * pop.buoy * ${u('coupling')};
  } else {
    a = k * airflow_${n.id}(p, pop);
  }
  return F(a, k);
}`;
    }
    case 'multiply':
      return type === 'flow'
        ? `${sig} { return ${call(inputs[0])} * ${u('factor')}; }`
        : `${sig} { return fScale(${call(inputs[0])}, ${u('factor')}); }`;
    case 'falloff':
      return `${sig} {
  float r = length(p - uCenter) / uR;
  float w = 1.0 - smoothstep(${u('inner')}, max(${u('outer')}, ${u('inner')} + 1e-3), r);
  if (${u('invert')} > 0.5) w = 1.0 - w;
  return ${type === 'flow' ? `${call(inputs[0])} * w` : `fScale(${call(inputs[0])}, w)`};
}`;
    case 'noise':
      return `${sig} {
  float w = max(0.0, 1.0 + ${u('amount')} * snoise1((p - uCenter) * ${u('scale')} + vec3(uTime * ${u('speed')}, 0.0, -uTime * ${u('speed')} * 0.6)));
  return ${type === 'flow' ? `${call(inputs[0])} * w` : `fScale(${call(inputs[0])}, w)`};
}`;
    case 'clamp':
      return type === 'flow'
        ? `${sig} { vec3 x = ${call(inputs[0])}; float m = length(x); return x * min(1.0, ${u('max')} / max(m, 1e-5)); }`
        : `${sig} { F x = ${call(inputs[0])}; float m = length(x.a) / pop.mass; return F(x.a * min(1.0, ${u('max')} / max(m, 1e-5)), x.k); }`;
    case 'remap': {
      const body = (expr: string) => `float t = clamp((m - ${u('inMin')}) / max(${u('inMax')} - ${u('inMin')}, 1e-4), 0.0, 1.0);
  float s = mix(${u('outMin')}, ${u('outMax')}, t) / max(m, 1e-5);
  return ${expr};`;
      return type === 'flow'
        ? `${sig} { vec3 x = ${call(inputs[0])}; float m = length(x);\n  ${body('x * s')} }`
        : `${sig} { F x = ${call(inputs[0])}; float m = length(x.a) / pop.mass;\n  ${body('F(x.a * s, x.k)')} }`;
    }
    case 'add':
      return type === 'flow'
        ? `${sig} { return ${call(inputs[0])} + ${call(inputs[1])}; }`
        : `${sig} { return fAdd(${call(inputs[0])}, ${call(inputs[1])}); }`;
  }
  return '';
}

const FLOW_KINDS = new Set(['vortex', 'curl', 'turbulence']);
const FORCE_KINDS = new Set(['radial', 'gravity', 'attractor', 'repulsor', 'drag']);
const MOD_KINDS = new Set(['falloff', 'multiply', 'add', 'clamp', 'remap', 'noise']);
const RENDER_KINDS = new Set(['prender', 'trender', 'glow']);
const PROP_KINDS = new Set(['props', 'lifetime', 'velocity', 'size']);

export function compile(g: Graph): Compiled {
  const byId = new Map(g.nodes.map((n) => [n.id, n]));
  const into = (id: string, port: string) => g.wires.filter((w) => w.to.node === id && w.to.port === port);
  const invalid = new Set<string>();
  const active = new Set<string>();
  const warnings: string[] = [];
  const code: string[] = [];
  const memo = new Map<string, { fn: string; type: 'flow' | 'force' } | null>();
  const emittedSet = new Set<string>();
  const dragFlows: string[] = [];
  const noiseRaw: string[] = [];
  const radialRaw: string[] = [];

  // pick the system that feeds a renderer, else the first one
  const systems = g.nodes.filter((n) => n.kind === 'system');
  const fed = systems.find((s) => g.wires.some((w) => w.from.node === s.id && RENDER_KINDS.has(byId.get(w.to.node)?.kind || '')));
  const system = fed || systems[0] || null;
  if (!system) warnings.push('No Particle System — nothing is being integrated.');

  function gen(id: string): { fn: string; type: 'flow' | 'force' } | null {
    if (memo.has(id)) return memo.get(id)!;
    memo.set(id, null); // cycle guard
    const n = byId.get(id);
    if (!n) return null;
    let res: { fn: string; type: 'flow' | 'force' } | null = null;
    if (MOD_KINDS.has(n.kind)) {
      const ports = n.kind === 'add' ? ['a', 'b'] : ['in'];
      const ins = ports.map((p) => {
        const w = into(id, p)[0];
        return w ? { w, r: gen(w.from.node) } : null;
      });
      const live = ins.filter((x) => x && x.r) as { w: Wire; r: { fn: string; type: 'flow' | 'force' } }[];
      if (!live.length) res = null;
      else if (n.bypass || (n.kind === 'add' && live.length === 1)) res = live[0].r;
      else {
        const type = live[0].r.type;
        if (n.kind === 'add' && live[1].r.type !== type) {
          invalid.add(live[1].w.id);
          warnings.push('Add: both inputs must be the same type (flow + flow or force + force).');
          res = live[0].r;
        } else {
          const fn = `${type}_${id}`;
          code.push(emitNode(n, live.map((l) => l.r.fn), type));
          emittedSet.add(id);
          res = { fn, type };
        }
      }
    } else if (FLOW_KINDS.has(n.kind)) {
      if (!n.bypass) {
        code.push(emitNode(n, [], 'flow'));
        emittedSet.add(id);
        if (n.kind !== 'vortex') noiseRaw.push(`flow_${id}`);
        res = { fn: `flow_${id}`, type: 'flow' };
      }
    } else if (FORCE_KINDS.has(n.kind)) {
      if (!n.bypass) {
        const ins: string[] = [];
        if (n.kind === 'drag') {
          for (const w of into(id, 'flow')) {
            const r = gen(w.from.node);
            if (!r) continue;
            if (r.type !== 'flow') { invalid.add(w.id); warnings.push('Drag only accepts flow (velocity) fields.'); continue; }
            ins.push(r.fn);
            dragFlows.push(r.fn);
          }
        }
        code.push(emitNode(n, ins, 'force'));
        emittedSet.add(id);
        if (n.kind === 'radial') radialRaw.push(`force_${id}`);
        res = { fn: `force_${id}`, type: 'force' };
      }
    }
    memo.set(id, res);
    return res;
  }

  const forces: string[] = [];
  let sourceId: string | null = null;
  const props: Record<string, string> = {};
  const renderers: Record<string, string> = {};

  if (system) {
    for (const w of into(system.id, 'forces')) {
      const r = gen(w.from.node);
      if (!r) continue;
      if (r.type !== 'force') {
        invalid.add(w.id);
        warnings.push('A flow can’t push particles directly — route it through Drag.');
        continue;
      }
      forces.push(r.fn);
    }
    const src = into(system.id, 'source')[0];
    if (src && byId.get(src.from.node) && !byId.get(src.from.node)!.bypass) sourceId = src.from.node;
    for (const w of into(system.id, 'props')) {
      const n = byId.get(w.from.node);
      if (n && PROP_KINDS.has(n.kind) && !n.bypass) props[n.kind] = n.id;
    }
    for (const w of g.wires) if (w.from.node === system.id) {
      const n = byId.get(w.to.node);
      if (n && RENDER_KINDS.has(n.kind) && !n.bypass) renderers[n.kind] = n.id;
    }
    if (!sourceId) warnings.push('Particle System has no source; particles spawn at the origin.');
    if (!renderers.prender) warnings.push('No Particle Renderer connected — the sim runs, but nothing draws it.');
  }

  // active = everything upstream of the system + system + its renderers
  if (system) {
    const stack = [system.id];
    while (stack.length) {
      const id = stack.pop()!;
      if (active.has(id)) continue;
      active.add(id);
      for (const w of g.wires) if (w.to.node === id && !invalid.has(w.id)) stack.push(w.from.node);
    }
    Object.values(renderers).forEach((id) => active.add(id));
  }

  // uniform declarations for emitted nodes
  const decl: string[] = [];
  for (const id of emittedSet) {
    const n = byId.get(id)!;
    for (const p of DEFS[n.kind].params) decl.push(`uniform float ${U(id, p.key)};`);
    if (n.kind === 'vortex') decl.push(`uniform vec3 ${U(id, 'axis')};`);
    if (n.kind === 'gravity') decl.push(`uniform vec3 ${U(id, 'dir')};`);
  }

  const uniq = (a: string[]) => [...new Set(a)];
  const lib = `
${decl.join('\n')}
${code.join('\n\n')}

F confine(vec3 p, vec3 v, Pop pop) {
  F f = F(vec3(0.0), 0.0);
  if (uConfOn < 0.5) return f;
  vec3 d = p - uCenter;
  float r = length(d);
  if (r < 1e-5) return f;
  vec3 n = d / r;
  float soft = max(uConf.y, 0.02) * uR;
  float pen = (r - (uR - soft)) / soft;          // 0 where the shell begins, 1 at R
  if (pen <= 0.0) return f;
  float reach = 1.0 + uConf.w * 2.0;            // how far past R the field still holds
  float hold = 1.0 - smoothstep(reach * 0.8, reach, pen);
  f.a = -n * uConf.x * 60.0 * pen * pen * hold * pop.conf * pop.mass;
  float vr = dot(v, n);
  if (vr > 0.0) f.a -= n * vr * uConf.z * 12.0 * min(pen, 1.0) * hold * pop.mass;
  return f;
}

F totalForce(vec3 p, vec3 v, Pop pop) {
  F f = confine(p, v, pop);
${forces.map((fn) => `  f = fAdd(f, ${fn}(p, v, pop));`).join('\n')}
  return f;
}
vec3 flowAt(vec3 p, Pop pop) { return vec3(0.0)${uniq(dragFlows).map((fn) => ` + ${fn}(p, pop)`).join('')}; }
vec3 noiseAt(vec3 p, Pop pop) { return vec3(0.0)${uniq(noiseRaw).map((fn) => ` + ${fn}(p, pop)`).join('')}; }
vec3 radialAt(vec3 p, Pop pop) { vec3 a = vec3(0.0);${uniq(radialRaw).map((fn) => ` a += ${fn}(p, vec3(0.0), pop).a;`).join('')} return a; }
`;
  return {
    lib,
    emitted: [...emittedSet],
    active,
    invalidWires: invalid,
    systemId: system?.id ?? null,
    sourceId,
    props,
    renderers,
    hasFlow: dragFlows.length > 0,
    warnings: uniq(warnings),
  };
}

// ── per-frame uniform values ─────────────────────────────

type UV = number | number[];

function defaults(kind: string) {
  const p: Record<string, number> = {};
  for (const d of DEFS[kind].params) p[d.key] = d.def;
  return p;
}

export function frameUniforms(g: Graph, c: Compiled): Record<string, UV> {
  const byId = new Map(g.nodes.map((n) => [n.id, n]));
  const u: Record<string, UV> = {};
  let spawnAxis: V3 = [0, 1, 0];
  for (const id of c.emitted) {
    const n = byId.get(id)!;
    for (const k in n.params) u[U(id, k)] = n.params[k];
    if (n.kind === 'vortex') {
      const a = dirFromAngles(n.params.az, n.params.el);
      const s = n.params.dir > 0.5 ? -1 : 1;
      u[U(id, 'axis')] = [a[0] * s, a[1] * s, a[2] * s];
      spawnAxis = a;
    }
    if (n.kind === 'gravity') u[U(id, 'dir')] = dirFromAngles(n.params.az, n.params.el);
  }
  const src = c.sourceId ? byId.get(c.sourceId)! : null;
  const sp = src?.params;
  u.uCenter = sp ? [sp.cx, sp.cy, sp.cz] : [0, 0, 0];
  u.uR = sp && src!.kind !== 'point' ? sp.radius : 1;
  u.uConfOn = src?.kind === 'sphere' ? 1 : 0;
  u.uConf = src?.kind === 'sphere' ? [sp!.strength, sp!.softness, sp!.damping, sp!.escape] : [0, 0.4, 0, 0];
  u.uSourceKind = src ? ({ sphere: 0, emitter: 1, point: 2 } as Record<string, number>)[src.kind] : 3;
  u.uSrc = src?.kind === 'emitter' || src?.kind === 'point' ? [sp!.speed, sp!.spread, 0, 0] : [0, 0, 0, 0];
  u.uSpawnAxis = spawnAxis;

  const sys = c.systemId ? byId.get(c.systemId)!.params : defaults('system');
  u.uMix = [sys.core, Math.min(sys.dust, 1 - sys.core)];
  u.uMassScale = sys.mass;

  const pr = c.props.props ? byId.get(c.props.props)!.params : defaults('props');
  ['C', 'V', 'D'].forEach((g, i) => {
    u['uPopA' + i] = [pr[g + 'rot'], pr[g + 'turb'], pr[g + 'att'], pr[g + 'drag']];
    u['uPopB' + i] = [pr[g + 'mass'], pr[g + 'conf'], pr[g + 'size'], 1 / pr[g + 'dens']];
  });
  const lf = c.props.lifetime ? byId.get(c.props.lifetime)!.params : defaults('lifetime');
  u.uLife = [Math.min(lf.min, lf.max), Math.max(lf.min, lf.max), lf.fadeIn, lf.fadeOut];
  const vl = c.props.velocity ? byId.get(c.props.velocity)!.params : defaults('velocity');
  u.uVelInit = [vl.inherit, vl.random, vl.max, 0];
  const sz = c.props.size ? byId.get(c.props.size)!.params : defaults('size');
  u.uSizeP = [sz.base, sz.variation, sz.dustVar, 0];

  const rp = c.renderers.prender ? byId.get(c.renderers.prender)!.params : null;
  u.uRender = rp ? [rp.size, rp.opacity, rp.brightness, rp.speedGlow] : [1, 0, 0, 0];
  u.uHue = rp ? rp.hue : 0;
  const tp = c.renderers.trender ? byId.get(c.renderers.trender)!.params : null;
  u.uTrail = tp ? [tp.length, tp.width, tp.opacity, tp.threshold] : [0, 1, 1, 0];
  u.uTrailOn = tp ? 1 : 0;
  const gp = c.renderers.glow ? byId.get(c.renderers.glow)!.params : null;
  u.uGlow = gp ? [gp.intensity, gp.radius, gp.threshold, 1] : [0, 0, 1, 0];
  return u;
}

/** Response time of each population to a change in the flow: τ = m / k. */
export function dragTaus(g: Graph, c: Compiled): { core: number; vortex: number; dust: number; coef: number } | null {
  const drag = g.nodes.find((n) => n.kind === 'drag' && c.active.has(n.id) && !n.bypass);
  if (!drag) return null;
  const byId = new Map(g.nodes.map((n) => [n.id, n]));
  const pr = c.props.props ? byId.get(c.props.props)!.params : defaults('props');
  const sys = c.systemId ? byId.get(c.systemId)!.params : defaults('system');
  const k = drag.params.coef * 6;
  const tau = (p: string) => (k * pr[p + 'drag'] > 0 ? (pr[p + 'mass'] * sys.mass) / (k * pr[p + 'drag']) : Infinity);
  return { core: tau('C'), vortex: tau('V'), dust: tau('D'), coef: drag.params.coef };
}
