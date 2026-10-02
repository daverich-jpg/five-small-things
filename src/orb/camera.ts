import { V3, M4, perspective, lookAt, mul, invert, xform4, norm, sub, add, scale, cross, clamp } from './math';

/**
 * Orbit camera with a little inertia. Inertia here is the same idea as drag in
 * the sim: you throw the camera and it coasts to rest on an exponential.
 */
export class OrbitCamera {
  target: V3 = [0, 0, 0];
  yaw = 0.55;
  pitch = 0.28;
  dist = 3.6;
  fov = (38 * Math.PI) / 180;
  vyaw = 0;
  vpitch = 0;
  width = 1;
  height = 1;
  view: M4 = new Float32Array(16);
  proj: M4 = new Float32Array(16);
  viewProj: M4 = new Float32Array(16);
  invViewProj: M4 = new Float32Array(16);
  idleSpin = 0; // rad/s drift used by the inline demo

  eye(): V3 {
    const cp = Math.cos(this.pitch);
    return add(this.target, [cp * Math.sin(this.yaw) * this.dist, Math.sin(this.pitch) * this.dist, cp * Math.cos(this.yaw) * this.dist]);
  }
  forward(): V3 { return norm(sub(this.target, this.eye())); }
  right(): V3 { return norm(cross(this.forward(), [0, 1, 0])); }
  up(): V3 { return cross(this.right(), this.forward()); }

  update(dt: number, w: number, h: number) {
    this.width = w;
    this.height = h;
    // coast: v decays with tau ≈ 0.12 s
    const k = Math.exp(-dt / 0.12);
    this.yaw += this.vyaw * dt + this.idleSpin * dt;
    this.pitch = clamp(this.pitch + this.vpitch * dt, -1.45, 1.45);
    this.vyaw *= k;
    this.vpitch *= k;
    this.view = lookAt(this.eye(), this.target, [0, 1, 0]);
    this.proj = perspective(this.fov, w / Math.max(h, 1), 0.03, 80);
    this.viewProj = mul(this.proj, this.view);
    this.invViewProj = invert(this.viewProj);
  }

  orbit(dx: number, dy: number, dt: number) {
    const s = 0.0065;
    this.yaw -= dx * s;
    this.pitch = clamp(this.pitch + dy * s, -1.45, 1.45);
    if (dt > 0) {
      this.vyaw = (-dx * s) / dt * 0.6;
      this.vpitch = (dy * s) / dt * 0.6;
    }
  }
  stopCoast() { this.vyaw = 0; this.vpitch = 0; }

  pan(dx: number, dy: number) {
    const s = (this.dist * Math.tan(this.fov / 2) * 2) / this.height;
    this.target = add(this.target, add(scale(this.right(), -dx * s), scale(this.up(), dy * s)));
  }

  zoom(f: number) { this.dist = clamp(this.dist * f, 0.6, 30); }

  /** World → CSS pixel coords within the viewport. */
  project(p: V3): { x: number; y: number; w: number; ok: boolean } {
    const c = xform4(this.viewProj, p[0], p[1], p[2], 1);
    if (c[3] <= 0.01) return { x: 0, y: 0, w: c[3], ok: false };
    return { x: (c[0] / c[3] * 0.5 + 0.5) * this.width, y: (1 - (c[1] / c[3] * 0.5 + 0.5)) * this.height, w: c[3], ok: true };
  }

  ray(x: number, y: number): { o: V3; d: V3 } {
    const nx = (x / this.width) * 2 - 1, ny = 1 - (y / this.height) * 2;
    const a = xform4(this.invViewProj, nx, ny, -1, 1);
    const b = xform4(this.invViewProj, nx, ny, 1, 1);
    const pa: V3 = [a[0] / a[3], a[1] / a[3], a[2] / a[3]];
    const pb: V3 = [b[0] / b[3], b[1] / b[3], b[2] / b[3]];
    return { o: pa, d: norm(sub(pb, pa)) };
  }

  /** CSS pixels per world unit at point p. */
  pxPerUnit(p: V3): number {
    const c = xform4(this.viewProj, p[0], p[1], p[2], 1);
    return (this.proj[5] * this.height * 0.5) / Math.max(c[3], 1e-3);
  }
}
