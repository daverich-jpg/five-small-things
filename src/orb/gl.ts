export type GL = WebGL2RenderingContext;

export interface Program {
  prog: WebGLProgram;
  uniforms: Map<string, { loc: WebGLUniformLocation; type: number }>;
}

function compileShader(gl: GL, type: number, src: string): WebGLShader {
  const s = gl.createShader(type)!;
  gl.shaderSource(s, src);
  gl.compileShader(s);
  if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) {
    const log = gl.getShaderInfoLog(s) || '';
    gl.deleteShader(s);
    const lines = src.split('\n');
    const m = /ERROR: \d+:(\d+)/.exec(log);
    const ctx = m ? lines.slice(Math.max(0, +m[1] - 4), +m[1] + 2).map((l, i) => `${Math.max(1, +m[1] - 3) + i}: ${l}`).join('\n') : '';
    throw new Error(`Shader compile failed:\n${log}\n${ctx}`);
  }
  return s;
}

export function createProgram(gl: GL, vs: string, fs: string): Program {
  const p = gl.createProgram()!;
  const v = compileShader(gl, gl.VERTEX_SHADER, vs);
  const f = compileShader(gl, gl.FRAGMENT_SHADER, fs);
  gl.attachShader(p, v);
  gl.attachShader(p, f);
  gl.linkProgram(p);
  gl.deleteShader(v);
  gl.deleteShader(f);
  if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error('Program link failed: ' + gl.getProgramInfoLog(p));
  const uniforms = new Map<string, { loc: WebGLUniformLocation; type: number }>();
  const n = gl.getProgramParameter(p, gl.ACTIVE_UNIFORMS);
  for (let i = 0; i < n; i++) {
    const info = gl.getActiveUniform(p, i)!;
    const loc = gl.getUniformLocation(p, info.name);
    if (loc) uniforms.set(info.name.replace(/\[0\]$/, ''), { loc, type: info.type });
  }
  return { prog: p, uniforms };
}

export type UVal = number | number[] | Float32Array;

/** Set any subset of uniforms by name; names the program doesn't use are ignored. */
export function setUniforms(gl: GL, p: Program, values: Record<string, UVal>) {
  for (const name in values) {
    const u = p.uniforms.get(name);
    if (!u) continue;
    const v = values[name];
    switch (u.type) {
      case gl.FLOAT: gl.uniform1f(u.loc, v as number); break;
      case gl.FLOAT_VEC2: gl.uniform2fv(u.loc, v as number[]); break;
      case gl.FLOAT_VEC3: gl.uniform3fv(u.loc, v as number[]); break;
      case gl.FLOAT_VEC4: gl.uniform4fv(u.loc, v as number[]); break;
      case gl.INT: case gl.SAMPLER_2D: case gl.BOOL: gl.uniform1i(u.loc, v as number); break;
      case gl.UNSIGNED_INT: gl.uniform1ui(u.loc, v as number); break;
      case gl.FLOAT_MAT4: gl.uniformMatrix4fv(u.loc, false, v as Float32Array); break;
    }
  }
}

export function createTexture(gl: GL, w: number, h: number, internal: number, format: number, type: number, filter: number): WebGLTexture {
  const t = gl.createTexture()!;
  gl.bindTexture(gl.TEXTURE_2D, t);
  gl.texImage2D(gl.TEXTURE_2D, 0, internal, w, h, 0, format, type, null);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, filter);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, filter);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  return t;
}

export function createFbo(gl: GL, textures: WebGLTexture[]): WebGLFramebuffer {
  const f = gl.createFramebuffer()!;
  gl.bindFramebuffer(gl.FRAMEBUFFER, f);
  textures.forEach((t, i) => gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0 + i, gl.TEXTURE_2D, t, 0));
  gl.drawBuffers(textures.map((_, i) => gl.COLOR_ATTACHMENT0 + i));
  const status = gl.checkFramebufferStatus(gl.FRAMEBUFFER);
  gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  if (status !== gl.FRAMEBUFFER_COMPLETE) throw new Error('Framebuffer incomplete: 0x' + status.toString(16));
  return f;
}

export function bindTex(gl: GL, unit: number, t: WebGLTexture) {
  gl.activeTexture(gl.TEXTURE0 + unit);
  gl.bindTexture(gl.TEXTURE_2D, t);
}

export const FULLSCREEN_VS = /* glsl */ `#version 300 es
const vec2 P[3] = vec2[3](vec2(-1.0, -1.0), vec2(3.0, -1.0), vec2(-1.0, 3.0));
out vec2 vUv;
void main() {
  vec2 p = P[gl_VertexID];
  vUv = p * 0.5 + 0.5;
  gl_Position = vec4(p, 0.0, 1.0);
}`;
