/**
 * A damped spring with unit mass, advanced with its exact closed-form solution.
 * No integrator error and no frame-rate dependence. Retargeting keeps position
 * *and* velocity, which is what makes an interrupted toggle turn around instead
 * of restarting.
 *
 *   x'' = −ω²(x − target) − 2ζω·x'      (k = ω², c = 2ζω)
 */

/** Advance displacement d and velocity v by t seconds. */
export function advance(d: number, v: number, w: number, z: number, t: number): [number, number] {
  if (z < 0.9999) {
    const wd = w * Math.sqrt(1 - z * z);
    const e = Math.exp(-z * w * t);
    const B = (v + z * w * d) / wd;
    const c = Math.cos(wd * t), s = Math.sin(wd * t);
    return [e * (d * c + B * s), e * ((B * wd - z * w * d) * c - (d * wd + z * w * B) * s)];
  }
  if (z <= 1.0001) {
    const C = v + w * d;
    const e = Math.exp(-w * t);
    return [(d + C * t) * e, (v - w * C * t) * e];
  }
  const q = Math.sqrt(z * z - 1);
  const r1 = -w * (z - q), r2 = -w * (z + q);
  const c2 = (v - r1 * d) / (r2 - r1), c1 = d - c2;
  const e1 = Math.exp(r1 * t), e2 = Math.exp(r2 * t);
  return [c1 * e1 + c2 * e2, c1 * r1 * e1 + c2 * r2 * e2];
}

export class Spring {
  x: number;
  v = 0;
  target: number;
  constructor(public w: number, public z: number, x = 0) {
    this.x = x;
    this.target = x;
  }
  to(target: number) { this.target = target; }
  step(dt: number) {
    const [d, v] = advance(this.x - this.target, this.v, this.w, this.z, dt);
    this.x = this.target + d;
    this.v = v;
  }
  get settled() { return Math.abs(this.x - this.target) < 2e-4 && Math.abs(this.v) < 2e-3; }
  snap() { this.x = this.target; this.v = 0; }
}

// ── design-side numbers ─────────────────────────────────

/** Overshoot fraction for a step response from rest. */
export const overshootOf = (z: number) => (z >= 1 ? 0 : Math.exp((-z * Math.PI) / Math.sqrt(1 - z * z)));
/** Damping ratio that produces a given overshoot fraction. */
export const zetaFor = (os: number) => {
  if (os <= 1e-4) return 1;
  const l = Math.log(os);
  return -l / Math.sqrt(Math.PI * Math.PI + l * l);
};

/** Step response 0 → 1 (optionally from x0 with velocity v0, both in travel units). */
export function response(w: number, z: number, t: number, x0 = 0, v0 = 0, target = 1) {
  return target + advance(x0 - target, v0, w, z, t)[0];
}

/** Peak time/overshoot and ±band settle time of the step response, found numerically (1 ms). */
export function characterize(w: number, z: number, band = 0.02) {
  let peak = 0, peakT = 0, settle = 0;
  for (let ms = 0; ms <= 4000; ms++) {
    const x = response(w, z, ms / 1000);
    if (x > peak) { peak = x; peakT = ms; }
    if (Math.abs(x - 1) > band) settle = ms + 1;
  }
  return { overshoot: Math.max(0, peak - 1), peakMs: peak > 1.0005 ? peakT : null, settleMs: settle };
}

/** The same spring as a CSS `linear()` easing, sampled until it is within 0.1% for good. */
export function cssLinear(w: number, z: number) {
  const end = characterize(w, z, 0.001).settleMs;
  const n = 48;
  const pts: string[] = [];
  for (let i = 0; i <= n; i++) {
    const x = response(w, z, ((i / n) * end) / 1000);
    pts.push((i === n ? 1 : x).toFixed(4).replace(/\.?0+$/, '') || '0');
  }
  return { duration: end, easing: `linear(${pts.join(', ')})` };
}
