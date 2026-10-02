import { GL, Program, createProgram, createTexture, createFbo, setUniforms, bindTex, FULLSCREEN_VS, UVal } from './gl';
import { NOISE, COMMON, GLOBALS } from './glsl';

export const TEX_W = 512;
export const MAX_ROWS = 512; // 262,144 particles max
export const TRAJ_N = 72;
export const TRAJ_H = 120;
export const SIM_DT = 1 / 120;

/**
 * State lives in three float textures per buffer (MRT), ping-ponged:
 *   0: position.xyz, age        1: velocity.xyz, lifespan        2: acceleration.xyz, speed
 * Mass, size, density and population are derived from the particle index by hash,
 * so they cost no memory and stay consistent between simulation and rendering.
 */
function simFS(lib: string) {
  return /* glsl */ `#version 300 es
precision highp float;
precision highp int;
uniform sampler2D uPos;
uniform sampler2D uVel;
uniform int uWidth;
uniform float uDt;
uniform float uReset;
uniform uint uSeed;
uniform vec3 uSpawnAxis;
uniform vec4 uLife;     // min, max, fadeIn, fadeOut
uniform vec4 uVelInit;  // inherit, random, maxSpeed
uniform float uSourceKind;
uniform vec4 uSrc;      // speed, spread
${GLOBALS}
${COMMON}
${NOISE}
${lib}
layout(location = 0) out vec4 oPos;
layout(location = 1) out vec4 oVel;
layout(location = 2) out vec4 oAcc;

vec3 randDir(vec2 u) {
  float z = u.x * 2.0 - 1.0;
  float a = u.y * 6.2831853;
  float s = sqrt(max(0.0, 1.0 - z * z));
  return vec3(s * cos(a), z, s * sin(a));
}

void spawn(uint i, Pop pop, float firstTime, out vec4 P, out vec4 V) {
  vec4 h = hash4(uvec4(i, uSeed, 7u, 1u));
  vec4 h2 = hash4(uvec4(i, uSeed, 13u, 5u));
  vec3 dir = randDir(h.xy);
  vec3 p = uCenter;
  vec3 v = vec3(0.0);
  if (uSourceKind < 0.5) {
    // Sphere volume — each population has its own radial distribution
    float r;
    if (pop.type < 0.5) r = 0.32 * pow(h.z, 0.6);
    else if (pop.type < 1.5) r = 0.22 + 0.72 * pow(h.z, 0.75);
    else r = 0.55 + 0.5 * h.z;
    // vortex material starts as an oblate disc around the spin axis
    vec3 ax = uSpawnAxis;
    float squash = pop.type > 0.5 && pop.type < 1.5 ? 0.55 : 0.9;
    dir = normalize(dir - ax * dot(dir, ax) * (1.0 - squash));
    p = uCenter + dir * r * uR;
  } else if (uSourceKind < 1.5) {
    // Emitter — shell, launched in/out
    p = uCenter + dir * uR * (1.0 + (h.z - 0.5) * 0.05);
    vec3 lv = normalize(mix(dir, randDir(h2.xy), uSrc.y * 0.7));
    v = lv * uSrc.x * mix(0.6, 1.4, h2.z);
  } else if (uSourceKind < 2.5) {
    // Point source
    p = uCenter + randDir(h2.zw) * 0.01;
    vec3 lv = normalize(mix(vec3(0.0, 1.0, 0.0), dir, max(uSrc.y, 0.001)));
    v = lv * uSrc.x * mix(0.5, 1.3, h2.z);
  } else {
    p = dir * 0.1;
  }
  // newborns inherit the local flow so they join the motion instead of "starting"
  v += flowAt(p, pop) * uVelInit.x + randDir(h2.xy) * uVelInit.y * h2.w;
  float span = mix(uLife.x, uLife.y, h.w) * (pop.type < 0.5 ? 1.3 : (pop.type > 1.5 ? 0.8 : 1.0));
  float age = firstTime > 0.5 ? h2.w * span : 0.0;   // stagger the very first generation
  P = vec4(p, age);
  V = vec4(v, span);
}

void main() {
  ivec2 c = ivec2(gl_FragCoord.xy);
  uint i = uint(c.y * uWidth + c.x);
  vec4 P = texelFetch(uPos, c, 0);
  vec4 V = texelFetch(uVel, c, 0);
  Pop pop = popFor(i);
  bool bad = any(isnan(P)) || any(isinf(P)) || any(isnan(V)) || any(isinf(V));
  float far = uConfOn > 0.5 ? 6.0 : 9.0;
  if (uReset > 0.5 || bad || V.w <= 0.0 || P.w >= V.w || length(P.xyz - uCenter) > uR * far + 2.0) {
    vec4 nP, nV;
    spawn(i, pop, (uReset > 0.5 || V.w <= 0.0 || bad) ? 1.0 : 0.0, nP, nV);
    oPos = nP;
    oVel = nV;
    oAcc = vec4(0.0, 0.0, 0.0, length(nV.xyz));
    return;
  }
  vec3 p = P.xyz;
  vec3 v = V.xyz;
  F f = totalForce(p, v, pop);
  // semi-implicit Euler; the drag term k·v is integrated implicitly so stiff drag never explodes
  float m = max(pop.mass, 1e-3);
  vec3 vn = (v + uDt * f.a / m) / (1.0 + uDt * f.k / m);
  float sp = length(vn);
  if (sp > uVelInit.z) vn *= uVelInit.z / sp;
  vec3 pn = p + vn * uDt;
  oPos = vec4(pn, P.w + uDt);
  oVel = vec4(vn, V.w);
  oAcc = vec4((vn - v) / uDt, length(vn));
}`;
}

const HIST_FS = /* glsl */ `#version 300 es
precision highp float;
uniform sampler2D uPos;
uniform int uWidth;
uniform int uStride;
out vec4 o;
void main() {
  int idx = int(gl_FragCoord.x) * uStride + 37;
  o = texelFetch(uPos, ivec2(idx % uWidth, idx / uWidth), 0);
}`;

interface StateBuf { fbo: WebGLFramebuffer; pos: WebGLTexture; vel: WebGLTexture; acc: WebGLTexture }

export class Sim {
  gl: GL;
  bufs: StateBuf[];
  cur = 0;
  rows = 128;
  program: Program | null = null;
  hist: { tex: WebGLTexture; fbo: WebGLFramebuffer; prog: Program; head: number };
  vao: WebGLVertexArrayObject;
  needsReset = true;
  seed = 1;

  constructor(gl: GL) {
    this.gl = gl;
    const mk = (): StateBuf => {
      const t = () => createTexture(gl, TEX_W, MAX_ROWS, gl.RGBA32F, gl.RGBA, gl.FLOAT, gl.NEAREST);
      const pos = t(), vel = t(), acc = t();
      return { pos, vel, acc, fbo: createFbo(gl, [pos, vel, acc]) };
    };
    this.bufs = [mk(), mk()];
    const ht = createTexture(gl, TRAJ_N, TRAJ_H, gl.RGBA32F, gl.RGBA, gl.FLOAT, gl.NEAREST);
    this.hist = { tex: ht, fbo: createFbo(gl, [ht]), prog: createProgram(gl, FULLSCREEN_VS, HIST_FS), head: 0 };
    this.vao = gl.createVertexArray()!;
  }

  get count() { return this.rows * TEX_W; }
  setCount(n: number) {
    this.rows = Math.max(1, Math.min(MAX_ROWS, Math.ceil(n / TEX_W)));
  }

  /** Throws on compile error; the previous program stays live. */
  setLibrary(lib: string) {
    const p = createProgram(this.gl, FULLSCREEN_VS, simFS(lib));
    if (this.program) this.gl.deleteProgram(this.program.prog);
    this.program = p;
  }

  get state(): StateBuf { return this.bufs[this.cur]; }

  step(dt: number, time: number, uniforms: Record<string, UVal>) {
    const gl = this.gl;
    if (!this.program) return;
    const src = this.bufs[this.cur], dst = this.bufs[1 - this.cur];
    gl.bindVertexArray(this.vao);
    gl.bindFramebuffer(gl.FRAMEBUFFER, dst.fbo);
    gl.viewport(0, 0, TEX_W, this.rows);
    gl.disable(gl.BLEND);
    gl.useProgram(this.program.prog);
    bindTex(gl, 0, src.pos);
    bindTex(gl, 1, src.vel);
    this.seed = (this.seed + 1) >>> 0;
    setUniforms(gl, this.program, {
      ...uniforms,
      uPos: 0, uVel: 1, uWidth: TEX_W, uDt: dt, uTime: time,
      uReset: this.needsReset ? 1 : 0, uSeed: this.seed,
    });
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    this.cur = 1 - this.cur;
    if (this.needsReset) {
      this.needsReset = false;
      this.recordHistory(true);
    }
  }

  /** Writes the current position of TRAJ_N sampled particles into the history ring. */
  recordHistory(fill = false) {
    const gl = this.gl;
    const h = this.hist;
    gl.bindVertexArray(this.vao);
    gl.bindFramebuffer(gl.FRAMEBUFFER, h.fbo);
    if (fill) gl.viewport(0, 0, TRAJ_N, TRAJ_H);
    else {
      h.head = (h.head + 1) % TRAJ_H;
      gl.viewport(0, h.head, TRAJ_N, 1);
    }
    gl.useProgram(h.prog.prog);
    bindTex(gl, 0, this.state.pos);
    setUniforms(gl, h.prog, { uPos: 0, uWidth: TEX_W, uStride: Math.max(1, Math.floor(this.count / TRAJ_N)) });
    gl.drawArrays(gl.TRIANGLES, 0, 3);
  }
}
