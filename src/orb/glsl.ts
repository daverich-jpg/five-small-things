/**
 * Shared GLSL chunks. NOISE is Stefan Gustavson / Ashima's simplex noise with
 * analytic gradient (MIT, github.com/stegu/webgl-noise) — the gradient is what
 * makes curl noise cheap: curl(ψ) needs derivatives, not finite differences.
 */
export const NOISE = /* glsl */ `
vec3 mod289(vec3 x) { return x - floor(x * (1.0 / 289.0)) * 289.0; }
vec4 mod289(vec4 x) { return x - floor(x * (1.0 / 289.0)) * 289.0; }
vec4 permute(vec4 x) { return mod289(((x * 34.0) + 10.0) * x); }
vec4 taylorInvSqrt(vec4 r) { return 1.79284291400159 - 0.85373472095314 * r; }

float snoise(vec3 v, out vec3 gradient) {
  const vec2 C = vec2(1.0 / 6.0, 1.0 / 3.0);
  const vec4 D = vec4(0.0, 0.5, 1.0, 2.0);
  vec3 i = floor(v + dot(v, C.yyy));
  vec3 x0 = v - i + dot(i, C.xxx);
  vec3 g = step(x0.yzx, x0.xyz);
  vec3 l = 1.0 - g;
  vec3 i1 = min(g.xyz, l.zxy);
  vec3 i2 = max(g.xyz, l.zxy);
  vec3 x1 = x0 - i1 + C.xxx;
  vec3 x2 = x0 - i2 + C.yyy;
  vec3 x3 = x0 - D.yyy;
  i = mod289(i);
  vec4 p = permute(permute(permute(
            i.z + vec4(0.0, i1.z, i2.z, 1.0))
          + i.y + vec4(0.0, i1.y, i2.y, 1.0))
          + i.x + vec4(0.0, i1.x, i2.x, 1.0));
  float n_ = 0.142857142857;
  vec3 ns = n_ * D.wyz - D.xzx;
  vec4 j = p - 49.0 * floor(p * ns.z * ns.z);
  vec4 x_ = floor(j * ns.z);
  vec4 y_ = floor(j - 7.0 * x_);
  vec4 x = x_ * ns.x + ns.yyyy;
  vec4 y = y_ * ns.x + ns.yyyy;
  vec4 h = 1.0 - abs(x) - abs(y);
  vec4 b0 = vec4(x.xy, y.xy);
  vec4 b1 = vec4(x.zw, y.zw);
  vec4 s0 = floor(b0) * 2.0 + 1.0;
  vec4 s1 = floor(b1) * 2.0 + 1.0;
  vec4 sh = -step(h, vec4(0.0));
  vec4 a0 = b0.xzyw + s0.xzyw * sh.xxyy;
  vec4 a1 = b1.xzyw + s1.xzyw * sh.zzww;
  vec3 p0 = vec3(a0.xy, h.x);
  vec3 p1 = vec3(a0.zw, h.y);
  vec3 p2 = vec3(a1.xy, h.z);
  vec3 p3 = vec3(a1.zw, h.w);
  vec4 norm = taylorInvSqrt(vec4(dot(p0, p0), dot(p1, p1), dot(p2, p2), dot(p3, p3)));
  p0 *= norm.x; p1 *= norm.y; p2 *= norm.z; p3 *= norm.w;
  vec4 m = max(0.5 - vec4(dot(x0, x0), dot(x1, x1), dot(x2, x2), dot(x3, x3)), 0.0);
  vec4 m2 = m * m;
  vec4 m4 = m2 * m2;
  vec4 pdotx = vec4(dot(p0, x0), dot(p1, x1), dot(p2, x2), dot(p3, x3));
  vec4 temp = m2 * m * pdotx;
  gradient = -8.0 * (temp.x * x0 + temp.y * x1 + temp.z * x2 + temp.w * x3);
  gradient += m4.x * p0 + m4.y * p1 + m4.z * p2 + m4.w * p3;
  gradient *= 105.0;
  return 105.0 * dot(m4, pdotx);
}

float snoise1(vec3 v) { vec3 g; return snoise(v, g); }

// Curl of a vector potential made of three decorrelated noise fields.
// Divergence-free by construction, so it swirls instead of jittering.
vec3 curlAt(vec3 q, float evo) {
  vec3 g1, g2, g3;
  snoise(q + vec3(0.0, 0.0, evo), g1);
  snoise(q + vec3(31.416, -47.853, 12.793 + evo * 0.7), g2);
  snoise(q + vec3(-233.145 + evo * 0.9, -113.408, -185.31), g3);
  return vec3(g3.y - g2.z, g1.z - g3.x, g2.x - g1.y);
}

vec3 curlFbm(vec3 q, float evo, int oct, float lac, float gain) {
  vec3 s = vec3(0.0);
  float a = 1.0, f = 1.0, n = 0.0;
  for (int i = 0; i < 6; i++) {
    if (i >= oct) break;
    s += a * curlAt(q * f + float(i) * 19.19, evo * f);
    n += a;
    a *= gain;
    f *= lac;
  }
  return s / max(n, 1e-4);
}
`;

/**
 * Hashing and particle populations. Population is derived from the particle
 * index, so the simulation and the renderer agree without a lookup texture,
 * and changing the mix re-labels particles live.
 */
export const COMMON = /* glsl */ `
uniform vec2 uMix;        // core fraction, dust fraction
uniform float uMassScale;
uniform vec4 uPopA0, uPopA1, uPopA2; // rot, turb, attract, drag
uniform vec4 uPopB0, uPopB1, uPopB2; // mass, confinement, size, fluid/particle density

struct Pop { float rot; float turb; float attract; float drag; float mass; float conf; float size; float buoy; float type; };

uvec4 pcg4d(uvec4 v) {
  v = v * 1664525u + 1013904223u;
  v.x += v.y * v.w; v.y += v.z * v.x; v.z += v.x * v.y; v.w += v.y * v.z;
  v ^= v >> 16u;
  v.x += v.y * v.w; v.y += v.z * v.x; v.z += v.x * v.y; v.w += v.y * v.z;
  return v;
}
vec4 hash4(uvec4 v) { return vec4(pcg4d(v) >> 8u) / 16777216.0; }

Pop popFor(uint i) {
  vec4 h = hash4(uvec4(i, 17u, 3u, 11u));
  float t = h.x < uMix.x ? 0.0 : (h.x < 1.0 - uMix.y ? 1.0 : 2.0);
  vec4 a = t < 0.5 ? uPopA0 : (t < 1.5 ? uPopA1 : uPopA2);
  vec4 b = t < 0.5 ? uPopB0 : (t < 1.5 ? uPopB1 : uPopB2);
  Pop p;
  // per-particle variation so no two particles share a path
  p.rot = a.x * mix(0.82, 1.18, h.y);
  p.turb = a.y * mix(0.65, 1.35, h.z);
  p.attract = a.z * mix(0.85, 1.15, h.w);
  p.drag = a.w * mix(0.7, 1.3, fract(h.y * 7.31 + h.z));
  p.mass = b.x * uMassScale * mix(0.75, 1.3, fract(h.w * 5.17 + h.y));
  p.conf = b.y;
  p.size = b.z;
  p.buoy = b.w;
  p.type = t;
  return p;
}

struct F { vec3 a; float k; }; // force = a - k * v  (k is solved implicitly)
F fAdd(F x, F y) { return F(x.a + y.a, x.k + y.k); }
F fScale(F x, float s) { return F(x.a * s, x.k * s); }
`;

/** Uniforms every generated library may read. */
export const GLOBALS = /* glsl */ `
uniform float uTime;
uniform vec3 uCenter;
uniform float uR;
uniform float uConfOn;
uniform vec4 uConf; // strength, softness, damping, escape
`;
