import { Spring } from './spring';

/**
 * One ticker for every spring on the page; it sleeps when everything has settled.
 */
const live = new Set<SpringToggle>();
let raf = 0, last = 0;
function tick(now: number) {
  const dt = Math.min((now - last) / 1000, 1 / 30);
  last = now;
  for (const t of live) if (t.update(dt)) live.delete(t);
  raf = live.size ? requestAnimationFrame(tick) : 0;
}
function wake(t: SpringToggle) {
  live.add(t);
  if (!raf) { last = performance.now(); raf = requestAnimationFrame(tick); }
}

export interface ToggleOpts {
  w: number;        // natural frequency (rad/s)
  z: number;        // damping ratio
  checked?: boolean;
  label: string;
  draggable?: boolean;
}

/**
 * A switch whose knob is a damped spring. Position x is in "travel" units:
 * 0 = off, 1 = on, and it is allowed to go past either end.
 */
export class SpringToggle {
  el: HTMLButtonElement;
  knob: HTMLElement;
  pos: Spring;
  squash: Spring; // 0..1, how much the knob is stretched by a press
  checked: boolean;
  onMove: ((x: number, t: number) => void) | null = null;
  onChange: ((checked: boolean, from: { x: number; v: number }) => void) | null = null;
  onSettle: (() => void) | null = null;
  private suppressClick = false;

  constructor(host: HTMLElement, private o: ToggleOpts) {
    this.checked = !!o.checked;
    this.pos = new Spring(o.w, o.z, this.checked ? 1 : 0);
    this.squash = new Spring(32, 0.85, 0);
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'sw';
    b.setAttribute('role', 'switch');
    b.setAttribute('aria-label', o.label);
    b.innerHTML = '<span class="sw-knob"></span>';
    host.appendChild(b);
    this.el = b;
    this.knob = b.querySelector('.sw-knob')!;
    this.bind();
    this.paint();
  }

  setSpring(w: number, z: number) { this.pos.w = w; this.pos.z = z; this.o.w = w; this.o.z = z; }

  /** Flip state; the spring keeps whatever velocity it has. */
  toggle() { this.set(!this.checked); }
  set(on: boolean) {
    const from = { x: this.pos.x, v: this.pos.v };
    this.checked = on;
    this.pos.to(on ? 1 : 0);
    this.el.setAttribute('aria-checked', String(on));
    if ('vibrate' in navigator) try { navigator.vibrate(6); } catch { /* not allowed */ }
    this.onChange?.(on, from);
    wake(this);
  }

  /** Returns true when settled (so the ticker can drop it). */
  update(dt: number): boolean {
    if (!this.dragging) this.pos.step(dt);
    this.squash.step(dt);
    this.paint();
    this.onMove?.(this.pos.x, performance.now());
    const done = !this.dragging && this.pos.settled && this.squash.settled;
    if (done) { this.pos.snap(); this.squash.snap(); this.paint(); this.onSettle?.(); }
    return done;
  }

  private metrics() {
    const w = this.el.clientWidth, h = this.el.clientHeight;
    const pad = Math.round(h * 0.065);
    const k = h - pad * 2;
    return { pad, k, travel: w - pad * 2 - k, stretch: k * 0.22 };
  }

  paint() {
    const { pad, k, travel, stretch } = this.metrics();
    const x = this.pos.x;
    const grow = this.squash.x * stretch;
    // anchored so the stretched knob grows toward the open side of the track
    const anchor = Math.min(1, Math.max(0, x));
    this.knob.style.width = `${k + grow}px`;
    this.knob.style.transform = `translate3d(${pad + x * travel - grow * anchor}px, 0, 0)`;
    // colour is a function of position, never its own animation, so they can't disagree
    this.el.style.setProperty('--p', String(Math.min(1, Math.max(0, x))));
  }

  dragging = false;
  private bind() {
    const b = this.el;
    this.el.setAttribute('aria-checked', String(this.checked));
    let sx = 0, x0 = 0, moved = false;
    let samples: { t: number; x: number }[] = [];
    b.addEventListener('pointerdown', (e) => {
      if (e.button !== 0) return;
      sx = e.clientX;
      x0 = this.pos.x;
      moved = false;
      samples = [{ t: e.timeStamp, x: x0 }];
      this.squash.to(1); // anticipation: the knob gives under your finger
      wake(this);
      try { b.setPointerCapture(e.pointerId); } catch { /* synthetic */ }
    });
    b.addEventListener('pointermove', (e) => {
      if (!(e.buttons & 1) || !this.o.draggable) return;
      const { travel } = this.metrics();
      const dx = e.clientX - sx;
      if (!moved && Math.abs(dx) < 4) return;
      moved = true;
      this.dragging = true;
      let x = x0 + dx / travel;
      // rubber band past the ends: resistance grows the further you pull
      if (x > 1) x = 1 + (x - 1) / (1 + (x - 1) * 3) * 0.6;
      if (x < 0) x = -(-x / (1 + -x * 3)) * 0.6;
      this.pos.x = x;
      samples.push({ t: e.timeStamp, x });
      samples = samples.filter((s) => e.timeStamp - s.t < 80);
      this.paint();
      wake(this);
    });
    const up = (e: PointerEvent) => {
      this.squash.to(0);
      wake(this);
      if (!moved) return;
      // hand the finger's velocity to the spring
      const a = samples[0], z = samples[samples.length - 1];
      const raw = z && a && z.t > a.t ? ((z.x - a.x) / (z.t - a.t)) * 1000 : 0;
      const v = Math.max(-25, Math.min(25, raw)); // a flick, not a teleport
      this.dragging = false;
      this.pos.v = v;
      const projected = this.pos.x + v * 0.08;
      this.suppressClick = true;
      const on = projected > 0.5;
      if (on !== this.checked) this.set(on);
      else { this.pos.to(on ? 1 : 0); wake(this); }
      void e;
    };
    b.addEventListener('pointerup', up);
    b.addEventListener('pointercancel', up);
    b.addEventListener('click', () => {
      if (this.suppressClick) { this.suppressClick = false; return; }
      this.toggle();
    });
  }
}

/**
 * The control group: a plain CSS transition, for comparison. It restarts from
 * the current position with zero velocity every time it is interrupted.
 */
export class CssToggle {
  el: HTMLButtonElement;
  checked = false;
  constructor(host: HTMLElement, label: string, transition: string) {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'sw sw-css';
    b.setAttribute('role', 'switch');
    b.setAttribute('aria-checked', 'false');
    b.setAttribute('aria-label', label);
    b.innerHTML = '<span class="sw-knob"></span>';
    b.style.setProperty('--css-t', transition);
    host.appendChild(b);
    this.el = b;
    b.addEventListener('click', () => this.toggle());
  }
  toggle() {
    this.checked = !this.checked;
    this.el.setAttribute('aria-checked', String(this.checked));
  }
}
