import { GL, Program, createProgram, createTexture, createFbo, setUniforms, bindTex, FULLSCREEN_VS, UVal } from './gl';
import { NOISE, COMMON, GLOBALS } from './glsl';
import { Sim, TEX_W, TRAJ_N, TRAJ_H } from './sim';
import { OrbitCamera } from './camera';

const PARTICLE_VS = /* glsl */ `#version 300 es
precision highp float;
precision highp int;
uniform sampler2D uPos;
uniform sampler2D uVel;
uniform sampler2D uAcc;
uniform int uWidth;
uniform mat4 uViewProj;
uniform vec2 uRes;
uniform float uProjScale;
uniform vec4 uLife;
uniform vec4 uSizeP;   // base, variation, dustVar
uniform vec4 uRender;  // size, opacity, brightness, speedGlow
uniform vec4 uTrail;   // length(s), width, opacity, threshold
uniform float uTrailOn;
uniform float uHue;
uniform int uColorMode;
uniform vec3 uCenter;
uniform float uR;
uniform float uDensityNorm;
${COMMON}
out vec2 vLocal;
out float vLen;
out float vRad;
out vec4 vCol;
const vec2 Q[4] = vec2[4](vec2(-1.0, -1.0), vec2(1.0, -1.0), vec2(-1.0, 1.0), vec2(1.0, 1.0));
const int SEG = 7;

vec3 hueRotate(vec3 c, float deg) {
  float a = radians(deg);
  vec3 k = vec3(0.57735);
  float ca = cos(a);
  return c * ca + cross(k, c) * sin(a) + k * dot(k, c) * (1.0 - ca);
}
vec3 heat(float t) {
  t = clamp(t, 0.0, 1.0);
  return clamp(vec3(1.6 * t - 0.4, sin(t * 3.14159) * 0.9 + t * 0.3, 1.0 - 1.4 * t + 0.5 * sin(t * 6.0)), 0.0, 1.0) * 1.4;
}

void main() {
  int id = gl_InstanceID;
  ivec2 c = ivec2(id % uWidth, id / uWidth);
  vec4 P = texelFetch(uPos, c, 0);
  vec4 V = texelFetch(uVel, c, 0);
  vec4 A = texelFetch(uAcc, c, 0);
  uint ui = uint(id);
  Pop pop = popFor(ui);
  vec4 h = hash4(uvec4(ui, 91u, 3u, 7u));
  vec4 head = uViewProj * vec4(P.xyz, 1.0);
  if (head.w < 0.05 || V.w <= 0.0) { gl_Position = vec4(2.0, 2.0, 2.0, 1.0); return; }

  float speed = length(V.xyz);
  float var = pop.type > 1.5 ? uSizeP.z : uSizeP.y;
  float size = uSizeP.x * pop.size * mix(1.0 - var * 0.6, 1.0 + var * 1.8, h.x * h.x * h.x) * uRender.x;
  float radTrue = size * uProjScale / head.w;
  float rad = max(radTrue, 0.75);

  // Trail: integrate the particle's own motion backwards, p(t) = p − v·t + ½·a·t²,
  // so streaks bend along their orbits instead of being straight dashes.
  float tl = uTrailOn > 0.5 ? uTrail.x * smoothstep(uTrail.w, uTrail.w * 1.8 + 0.6, speed) : 0.0;
  vec2 hp = head.xy / head.w * 0.5 * uRes;
  vec4 tail = uViewProj * vec4(P.xyz - V.xyz * tl + 0.5 * A.xyz * tl * tl, 1.0);
  vec2 tp = tail.w > 0.05 ? tail.xy / tail.w * 0.5 * uRes : hp;
  float len = min(length(hp - tp) * 1.05, 600.0);
  int vid = gl_VertexID;
  vec2 px;
  float wr = rad * mix(1.0, uTrail.y, smoothstep(0.0, 6.0, len));
  if (len < rad * 2.5) {
    // point: a soft disc
    vec2 q = Q[min(vid, 3)];
    px = hp + q * rad;
    vLocal = q * rad;
    vLen = 0.0;
    vRad = rad;
    wr = rad;
  } else {
    // ribbon: SEG segments from head (s=0) to tail (s=1), plus a rounded cap ahead of the head
    int seg = vid / 2;
    float side = float(vid % 2) * 2.0 - 1.0;
    float sv = float(seg) / float(SEG);
    vec2 pa, pb;
    {
      float t0 = tl * sv;
      float t1 = tl * min(sv + 1.0 / float(SEG), 1.0);
      float t2 = tl * max(sv - 1.0 / float(SEG), 0.0);
      vec4 c0 = uViewProj * vec4(P.xyz - V.xyz * t0 + 0.5 * A.xyz * t0 * t0, 1.0);
      vec4 c1 = uViewProj * vec4(P.xyz - V.xyz * t1 + 0.5 * A.xyz * t1 * t1, 1.0);
      vec4 c2 = uViewProj * vec4(P.xyz - V.xyz * t2 + 0.5 * A.xyz * t2 * t2, 1.0);
      pa = c0.xy / max(c0.w, 0.05) * 0.5 * uRes;
      vec2 n1 = c1.xy / max(c1.w, 0.05) * 0.5 * uRes;
      vec2 n2 = c2.xy / max(c2.w, 0.05) * 0.5 * uRes;
      pb = n2 - n1;
    }
    vec2 dir = length(pb) > 1e-3 ? normalize(pb) : vec2(1.0, 0.0);
    vec2 nrm = vec2(-dir.y, dir.x);
    float taper = mix(1.0, 0.35, sv);
    px = pa + nrm * side * wr * taper + (seg == 0 ? dir * wr : vec2(0.0));
    vLocal = vec2(sv * len, side * wr * taper);
    vLen = len;
    vRad = wr * taper;
  }
  gl_Position = vec4(px / (0.5 * uRes) * head.w, head.z, head.w);

  float age = P.w, life = V.w;
  float fade = smoothstep(0.0, max(uLife.z, 1e-3), age) * (1.0 - smoothstep(1.0 - max(uLife.w, 1e-3), 1.0, age / life));
  float dist = length(P.xyz - uCenter) / max(uR, 1e-3);
  fade *= 1.0 - smoothstep(1.6, 3.2, dist) * 0.85;

  float energy = smoothstep(0.2, 7.0, speed);
  vec3 col;
  if (uColorMode == 1) col = heat(speed / 10.0);
  else if (uColorMode == 2) col = heat(length(A.xyz) / 60.0);
  else {
    vec3 core = vec3(0.7, 0.9, 1.0);
    vec3 vort = vec3(0.12, 0.42, 1.0);
    vec3 dust = vec3(0.3, 0.42, 0.75);
    vec3 base = pop.type < 0.5 ? core : (pop.type < 1.5 ? vort : dust);
    vec3 hot = vec3(0.45, 0.82, 1.0);
    col = mix(base, hot, energy * 0.45);
    // depth inside the orb: material near the center glows a touch whiter
    col = mix(col, vec3(0.9, 0.97, 1.0), (1.0 - smoothstep(0.0, 0.45, dist)) * 0.4);
    col = hueRotate(col, uHue);
  }
  float bright = uRender.z * mix(0.32, 1.0 + uRender.w * 1.4, energy) * (pop.type > 1.5 ? 0.55 : 1.0);
  // energy conservation: a streak spreads the same light over more pixels
  float cons = mix(1.0, (2.0 * wr) / (2.0 * wr + len) * uTrail.z * 1.8, smoothstep(0.0, 3.0, len) * uTrailOn);
  float alpha = uRender.y * uDensityNorm * fade * cons * min(radTrue / 0.75, 1.0);
  vCol = vec4(col * bright, alpha);
}`;

const PARTICLE_FS = /* glsl */ `#version 300 es
precision highp float;
in vec2 vLocal;
in float vLen;
in float vRad;
in vec4 vCol;
out vec4 o;
void main() {
  float a;
  if (vLen <= 0.0) {
    float d = length(vLocal) / vRad;
    a = 1.0 - smoothstep(0.0, 1.0, d);
    a *= a;
  } else {
    float across = abs(vLocal.y) / max(vRad, 1e-3);
    a = 1.0 - smoothstep(0.0, 1.0, across);
    a *= a;
    a *= mix(1.0, 0.1, clamp(vLocal.x / vLen, 0.0, 1.0));   // bright head, fading tail
  }
  float k = vCol.a * a;
  o = vec4(vCol.rgb * k, k);
}`;

const DOWN_FS = /* glsl */ `#version 300 es
precision highp float;
uniform sampler2D uSrc;
uniform vec2 uTexel;
uniform float uThreshold;
uniform float uPrefilter;
in vec2 vUv;
out vec4 o;
void main() {
  vec2 t = uTexel;
  vec3 c = texture(uSrc, vUv).rgb * 4.0;
  c += texture(uSrc, vUv + vec2(-t.x, -t.y)).rgb;
  c += texture(uSrc, vUv + vec2(t.x, -t.y)).rgb;
  c += texture(uSrc, vUv + vec2(-t.x, t.y)).rgb;
  c += texture(uSrc, vUv + vec2(t.x, t.y)).rgb;
  c /= 8.0;
  if (uPrefilter > 0.5) {
    float br = max(c.r, max(c.g, c.b));
    float soft = clamp(br - uThreshold * 0.5, 0.0, uThreshold) ;
    soft = soft * soft / (4.0 * uThreshold + 1e-4);
    float w = max(soft, br - uThreshold) / max(br, 1e-4);
    c *= w;
  }
  o = vec4(c, 1.0);
}`;

const UP_FS = /* glsl */ `#version 300 es
precision highp float;
uniform sampler2D uSrc;
uniform vec2 uTexel;
uniform float uWeight;
in vec2 vUv;
out vec4 o;
void main() {
  vec2 t = uTexel;
  vec3 c = texture(uSrc, vUv + vec2(-t.x * 2.0, 0.0)).rgb;
  c += texture(uSrc, vUv + vec2(-t.x, t.y)).rgb * 2.0;
  c += texture(uSrc, vUv + vec2(0.0, t.y * 2.0)).rgb;
  c += texture(uSrc, vUv + vec2(t.x, t.y)).rgb * 2.0;
  c += texture(uSrc, vUv + vec2(t.x * 2.0, 0.0)).rgb;
  c += texture(uSrc, vUv + vec2(t.x, -t.y)).rgb * 2.0;
  c += texture(uSrc, vUv + vec2(0.0, -t.y * 2.0)).rgb;
  c += texture(uSrc, vUv + vec2(-t.x, -t.y)).rgb * 2.0;
  o = vec4(c / 12.0 * uWeight, 1.0);
}`;

const COMPOSITE_FS = /* glsl */ `#version 300 es
precision highp float;
uniform sampler2D uScene;
uniform sampler2D uBloom;
uniform vec4 uGlow;
uniform vec2 uRes;
uniform float uExposure;
uniform vec3 uBg;
in vec2 vUv;
out vec4 o;
vec3 aces(vec3 x) { return clamp((x * (2.51 * x + 0.03)) / (x * (2.43 * x + 0.59) + 0.14), 0.0, 1.0); }
void main() {
  vec3 s = texture(uScene, vUv).rgb;
  vec3 b = texture(uBloom, vUv).rgb;
  vec3 c = s + b * uGlow.x * uGlow.w;
  vec3 col = pow(aces(c * uExposure), vec3(1.0 / 2.2));
  // backdrop (already in display space): a faint radial lift so the orb sits in space
  vec2 p = (vUv - 0.5) * vec2(uRes.x / uRes.y, 1.0);
  float vig = smoothstep(1.1, 0.0, length(p));
  vec3 bg = uBg * (0.55 + 0.7 * vig);
  col = col + bg * (1.0 - max(col.r, max(col.g, col.b)));
  float n = fract(sin(dot(gl_FragCoord.xy, vec2(12.9898, 78.233))) * 43758.5453);
  o = vec4(col + (n - 0.5) / 255.0, 1.0);
}`;

// Debug: per-particle vectors (velocity or acceleration)
const VECTOR_VS = /* glsl */ `#version 300 es
precision highp float;
precision highp int;
uniform sampler2D uPos;
uniform sampler2D uVec;
uniform int uWidth;
uniform int uStride;
uniform mat4 uViewProj;
uniform float uScale;
uniform vec3 uColA;
uniform vec3 uColB;
uniform float uMaxLen;
out vec4 vCol;
void main() {
  int idx = gl_InstanceID * uStride + 11;
  ivec2 c = ivec2(idx % uWidth, idx / uWidth);
  vec3 p = texelFetch(uPos, c, 0).xyz;
  vec3 v = texelFetch(uVec, c, 0).xyz;
  float m = length(v);
  vec3 dv = v * uScale;
  float l = length(dv);
  if (l > uMaxLen) dv *= uMaxLen / l;
  vec3 q = gl_VertexID == 0 ? p : p + dv;
  gl_Position = uViewProj * vec4(q, 1.0);
  float t = clamp(m * uScale / uMaxLen, 0.0, 1.0);
  vCol = vec4(mix(uColA, uColB, t), gl_VertexID == 0 ? 0.08 : 0.85);
}`;

// Debug: field lattice — evaluates the *compiled* field functions on a grid
function latticeVS(lib: string) {
  return /* glsl */ `#version 300 es
precision highp float;
precision highp int;
uniform mat4 uViewProj;
uniform int uN;
uniform int uMode;
uniform float uScale;
uniform vec3 uCamRight;
${GLOBALS}
${COMMON}
${NOISE}
${lib}
out vec4 vCol;
void main() {
  int inst = gl_InstanceID;
  int n = uN;
  ivec3 g = ivec3(inst % n, (inst / n) % n, inst / (n * n));
  vec3 p = uCenter + (vec3(g) / float(n - 1) * 2.0 - 1.0) * uR * 1.15;
  Pop pop;
  pop.rot = 1.0; pop.turb = 1.0; pop.attract = 1.0; pop.drag = 1.0; pop.mass = 1.0; pop.conf = 1.0; pop.size = 1.0; pop.buoy = 1.0; pop.type = 1.0;
  vec3 f = uMode == 0 ? flowAt(p, pop) : (uMode == 1 ? noiseAt(p, pop) : radialAt(p, pop));
  float m = length(f);
  vec3 dir = f / max(m, 1e-5);
  float L = min(m * uScale, uR * 0.16);
  // shaft + two-line arrowhead
  vec3 tip = p + dir * L;
  vec3 side = normalize(cross(dir, uCamRight) + 1e-4) * L * 0.22;
  vec3 back = tip - dir * L * 0.35;
  int v = gl_VertexID;
  vec3 q = v == 0 ? p : (v == 1 ? tip : (v == 2 ? tip : (v == 3 ? back + side : (v == 4 ? tip : back - side))));
  gl_Position = uViewProj * vec4(q, 1.0);
  float inside = 1.0 - smoothstep(uR * 1.05, uR * 1.25, length(p - uCenter));
  vec3 col = uMode == 0 ? vec3(0.36, 0.78, 1.0) : (uMode == 1 ? vec3(0.62, 1.0, 0.7) : vec3(1.0, 0.72, 0.36));
  float a = (v == 0 ? 0.12 : 0.75) * inside * smoothstep(0.0, uR * 0.02, L);
  vCol = vec4(col, a);
}`;
}

const TRAJ_VS = /* glsl */ `#version 300 es
precision highp float;
precision highp int;
uniform sampler2D uHist;
uniform int uHead;
uniform int uH;
uniform mat4 uViewProj;
uniform float uR;
out vec4 vCol;
void main() {
  int s = gl_VertexID;
  int row = (uHead - s + uH * 4) % uH;
  int prev = (row - 1 + uH) % uH;
  vec3 p = texelFetch(uHist, ivec2(gl_InstanceID, row), 0).xyz;
  vec3 q = texelFetch(uHist, ivec2(gl_InstanceID, prev), 0).xyz;
  gl_Position = uViewProj * vec4(p, 1.0);
  float jump = step(uR * 0.6, distance(p, q));
  float hue = float(gl_InstanceID) * 0.618;
  vec3 col = 0.55 + 0.45 * cos(6.2831 * (hue + vec3(0.0, 0.33, 0.67)));
  vCol = vec4(mix(col, vec3(1.0), 0.35), (1.0 - float(s) / float(uH)) * 0.9 * (1.0 - jump));
}`;

const COLOR_FS = /* glsl */ `#version 300 es
precision highp float;
in vec4 vCol;
out vec4 o;
void main() { o = vCol; }`;

const LINE_VS = /* glsl */ `#version 300 es
precision highp float;
in vec3 aPos;
in vec4 aCol;
uniform mat4 uViewProj;
out vec4 vCol;
void main() { gl_Position = uViewProj * vec4(aPos, 1.0); vCol = aCol; }`;

const POINT_VS = /* glsl */ `#version 300 es
precision highp float;
in vec3 aPos;
in vec4 aCol;
in float aSize;
uniform mat4 uViewProj;
uniform float uDpr;
out vec4 vCol;
void main() { gl_Position = uViewProj * vec4(aPos, 1.0); gl_PointSize = aSize * uDpr; vCol = aCol; }`;

const POINT_FS = /* glsl */ `#version 300 es
precision highp float;
in vec4 vCol;
out vec4 o;
void main() {
  float r = length(gl_PointCoord * 2.0 - 1.0);
  float a = 1.0 - smoothstep(0.82, 1.0, r);
  o = vec4(mix(vCol.rgb, vec3(0.04, 0.05, 0.07), smoothstep(0.52, 0.66, r)), vCol.a * a);
}`;

export interface DebugFlags {
  velocity: boolean;
  force: boolean;
  trajectories: boolean;
  axis: boolean;
  boundary: boolean;
  flow: boolean;
  noise: boolean;
  radial: boolean;
  colorMode: 0 | 1 | 2;
  vectorScale: number;
}

export class Overlay {
  lines: number[] = [];
  points: number[] = [];
  line(a: number[], b: number[], c: number[]) {
    this.lines.push(a[0], a[1], a[2], c[0], c[1], c[2], c[3], b[0], b[1], b[2], c[0], c[1], c[2], c[3]);
  }
  point(p: number[], c: number[], size: number) {
    this.points.push(p[0], p[1], p[2], c[0], c[1], c[2], c[3], size);
  }
  clear() { this.lines.length = 0; this.points.length = 0; }
}

export class Renderer {
  gl: GL;
  w = 1;
  h = 1;
  scene!: { tex: WebGLTexture; fbo: WebGLFramebuffer };
  mips: { tex: WebGLTexture; fbo: WebGLFramebuffer; w: number; h: number }[] = [];
  pParticle: Program;
  pDown: Program;
  pUp: Program;
  pComposite: Program;
  pVector: Program;
  pTraj: Program;
  pLine: Program;
  pPoint: Program;
  pLattice: Program | null = null;
  vao: WebGLVertexArrayObject;
  lineVao: WebGLVertexArrayObject;
  lineBuf: WebGLBuffer;
  pointVao: WebGLVertexArrayObject;
  pointBuf: WebGLBuffer;
  exposure = 1.0;
  bg: number[] = [0.03, 0.04, 0.065];

  constructor(gl: GL) {
    this.gl = gl;
    this.pParticle = createProgram(gl, PARTICLE_VS, PARTICLE_FS);
    this.pDown = createProgram(gl, FULLSCREEN_VS, DOWN_FS);
    this.pUp = createProgram(gl, FULLSCREEN_VS, UP_FS);
    this.pComposite = createProgram(gl, FULLSCREEN_VS, COMPOSITE_FS);
    this.pVector = createProgram(gl, VECTOR_VS, COLOR_FS);
    this.pTraj = createProgram(gl, TRAJ_VS, COLOR_FS);
    this.pLine = createProgram(gl, LINE_VS, COLOR_FS);
    this.pPoint = createProgram(gl, POINT_VS, POINT_FS);
    this.vao = gl.createVertexArray()!;

    const mkDyn = (prog: Program, layout: [string, number][]) => {
      const vao = gl.createVertexArray()!;
      const buf = gl.createBuffer()!;
      gl.bindVertexArray(vao);
      gl.bindBuffer(gl.ARRAY_BUFFER, buf);
      const stride = layout.reduce((s, [, n]) => s + n, 0) * 4;
      let off = 0;
      for (const [name, n] of layout) {
        const loc = gl.getAttribLocation(prog.prog, name);
        if (loc >= 0) {
          gl.enableVertexAttribArray(loc);
          gl.vertexAttribPointer(loc, n, gl.FLOAT, false, stride, off);
        }
        off += n * 4;
      }
      gl.bindVertexArray(null);
      return { vao, buf };
    };
    const l = mkDyn(this.pLine, [['aPos', 3], ['aCol', 4]]);
    this.lineVao = l.vao; this.lineBuf = l.buf;
    const p = mkDyn(this.pPoint, [['aPos', 3], ['aCol', 4], ['aSize', 1]]);
    this.pointVao = p.vao; this.pointBuf = p.buf;
  }

  setLibrary(lib: string) {
    const p = createProgram(this.gl, latticeVS(lib), COLOR_FS);
    if (this.pLattice) this.gl.deleteProgram(this.pLattice.prog);
    this.pLattice = p;
  }

  resize(w: number, h: number) {
    if (w === this.w && h === this.h && this.scene) return;
    const gl = this.gl;
    this.w = w; this.h = h;
    if (this.scene) {
      gl.deleteTexture(this.scene.tex); gl.deleteFramebuffer(this.scene.fbo);
      this.mips.forEach((m) => { gl.deleteTexture(m.tex); gl.deleteFramebuffer(m.fbo); });
    }
    const st = createTexture(gl, w, h, gl.RGBA16F, gl.RGBA, gl.HALF_FLOAT, gl.LINEAR);
    this.scene = { tex: st, fbo: createFbo(gl, [st]) };
    this.mips = [];
    let mw = w, mh = h;
    for (let i = 0; i < 6; i++) {
      mw = Math.max(1, mw >> 1); mh = Math.max(1, mh >> 1);
      const t = createTexture(gl, mw, mh, gl.RGBA16F, gl.RGBA, gl.HALF_FLOAT, gl.LINEAR);
      this.mips.push({ tex: t, fbo: createFbo(gl, [t]), w: mw, h: mh });
    }
  }

  render(sim: Sim, cam: OrbitCamera, u: Record<string, UVal>, dpr: number, debug: DebugFlags | null, overlay: Overlay | null) {
    const gl = this.gl;
    gl.bindVertexArray(this.vao);
    const st = sim.state;

    // 1 — particles into HDR scene
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.scene.fbo);
    gl.viewport(0, 0, this.w, this.h);
    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT);
    const renderOn = (u.uRender as number[])[1] > 0;
    if (renderOn) {
      gl.enable(gl.BLEND);
      gl.blendFunc(gl.ONE, gl.ONE);
      gl.useProgram(this.pParticle.prog);
      bindTex(gl, 0, st.pos); bindTex(gl, 1, st.vel); bindTex(gl, 2, st.acc);
      setUniforms(gl, this.pParticle, {
        ...u, uPos: 0, uVel: 1, uAcc: 2, uWidth: TEX_W, uViewProj: cam.viewProj,
        uRes: [this.w, this.h], uProjScale: cam.proj[5] * this.h * 0.5, uColorMode: debug ? debug.colorMode : 0,
        // same total light at any particle count: more particles = smoother, not brighter
        uDensityNorm: Math.pow(65536 / sim.count, 0.85) * 0.55,
      });
      gl.drawArraysInstanced(gl.TRIANGLE_STRIP, 0, 16, sim.count); // 2 × (SEG + 1) vertices
    }

    // 2 — bloom (dual filter)
    const glow = u.uGlow as number[];
    const glowOn = glow[3] > 0 && glow[0] > 0;
    if (glowOn) {
      gl.disable(gl.BLEND);
      gl.useProgram(this.pDown.prog);
      let src = this.scene.tex, sw = this.w, sh = this.h;
      this.mips.forEach((m, i) => {
        gl.bindFramebuffer(gl.FRAMEBUFFER, m.fbo);
        gl.viewport(0, 0, m.w, m.h);
        bindTex(gl, 0, src);
        setUniforms(gl, this.pDown, { uSrc: 0, uTexel: [0.5 / sw, 0.5 / sh], uThreshold: glow[2], uPrefilter: i === 0 ? 1 : 0 });
        gl.drawArrays(gl.TRIANGLES, 0, 3);
        src = m.tex; sw = m.w; sh = m.h;
      });
      gl.enable(gl.BLEND);
      gl.blendFunc(gl.ONE, gl.ONE);
      gl.useProgram(this.pUp.prog);
      for (let i = this.mips.length - 1; i > 0; i--) {
        const from = this.mips[i], to = this.mips[i - 1];
        gl.bindFramebuffer(gl.FRAMEBUFFER, to.fbo);
        gl.viewport(0, 0, to.w, to.h);
        bindTex(gl, 0, from.tex);
        // radius: how much the wide (low-res) levels contribute
        const wgt = 0.35 + glow[1] * 1.1;
        setUniforms(gl, this.pUp, { uSrc: 0, uTexel: [0.5 / from.w, 0.5 / from.h], uWeight: wgt });
        gl.drawArrays(gl.TRIANGLES, 0, 3);
      }
    }

    // 3 — composite to screen
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.viewport(0, 0, this.w, this.h);
    gl.disable(gl.BLEND);
    gl.useProgram(this.pComposite.prog);
    bindTex(gl, 0, this.scene.tex);
    bindTex(gl, 1, this.mips[0].tex);
    setUniforms(gl, this.pComposite, {
      uScene: 0, uBloom: 1, uGlow: glowOn ? [glow[0] * 0.55, glow[1], glow[2], 1] : [0, 0, 0, 0],
      uRes: [this.w, this.h], uExposure: this.exposure, uBg: this.bg,
    });
    gl.drawArrays(gl.TRIANGLES, 0, 3);

    // 4 — debug layers + gizmos (crisp, after tonemapping)
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
    if (debug) {
      const vecDraw = (tex: WebGLTexture, scale: number, a: number[], b: number[]) => {
        gl.useProgram(this.pVector.prog);
        bindTex(gl, 0, st.pos); bindTex(gl, 1, tex);
        const n = Math.min(2600, sim.count);
        setUniforms(gl, this.pVector, {
          uPos: 0, uVec: 1, uWidth: TEX_W, uStride: Math.max(1, Math.floor(sim.count / n)), uViewProj: cam.viewProj,
          uScale: scale * debug.vectorScale, uColA: a, uColB: b, uMaxLen: (u.uR as number) * 0.5,
        });
        gl.drawArraysInstanced(gl.LINES, 0, 2, n);
      };
      if (debug.velocity) vecDraw(st.vel, 0.05, [0.2, 0.5, 1], [0.6, 1, 1]);
      if (debug.force) vecDraw(st.acc, 0.006, [1, 0.35, 0.6], [1, 0.85, 0.4]);
      if (debug.trajectories) {
        gl.useProgram(this.pTraj.prog);
        bindTex(gl, 0, sim.hist.tex);
        setUniforms(gl, this.pTraj, { uHist: 0, uHead: sim.hist.head, uH: TRAJ_H, uViewProj: cam.viewProj, uR: u.uR });
        gl.drawArraysInstanced(gl.LINE_STRIP, 0, TRAJ_H, TRAJ_N);
      }
      if ((debug.noise || debug.radial || debug.flow) && this.pLattice) {
        gl.useProgram(this.pLattice.prog);
        const modes: number[] = [];
        if (debug.flow) modes.push(0);
        if (debug.noise) modes.push(1);
        if (debug.radial) modes.push(2);
        for (const m of modes) {
          setUniforms(gl, this.pLattice, {
            ...u, uViewProj: cam.viewProj, uN: 11, uMode: m, uScale: (m === 2 ? 0.04 : 0.05) * debug.vectorScale, uCamRight: cam.right(),
          });
          gl.drawArraysInstanced(gl.LINES, 0, 6, 11 * 11 * 11);
        }
      }
    }
    if (overlay) {
      if (overlay.lines.length) {
        gl.useProgram(this.pLine.prog);
        setUniforms(gl, this.pLine, { uViewProj: cam.viewProj });
        gl.bindVertexArray(this.lineVao);
        gl.bindBuffer(gl.ARRAY_BUFFER, this.lineBuf);
        gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(overlay.lines), gl.DYNAMIC_DRAW);
        gl.drawArrays(gl.LINES, 0, overlay.lines.length / 7);
      }
      if (overlay.points.length) {
        gl.useProgram(this.pPoint.prog);
        setUniforms(gl, this.pPoint, { uViewProj: cam.viewProj, uDpr: dpr });
        gl.bindVertexArray(this.pointVao);
        gl.bindBuffer(gl.ARRAY_BUFFER, this.pointBuf);
        gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(overlay.points), gl.DYNAMIC_DRAW);
        gl.drawArrays(gl.POINTS, 0, overlay.points.length / 8);
      }
      gl.bindVertexArray(this.vao);
    }
    gl.disable(gl.BLEND);
  }
}
