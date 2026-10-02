/**
 * Dev-only probes for tuning presets from the console. Not imported by the app:
 *   const d = await import('/src/orb/dev.ts'); d.run(8); d.shape()
 */
import type { OrbEngine } from './engine';
import { SIM_DT, TEX_W } from './sim';
import { PRESETS } from './presets';

const orb = (): OrbEngine => (window as any).orb;

export function run(seconds: number) {
  const e = orb();
  for (let i = 0; i < seconds / SIM_DT; i++) {
    e.sim.step(SIM_DT, e.simTime, e.uniforms);
    e.simTime += SIM_DT;
    if (i % 2 === 0) e.sim.recordHistory();
  }
}

let T = performance.now();
export function pump(frames = 1) {
  for (let i = 0; i < frames; i++) { T += 1000 / 60; orb().frame(T); }
}

function read(tex: WebGLTexture) {
  const e = orb(), gl = e.gl;
  const fb = gl.createFramebuffer()!;
  gl.bindFramebuffer(gl.FRAMEBUFFER, fb);
  gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0);
  const a = new Float32Array(TEX_W * e.sim.rows * 4);
  gl.readPixels(0, 0, TEX_W, e.sim.rows, gl.RGBA, gl.FLOAT, a);
  gl.deleteFramebuffer(fb);
  return a;
}

/** Radius percentiles (in units of R), share outside the shell, mean speed, vertical bias. */
export function shape() {
  const e = orb();
  const P = read(e.sim.state.pos), V = read(e.sim.state.vel);
  const c = e.uniforms.uCenter as number[], R = e.uniforms.uR as number;
  const rr: number[] = [];
  let out = 0, sp = 0, my = 0;
  for (let i = 0; i < P.length / 4; i += 3) {
    const x = P[i * 4] - c[0], y = P[i * 4 + 1] - c[1], z = P[i * 4 + 2] - c[2];
    const r = Math.hypot(x, y, z) / R;
    rr.push(r);
    if (r > 1.1) out++;
    sp += Math.hypot(V[i * 4], V[i * 4 + 1], V[i * 4 + 2]);
    my += y;
  }
  rr.sort((a, b) => a - b);
  const n = rr.length, q = (f: number) => rr[Math.floor(n * f)].toFixed(2);
  return `r25=${q(0.25)} r50=${q(0.5)} r90=${q(0.9)} outside=${((out / n) * 100).toFixed(0)}% speed=${(sp / n).toFixed(2)} meanY=${(my / n).toFixed(2)}`;
}

/** Load preset i, apply edits ('nodeId.param': value), settle, measure. */
export function trial(i: number, edits: Record<string, number> = {}, seconds = 8) {
  const e = orb();
  e.setGraph(PRESETS[i].graph());
  for (const k in edits) {
    const [id, key] = k.split('.');
    e.graph.nodes.find((n) => n.id === id)!.params[key] = edits[k];
  }
  e.recompile();
  e.reset();
  run(seconds);
  return `${PRESETS[i].name}: ${shape()}`;
}
