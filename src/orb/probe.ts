import type { OrbEngine } from './engine';
import { TEX_W } from './sim';
import { dirFromAngles, V3, cross, norm, sub, dot } from './math';

/** Same hash the shaders use, so JS knows which population a particle index belongs to. */
function pcg0(x: number): number {
  const M = (a: number, b: number) => Math.imul(a, b) >>> 0;
  let v = [x, 17, 3, 11].map((a) => (M(a, 1664525) + 1013904223) >>> 0);
  v[0] = (v[0] + M(v[1], v[3])) >>> 0; v[1] = (v[1] + M(v[2], v[0])) >>> 0;
  v[2] = (v[2] + M(v[0], v[1])) >>> 0; v[3] = (v[3] + M(v[1], v[2])) >>> 0;
  v = v.map((a) => (a ^ (a >>> 16)) >>> 0);
  v[0] = (v[0] + M(v[1], v[3])) >>> 0; v[1] = (v[1] + M(v[2], v[0])) >>> 0;
  return (v[0] >>> 8) / 16777216;
}

const ROWS = 4; // 2,048 particles sampled
const popHash = new Float32Array(TEX_W * ROWS).map((_, i) => pcg0(i));

/**
 * Reads a slice of the live particle state back from the GPU and returns the mean
 * speed of vortex-population particles along the vortex's own swirl direction.
 */
export function swirlSpeed(e: OrbEngine): number | null {
  const vortex = e.graph.nodes.find((n) => n.kind === 'vortex' && e.compiled.active.has(n.id) && !n.bypass);
  if (!vortex) return null;
  const gl = e.gl;
  const rows = Math.min(ROWS, e.sim.rows);
  const read = (tex: WebGLTexture) => {
    const fb = gl.createFramebuffer()!;
    gl.bindFramebuffer(gl.FRAMEBUFFER, fb);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0);
    const a = new Float32Array(TEX_W * rows * 4);
    gl.readPixels(0, 0, TEX_W, rows, gl.RGBA, gl.FLOAT, a);
    gl.deleteFramebuffer(fb);
    return a;
  };
  const P = read(e.sim.state.pos), V = read(e.sim.state.vel);
  const ax = dirFromAngles(vortex.params.az, vortex.params.el);
  const sgn = vortex.params.dir > 0.5 ? -1 : 1;
  const c = e.uniforms.uCenter as V3, R = e.uniforms.uR as number;
  const mix = e.uniforms.uMix as number[];
  let s = 0, n = 0;
  for (let i = 0; i < TEX_W * rows; i++) {
    const h = popHash[i];
    if (h < mix[0] || h >= 1 - mix[1]) continue; // vortex population only
    const p: V3 = [P[i * 4], P[i * 4 + 1], P[i * 4 + 2]];
    const d = sub(p, c);
    const rp = sub(d, [ax[0] * dot(d, ax), ax[1] * dot(d, ax), ax[2] * dot(d, ax)]);
    const rho = Math.hypot(rp[0], rp[1], rp[2]);
    if (rho < 0.2 * R || rho > 0.95 * R) continue;
    const t = norm(cross(ax, rp));
    s += sgn * (V[i * 4] * t[0] + V[i * 4 + 1] * t[1] + V[i * 4 + 2] * t[2]);
    n++;
  }
  return n > 20 ? s / n : null;
}

export interface Measurement { t: number[]; v: number[]; v0: number; vEst: number; done: boolean; tau?: number; overshoot?: number; settle?: number }

/** Record a step response: call start() right after the step, then sample() every frame. */
export class StepProbe {
  m: Measurement | null = null;
  private t0 = 0;
  constructor(private e: OrbEngine, private window = 2.6) {}

  /** `ratio`: new/old spin, used to estimate the settled speed while the step is still running. */
  start(ratio: number) {
    const v0 = swirlSpeed(this.e);
    if (v0 === null) { this.m = null; return; }
    this.t0 = this.e.simTime;
    this.m = { t: [0], v: [v0], v0, vEst: v0 * ratio, done: false };
  }

  sample(): boolean {
    const m = this.m;
    if (!m || m.done) return false;
    const t = this.e.simTime - this.t0;
    if (t <= m.t[m.t.length - 1]) return false;
    const v = swirlSpeed(this.e);
    if (v === null) return false;
    m.t.push(t);
    m.v.push(v);
    if (t >= this.window) {
      m.done = true;
      const tail = m.v.slice(-8);
      const vEnd = tail.reduce((a, b) => a + b, 0) / tail.length;
      const span = vEnd - m.v0;
      if (Math.abs(span) > 1e-3) {
        const norm = m.v.map((x) => (x - m.v0) / span);
        const cross63 = (lvl: number) => {
          for (let i = 1; i < norm.length; i++) if (norm[i] >= lvl) {
            const f = (lvl - norm[i - 1]) / Math.max(norm[i] - norm[i - 1], 1e-6);
            return m.t[i - 1] + f * (m.t[i] - m.t[i - 1]);
          }
          return undefined;
        };
        m.tau = cross63(0.632);
        m.settle = cross63(0.95);
        m.overshoot = Math.max(0, Math.max(...norm) - 1);
      }
    }
    return true;
  }

  /** Response normalised to 0 → 1 using the settled value (or the latest, while running). */
  normalised(): { t: number; y: number }[] {
    const m = this.m;
    if (!m || m.v.length < 2) return [];
    const tail = m.v.slice(-8);
    const vEnd = m.done ? tail.reduce((a, b) => a + b, 0) / tail.length : m.vEst;
    const span = vEnd - m.v0;
    if (Math.abs(span) < 1e-3) return [];
    return m.t.map((t, i) => ({ t, y: (m.v[i] - m.v0) / span }));
  }
}
