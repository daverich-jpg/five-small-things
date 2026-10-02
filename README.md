# Five Small Things

One page, five components, one obsession each. Every component gets a live demo, the curve and duration it runs on, and a few sentences on why.

```bash
npm install
npm run dev        # http://localhost:5210  (append #lab to open the editor directly)
```

Vite + TypeScript + raw WebGL2, no runtime dependencies. `?motion=1` forces motion when the OS asks for reduced motion.

## 01 — The Orb (obsession: lag)

A real-time particle/velocity-field simulation, not an animation. Each particle has position, velocity, acceleration, age and lifespan in float textures. Mass, size, density and population (core / vortex / dust) are hashed from its index, so the sim and the renderer agree without extra memory.

**Integration** (`src/orb/sim.ts`): fixed 1/120 s step, semi-implicit Euler, up to 8 steps per frame. Drag is solved implicitly, `v′ = (v + dt·A/m) / (1 + dt·k/m)`, so any drag coefficient is stable.

**Forces** (`src/orb/graph.ts`, compiled to GLSL):
- **Vortex**: `ω × r` with a solid-body → Lamb–Oseen profile, plus Hill's spherical vortex (poloidal circulation) and a divergence-free stagnation-point inflow.
- **Drag**: `k·(u − v)` plus the Maxey–Riley pressure-gradient term `m·(ρf/ρp)·Du/Dt`, central-differenced along the particle path. Without it, every vortex is a centrifuge.
- **Curl noise / Turbulence**: curl of three simplex potentials with analytic gradients, so the flow is divergence-free and swirls instead of jittering.
- **Radial force** (inward / outward / center attraction / repulsion), gravity, attractor, repulsor.
- **Soft spherical confinement**: a restoring field with damping that lets go past an escape threshold.

**The node graph is the simulation.** Wiring nodes regenerates the GLSL (`compile()` in `graph.ts`). Parameters are uniforms, so dragging a slider never recompiles. Ports are typed: `flow` is a velocity and has to go through Drag, while `force` goes straight into the Particle System. Wrong wires are flagged with the reason.

**The documentation measures itself.** "Yank the spin" steps the vortex and reads 2,048 particle velocities back from the GPU every frame (`src/orb/probe.ts`). It plots the measured response over the predicted `1 − e^(−t/τ)` and reports the measured τ, the 95% settle time and the overshoot. With pressure coupling off, measured τ matches `m/k` (0.40 s); with it on, particles catch up faster, and the page says so.

**Lab** (`#lab`): toolbar, viewport with gizmos (vortex axis and core radius, orb center and radius, radial influence, gravity direction, attractor positions), an inspector where every value has a slider, a scrubbable number, reset and a keyframe toggle, a node graph, a keyframe timeline, a physics debug layer (velocity/force vectors, trajectories, flow/noise/radial fields, velocity/acceleration colouring) and six presets.

Tuning probes for the console: `const d = await import('/src/orb/dev.ts'); d.trial(0); d.shape()`.

## 02 — The Toggle (obsession: overshoot, and how little you need)

A switch whose knob is a damped spring (`src/toggle/`), advanced with the exact closed-form solution, so it's frame-rate independent and has no integrator error. Retargeting keeps position *and* velocity, so tapping mid-flight turns the knob around instead of restarting it.

- **Default:** 8% overshoot → ζ = 0.63, ω = 22.4 rad/s (k = 502, c = 28.1, unit mass). It peaks at 180 ms and settles within ±2% by 268 ms. On a real 51 pt switch, 8% is 1.6 px.
- **Details:** the knob stretches 22% under the finger (anticipation), drags with rubber-banding, and hands the flick velocity to the spring. Track colour is a `color-mix` of knob position, never its own animation.
- **Comparison row:** CSS `300ms ease` vs springs at 0%, 8% and 30%, all at the same speed. "Double-tap all four" shows CSS restarting from rest while the springs turn around.
- **Measured:** every toggle of the big switch reads the painted knob position back from the DOM each frame and plots it over the prediction. Drags and interruptions bend the prediction to the measured start position and velocity.
- **Exports:** the SwiftUI `.spring(response:dampingFraction:)` equivalent, and "Copy as CSS", which samples the same spring into a `linear()` easing.
- **Reduced motion:** ζ → 1, so there's no overshoot.

## 03 — The Sheet (obsession: the frame after you let go)

A bottom sheet in a phone frame (`src/sheet/`) with three snaps: full, half and peek.

- **Release velocity:** the least-squares slope of the last 80 ms of pointer samples, using coalesced events so every digitiser sample counts. It's zero if the finger rested for more than 50 ms before lifting.
- **Snap choice:** the nearest snap to the *projected* landing point, `y + v/1000 · r/(1 − r)` with r = 0.998 (UIScrollView's normal deceleration), not to where the finger stopped. While dragging, a ghost shows the projection and the snap it picks.
- **Hand-off:** an analytic spring (ω 15, ζ 0.86) starts at exactly the finger's velocity, with its clock anchored to the release timestamp. Past the ends, the drag rubber-bands with `(1 − 1/(x·0.55/d + 1))·d`.
- **Comparison:** switch the hand-off to `CSS 300ms ease` to feel the restart.
- **Measured:** finger velocity before release and *painted* sheet velocity after it (read from the DOM) on one graph, against the prediction. The page reports the sheet's velocity at the release instant, from a quadratic through the first three painted frames. In testing it carried 100–103% of the finger's speed.
- **Tune it live:** the Spring panel sets response, damping ζ, velocity carried (0–100% of the finger's speed handed to the spring) and the deceleration rate used for projection. A mini curve previews a 1,500 px/s throw under the current settings, and the spec and graph follow. Each recorded throw keeps the settings it was thrown with. Reduced motion only changes the default (ζ = 1); the slider always wins.
- **No mouse?** "Fling it for me" scripts a flick. The grabber also takes the arrow keys.

## 04–05

Not built yet.
