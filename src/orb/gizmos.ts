import { V3, add, sub, scale, norm, cross, dot, basis, dirFromAngles, anglesFromDir, raySphere, rayPlane, len } from './math';
import { Overlay } from './render';
import type { OrbEngine } from './engine';
import { GNode } from './graph';

export interface Ray { o: V3; d: V3 }
export interface Handle {
  id: string;
  pos: V3;
  color: number[];
  size: number;
  cursor?: string;
  drag: (ray: Ray) => void;
  begin?: (ray: Ray) => void;
}
export interface Label { pos: V3; text: string; color: string }

const C = {
  white: [0.93, 0.95, 1, 0.9],
  dim: [0.6, 0.68, 0.8, 0.28],
  faint: [0.6, 0.68, 0.8, 0.12],
  cyan: [0.36, 0.78, 1, 0.95],
  cyanDim: [0.45, 0.82, 1, 0.5],
  amber: [0.95, 0.7, 0.36, 0.95],
  amberDim: [0.95, 0.7, 0.36, 0.3],
  red: [1, 0.42, 0.42, 0.45],
  violet: [0.7, 0.55, 1, 0.95],
  green: [0.5, 0.88, 0.55, 0.95],
};

function circle(ov: Overlay, c: V3, n: V3, r: number, col: number[], seg = 72, dash = false) {
  const [u, v] = basis(norm(n));
  let prev: V3 | null = null;
  for (let i = 0; i <= seg; i++) {
    const a = (i / seg) * Math.PI * 2;
    const p = add(c, add(scale(u, Math.cos(a) * r), scale(v, Math.sin(a) * r)));
    if (prev && (!dash || i % 2 === 0)) ov.line(prev, p, col);
    prev = p;
  }
}

function arrow(ov: Overlay, a: V3, b: V3, col: number[], view: V3, head = 0.28) {
  ov.line(a, b, col);
  const d = sub(b, a);
  const L = len(d);
  if (L < 1e-5) return;
  const dir = scale(d, 1 / L);
  let side = cross(dir, view);
  if (len(side) < 1e-4) side = basis(dir)[0];
  side = scale(norm(side), L * head * 0.45);
  const back = sub(b, scale(dir, L * head));
  ov.line(b, add(back, side), col);
  ov.line(b, sub(back, side), col);
}

/** Drag a direction by sliding a point over a sphere around `c`. */
function sphereDir(ray: Ray, c: V3, r: number): V3 {
  const t = raySphere(ray.o, ray.d, c, r);
  if (t !== null) return norm(sub(add(ray.o, scale(ray.d, t)), c));
  const p = add(ray.o, scale(ray.d, dot(sub(c, ray.o), ray.d)));
  return norm(sub(p, c));
}

export function buildGizmos(e: OrbEngine, ov: Overlay, labels: Label[]): Handle[] {
  const handles: Handle[] = [];
  const cam = e.cam;
  const fwd = cam.forward();
  const right = cam.right();
  const up = cam.up();
  const u = e.uniforms;
  const c = (u.uCenter as number[]).slice() as V3;
  const R = u.uR as number;
  const sel = e.selected ? e.graph.nodes.find((n) => n.id === e.selected) : null;
  const dbg = e.debugOn ? e.debug : null;
  const activeOf = (kind: string) => e.graph.nodes.filter((n) => n.kind === kind && e.compiled.active.has(n.id) && !n.bypass);
  const src = e.compiled.sourceId ? e.graph.nodes.find((n) => n.id === e.compiled.sourceId)! : null;

  // ── sphere / source
  const showSphere = sel?.kind === 'sphere' || sel?.kind === 'emitter' || sel?.kind === 'point' || dbg?.boundary;
  if (showSphere && src) {
    const isSel = sel?.id === src.id;
    if (src.kind !== 'point') {
      circle(ov, c, fwd, R, isSel ? C.amber : C.dim, 96);
      circle(ov, c, [0, 1, 0], R, C.faint, 72);
      circle(ov, c, [1, 0, 0], R, C.faint, 72);
      if (src.kind === 'sphere') {
        const soft = Math.max(src.params.softness, 0.02) * R;
        circle(ov, c, fwd, R - soft, C.amberDim, 96, true);
        const reach = R - soft + soft * (1 + src.params.escape * 2) * 0.9;
        circle(ov, c, fwd, reach, C.red, 96, true);
      }
    }
    if (isSel) {
      handles.push({
        id: 'center', pos: c, color: C.white, size: 13, cursor: 'move',
        drag: (ray) => {
          const t = rayPlane(ray.o, ray.d, e.dragAnchor, fwd);
          if (t === null) return;
          const p = sub(add(ray.o, scale(ray.d, t)), e.dragOffset);
          e.setParams(src, { cx: p[0], cy: p[1], cz: p[2] });
        },
        begin: (ray) => {
          e.dragAnchor = c;
          const t = rayPlane(ray.o, ray.d, c, fwd) ?? 0;
          e.dragOffset = sub(add(ray.o, scale(ray.d, t)), c);
        },
      });
      if (src.kind !== 'point') {
        const rp = add(c, scale(right, R));
        handles.push({
          id: 'radius', pos: rp, color: C.amber, size: 12, cursor: 'ew-resize',
          drag: (ray) => {
            const t = rayPlane(ray.o, ray.d, c, fwd);
            if (t === null) return;
            e.setParams(src, { radius: Math.max(0.2, len(sub(add(ray.o, scale(ray.d, t)), c))) });
          },
        });
        labels.push({ pos: add(rp, scale(right, 0.08)), text: `R ${R.toFixed(2)}`, color: '#f2b45c' });
      }
    }
  }

  // ── vortex
  for (const n of activeOf('vortex')) {
    const isSel = sel?.id === n.id;
    if (!isSel && !dbg?.axis) continue;
    const ax = dirFromAngles(n.params.az, n.params.el);
    const s = n.params.dir > 0.5 ? -1 : 1;
    const L = 1.45 * R;
    ov.line(sub(c, scale(ax, L)), add(c, scale(ax, L)), isSel ? C.cyan : C.cyanDim);
    const [bu, bv] = basis(ax);
    const rc = n.params.core * R;
    // profile rings: alpha follows the tangential speed profile
    const prof = (rho: number) => {
      const lamb = rho > 1e-4 ? (rc * rc) / (rho * rho) * (1 - Math.exp(-(rho * rho) / (rc * rc))) : 1;
      return rho * (1 + (lamb - 1) * n.params.falloff);
    };
    let pmax = 1e-4;
    for (let i = 1; i <= 8; i++) pmax = Math.max(pmax, prof((i / 8) * R));
    for (let i = 1; i <= 8; i++) {
      const rho = (i / 8) * R;
      const a = 0.12 + 0.55 * (prof(rho) / pmax);
      circle(ov, c, ax, rho, [0.55, 0.85, 1, isSel ? a : a * 0.5], 64);
    }
    // direction arrows on three heights
    for (const h of [-0.55, 0, 0.55]) {
      const cc = add(c, scale(ax, h * R));
      const rr = Math.max(rc, 0.25 * R) * (h === 0 ? 1 : 0.8);
      for (let k = 0; k < 4; k++) {
        const a0 = (k / 4) * Math.PI * 2;
        const a1 = a0 + 0.45 * s;
        const p0 = add(cc, add(scale(bu, Math.cos(a0) * rr), scale(bv, Math.sin(a0) * rr)));
        const p1 = add(cc, add(scale(bu, Math.cos(a1) * rr), scale(bv, Math.sin(a1) * rr)));
        arrow(ov, p0, p1, isSel ? C.cyan : C.cyanDim, fwd, 0.4);
      }
    }
    if (isSel) {
      const tip = add(c, scale(ax, L));
      handles.push({
        id: 'axis', pos: tip, color: C.cyan, size: 14, cursor: 'grab',
        drag: (ray) => {
          const d = sphereDir(ray, c, L);
          const { az, el } = anglesFromDir(d);
          e.setParams(n, { az, el });
        },
      });
      labels.push({ pos: add(tip, scale(up, 0.08)), text: 'axis', color: '#5cc8ff' });
      // core radius handle on the equator ring, perpendicular to view where possible
      let side = cross(ax, fwd);
      if (len(side) < 0.2) side = bu;
      side = norm(side);
      const rh = add(c, scale(side, rc));
      handles.push({
        id: 'core', pos: rh, color: C.cyan, size: 10, cursor: 'ew-resize',
        drag: (ray) => {
          const t = rayPlane(ray.o, ray.d, c, fwd);
          if (t === null) return;
          const p = sub(add(ray.o, scale(ray.d, t)), c);
          const rho = len(sub(p, scale(ax, dot(p, ax))));
          e.setParams(n, { core: Math.min(2, Math.max(0.05, rho / R)) });
        },
      });
      labels.push({ pos: add(rh, scale(up, -0.08)), text: `ω ${n.params.strength.toFixed(1)}`, color: '#5cc8ff' });
    }
  }

  // ── radial
  for (const n of activeOf('radial')) {
    if (sel?.id !== n.id) continue;
    const m = n.params.mode;
    const inward = m === 0 || m === 2;
    ov.point(c, C.amber, 8);
    const N = 18;
    for (let i = 0; i < N; i++) {
      const y = 1 - (2 * (i + 0.5)) / N, r = Math.sqrt(1 - y * y), th = i * 2.39996;
      const d: V3 = [Math.cos(th) * r, y, Math.sin(th) * r];
      const a = add(c, scale(d, R * (inward ? 0.95 : 0.45)));
      const b = add(c, scale(d, R * (inward ? 0.55 : 0.85)));
      arrow(ov, a, b, C.amber, fwd, 0.3);
    }
    const rr = n.params.radius;
    circle(ov, c, fwd, rr, C.amberDim, 96, true);
    circle(ov, c, fwd, rr * (1 - n.params.falloff), C.faint, 96, true);
    const hp = add(c, scale(up, rr));
    handles.push({
      id: 'radial-r', pos: hp, color: C.amber, size: 12, cursor: 'ns-resize',
      drag: (ray) => {
        const t = rayPlane(ray.o, ray.d, c, fwd);
        if (t === null) return;
        e.setParams(n, { radius: Math.max(0.2, Math.min(4, len(sub(add(ray.o, scale(ray.d, t)), c)))) });
      },
    });
    labels.push({ pos: add(hp, scale(up, 0.06)), text: 'influence', color: '#f2b45c' });
  }

  // ── gravity
  for (const n of activeOf('gravity')) {
    if (sel?.id !== n.id && !dbg?.axis) continue;
    const g = dirFromAngles(n.params.az, n.params.el);
    const L = 1.6 * R;
    arrow(ov, c, add(c, scale(g, L * Math.min(1, 0.25 + n.params.strength / 8))), C.violet, fwd, 0.15);
    if (sel?.id === n.id) {
      const tip = add(c, scale(g, L));
      handles.push({
        id: 'gravity', pos: tip, color: C.violet, size: 13, cursor: 'grab',
        drag: (ray) => {
          const { az, el } = anglesFromDir(sphereDir(ray, c, L));
          e.setParams(n, { az, el });
        },
      });
      labels.push({ pos: add(tip, scale(up, 0.08)), text: 'g', color: '#b48cff' });
    }
  }

  // ── attractors / repulsors are spatial objects: always visible in the lab
  for (const n of [...activeOf('attractor'), ...activeOf('repulsor')]) {
    const p: V3 = [n.params.cx, n.params.cy, n.params.cz];
    const isSel = sel?.id === n.id;
    const col = n.kind === 'attractor' ? C.green : C.red;
    circle(ov, p, fwd, n.params.radius, isSel ? col : [col[0], col[1], col[2], 0.25], 48, !isSel);
    handles.push({
      id: 'pt-' + n.id, pos: p, color: [col[0], col[1], col[2], 0.95], size: isSel ? 13 : 9, cursor: 'move',
      begin: (ray) => {
        e.select(n.id);
        e.dragAnchor = p;
        const t = rayPlane(ray.o, ray.d, p, fwd) ?? 0;
        e.dragOffset = sub(add(ray.o, scale(ray.d, t)), p);
      },
      drag: (ray) => {
        const t = rayPlane(ray.o, ray.d, e.dragAnchor, fwd);
        if (t === null) return;
        const q = sub(add(ray.o, scale(ray.d, t)), e.dragOffset);
        e.setParams(n, { cx: q[0], cy: q[1], cz: q[2] });
      },
    });
    if (isSel) labels.push({ pos: add(p, scale(up, n.params.radius + 0.05)), text: n.kind, color: n.kind === 'attractor' ? '#7ee08a' : '#ff8080' });
  }

  return handles;
}

export function nodeAutoDebug(sel: GNode | null | undefined) {
  if (!sel) return {};
  if (sel.kind === 'curl' || sel.kind === 'turbulence') return { noise: true };
  if (sel.kind === 'drag') return { velocity: true };
  if (sel.kind === 'radial') return { radial: true };
  return {};
}
