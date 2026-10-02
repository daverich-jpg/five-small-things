import { advance } from '../toggle/spring';

/** UIScrollView "normal" deceleration rate: the flick projection Apple uses for fluid interfaces. */
export const DECEL = 0.998;
/** Distance a flick at v px/s would coast: v/1000 · r/(1 − r). */
export const project = (v: number, r = DECEL) => (v / 1000) * (r / (1 - r));
/** Rubber band past an edge: (1 − 1/(x·c/d + 1)) · d. Resistance grows the further you pull. */
export const rubber = (x: number, d: number, c = 0.55) => (1 - 1 / ((x * c) / d + 1)) * d;

export type Handoff = 'spring' | 'css';

export interface Sample { t: number; y: number }

/** Least-squares slope (px/s) of samples in the trailing window; 0 if the finger came to rest. */
export function fingerVelocity(s: Sample[], at: number, windowMs = 80) {
  const w = s.filter((p) => at - p.t <= windowMs);
  if (w.length < 2 || at - w[w.length - 1].t > 50) return 0;
  const n = w.length;
  const mt = w.reduce((a, p) => a + p.t, 0) / n, my = w.reduce((a, p) => a + p.y, 0) / n;
  let num = 0, den = 0;
  for (const p of w) { num += (p.t - mt) * (p.y - my); den += (p.t - mt) ** 2; }
  return den > 0 ? (num / den) * 1000 : 0;
}

export interface Release { t: number; y: number; v: number; projected: number; target: number; handoff: Handoff; w: number; z: number; carry: number }

/**
 * A bottom sheet whose position is a spring that inherits the finger's velocity.
 * y is the sheet's top edge in px from the top of the phone screen.
 */
export class Sheet {
  y: number;
  v = 0;
  target: number;
  w = 15;      // rad/s → response ≈ 0.42 s
  z = 0.86;    // a hint of overshoot, only when a fast flick brings velocity in
  handoff: Handoff = 'spring';
  decel = DECEL; // deceleration rate per ms used to project a flick
  carry = 1;     // share of the finger's velocity handed to the spring
  showProjection = true;
  snaps: number[] = [];
  dragging = false;
  samples: Sample[] = [];
  onFrame: ((y: number, now: number) => void) | null = null;
  onRelease: ((r: Release) => void) | null = null;
  onSettle: (() => void) | null = null;
  private raf = 0;
  private last = 0;
  private ghost: HTMLElement;

  constructor(public screen: HTMLElement, public el: HTMLElement) {
    this.ghost = screen.querySelector('.sh-ghost')!;
    this.layout();
    this.y = this.target = this.snaps[1];
    this.paint();
    new ResizeObserver(() => { const i = this.nearest(this.target); this.layout(); this.y = this.target = this.snaps[i]; this.paint(); }).observe(screen);
    this.bind();
  }

  get H() { return this.screen.clientHeight; }
  layout() { const H = this.H; this.snaps = [H * 0.08, H * 0.5, H * 0.8]; }
  private nearest(y: number) {
    let best = 0;
    this.snaps.forEach((s, i) => { if (Math.abs(s - y) < Math.abs(this.snaps[best] - y)) best = i; });
    return best;
  }

  /** Clamp a raw finger position into the sheet's range, with rubber banding past either end. */
  constrain(raw: number) {
    const lo = this.snaps[0], hi = this.snaps[this.snaps.length - 1], d = this.H * 0.3;
    if (raw < lo) return lo - rubber(lo - raw, d);
    if (raw > hi) return hi + rubber(raw - hi, d);
    return raw;
  }

  paint() {
    this.el.style.transform = `translate3d(0, ${this.y}px, 0)`;
    // the backdrop dims as a function of position, never on its own timeline
    const p = 1 - (this.y - this.snaps[0]) / (this.snaps[this.snaps.length - 1] - this.snaps[0]);
    this.screen.style.setProperty('--open', String(Math.min(1, Math.max(0, p))));
  }

  // ── gesture ───────────────────────────────────────────
  private start = { y: 0, py: 0 };
  begin(py: number, t: number) {
    this.stopCss();
    this.dragging = true;
    this.start = { y: this.y, py };
    this.v = 0;
    this.samples = [{ t, y: this.y }];
    this.el.classList.add('grabbed');
    this.wake();
  }
  move(py: number, t: number) {
    if (!this.dragging) return;
    this.y = this.constrain(this.start.y + (py - this.start.py));
    this.samples.push({ t, y: this.y });
    if (this.samples.length > 60) this.samples.shift();
    if (this.showProjection) {
      const v = fingerVelocity(this.samples, t);
      const p = this.y + project(v, this.decel);
      (this.ghost.querySelector('.sh-snap') as HTMLElement).style.transform = `translate3d(0, ${this.snaps[this.nearest(p)]}px, 0)`;
      (this.ghost.querySelector('.sh-proj') as HTMLElement).style.transform = `translate3d(0, ${Math.max(-40, Math.min(this.H + 40, p))}px, 0)`;
      this.ghost.classList.add('on');
    }
    this.paint();
  }
  end(t: number) {
    if (!this.dragging) return;
    this.dragging = false;
    this.el.classList.remove('grabbed');
    this.ghost.classList.remove('on');
    const v = fingerVelocity(this.samples, t);
    const projected = this.y + project(v, this.decel);
    const target = this.snaps[this.nearest(projected)];
    this.onRelease?.({ t, y: this.y, v, projected, target, handoff: this.handoff, w: this.w, z: this.z, carry: this.carry });
    // the spring's clock starts at the moment of release, not at the last frame
    this.last = Math.min(t, performance.now());
    this.goTo(target, v * this.carry);
  }

  /** Move to a snap. In spring mode the motion starts at velocity v; CSS mode always starts from rest. */
  goTo(target: number, v = 0) {
    this.target = target;
    if (this.handoff === 'spring') {
      this.v = v;
      this.wake();
    } else {
      this.v = 0;
      this.el.style.transition = 'transform 300ms ease';
      this.y = target;
      this.paint();
      this.wake(); // still sample the painted position so it can be measured
      setTimeout(() => this.stopCss(), 320);
    }
  }
  private stopCss() {
    if (!this.el.style.transition) return;
    // freeze wherever the transition actually is, so a grab mid-flight doesn't jump
    const painted = this.el.getBoundingClientRect().top - this.screen.getBoundingClientRect().top;
    this.el.style.transition = '';
    this.y = painted;
    this.paint();
  }

  step(index: -1 | 1) {
    const i = Math.min(this.snaps.length - 1, Math.max(0, this.nearest(this.target) + index));
    this.goTo(this.snaps[i], 0);
  }

  // ── ticker ────────────────────────────────────────────
  private wake() {
    if (this.raf) return;
    this.last = performance.now();
    const tick = (now: number) => {
      const dt = Math.min((now - this.last) / 1000, 1 / 30);
      this.last = now;
      if (!this.dragging && this.handoff === 'spring' && !this.el.style.transition) {
        const [d, v] = advance(this.y - this.target, this.v, this.w, this.z, dt);
        this.y = this.target + d;
        this.v = v;
        this.paint();
      }
      this.onFrame?.(this.paintedY(), now);
      const settled = !this.dragging && !this.el.style.transition && Math.abs(this.y - this.target) < 0.05 && Math.abs(this.v) < 1;
      if (settled) {
        this.y = this.target; this.v = 0; this.paint();
        this.raf = 0;
        this.onSettle?.();
        return;
      }
      this.raf = requestAnimationFrame(tick);
    };
    this.raf = requestAnimationFrame(tick);
  }

  paintedY() { return this.el.getBoundingClientRect().top - this.screen.getBoundingClientRect().top; }

  private bind() {
    const el = this.el;
    el.addEventListener('pointerdown', (e) => {
      if (e.button !== 0 || (e.target as HTMLElement).closest('a, input')) return;
      try { el.setPointerCapture(e.pointerId); } catch { /* synthetic */ }
      this.begin(e.clientY, e.timeStamp);
    });
    el.addEventListener('pointermove', (e) => {
      if (!this.dragging) return;
      // coalesced events: every sample the hardware delivered, not one per frame
      const evs = (e as any).getCoalescedEvents?.() as PointerEvent[] | undefined;
      for (const c of evs && evs.length ? evs : [e]) this.move(c.clientY, c.timeStamp);
    });
    const up = (e: PointerEvent) => this.end(e.timeStamp);
    el.addEventListener('pointerup', up);
    el.addEventListener('pointercancel', up);
    const grab = el.querySelector<HTMLButtonElement>('.sh-grabber')!;
    grab.addEventListener('keydown', (e) => {
      if (e.key === 'ArrowUp') { this.step(-1); e.preventDefault(); }
      if (e.key === 'ArrowDown') { this.step(1); e.preventDefault(); }
    });
    grab.addEventListener('click', (e) => {
      if (e.detail === 0) { // keyboard activation: cycle snaps
        const i = this.nearest(this.target);
        this.goTo(this.snaps[i === 0 ? 2 : i - 1]);
      }
    });
  }
}
