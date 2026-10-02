import { Graph, GNode, Wire, makeNode } from './graph';

type P = Record<string, number>;
interface Spec {
  sphere?: P; vortex?: P; curl?: P; turb?: P | null; drag?: P; radial?: P | null; gravity?: P | null;
  system?: P; props?: P; life?: P; velocity?: P; prender?: P; trender?: P; glow?: P; repulsor?: P | null; center?: P | null;
}

/**
 * Every preset is the same kind of thing the user can build by hand: nodes,
 * wires, numbers. Nothing here animates anything.
 */
function build(s: Spec): Graph {
  const nodes: GNode[] = [];
  const wires: Wire[] = [];
  let w = 0;
  const add = (kind: string, id: string, x: number, y: number, p?: P) => { nodes.push(makeNode(kind, id, x, y, p)); };
  const wire = (from: string, to: string, port: string) => wires.push({ id: 'w' + w++, from: { node: from, port: 'out' }, to: { node: to, port } });

  add('sphere', 'sphere', 40, 30, s.sphere);
  add('props', 'props', 40, 200, s.props);
  add('lifetime', 'life', 40, 330, s.life);
  add('velocity', 'vel', 40, 460, s.velocity);
  add('vortex', 'vortex', 300, 30, s.vortex);
  add('curl', 'curl', 300, 160, s.curl);
  if (s.turb !== null) add('turbulence', 'turb', 300, 290, s.turb);
  add('drag', 'drag', 560, 90, s.drag);
  if (s.radial !== null) add('radial', 'radial', 560, 230, s.radial);
  if (s.center) add('radial', 'center', 560, 370, { mode: 2, ...s.center });
  if (s.gravity) add('gravity', 'gravity', 560, s.center ? 510 : 370, s.gravity);
  if (s.repulsor) add('repulsor', 'repulsor', 300, 420, s.repulsor);
  add('system', 'system', 820, 150, s.system);
  add('prender', 'prender', 1080, 40, s.prender);
  add('trender', 'trender', 1080, 170, s.trender);
  add('glow', 'glow', 1080, 300, s.glow);

  wire('sphere', 'system', 'source');
  wire('props', 'system', 'props');
  wire('life', 'system', 'props');
  wire('vel', 'system', 'props');
  wire('vortex', 'drag', 'flow');
  wire('curl', 'drag', 'flow');
  if (s.turb !== null) wire('turb', 'drag', 'flow');
  wire('drag', 'system', 'forces');
  if (s.radial !== null) wire('radial', 'system', 'forces');
  if (s.center) wire('center', 'system', 'forces');
  if (s.gravity) wire('gravity', 'system', 'forces');
  if (s.repulsor) wire('repulsor', 'system', 'forces');
  wire('system', 'prender', 'in');
  wire('system', 'trender', 'in');
  wire('system', 'glow', 'in');
  return { nodes, wires };
}

export const PRESETS: { name: string; note: string; graph: () => Graph }[] = [
  {
    name: 'Strong Rasengan',
    note: 'High spin, strong inward pull, moderate drag: a tightly wound core inside a ball of helical flow.',
    graph: () => build({
      sphere: { radius: 1, strength: 1.3, softness: 0.35, damping: 0.6, escape: 0.7 },
      vortex: { strength: 13, core: 0.42, falloff: 0.7, spiral: 0.08, poloidal: 0.15 },
      curl: { strength: 0.5, scale: 2.6, speed: 0.9, evolution: 0.5, octaves: 3 },
      turb: { strength: 0.14, scale: 1.4, falloff: 0.5 },
      drag: { coef: 0.42 },
      radial: { mode: 0, strength: 3, radius: 1.6, falloff: 0.3 },
      center: { strength: 4, radius: 2, falloff: 0.2 },
      props: { Catt: 6, Cdens: 0.9, Vdens: 1.15, Datt: 0.35, Dconf: 1 },
      trender: { length: 0.06, width: 0.75, opacity: 1, threshold: 1 },
      glow: { intensity: 1.1, radius: 0.7, threshold: 0.22 },
    }),
  },
  {
    name: 'Calm Vortex',
    note: 'Low spin, heavy drag. Particles follow the air almost exactly.',
    graph: () => build({
      sphere: { radius: 1, strength: 0.7, softness: 0.45 },
      vortex: { strength: 3.2, core: 0.7, falloff: 0.4, spiral: 0.05, poloidal: 0 },
      curl: { strength: 0.25, scale: 1.8, speed: 0.4, evolution: 0.2 },
      turb: null,
      drag: { coef: 0.8 },
      radial: { mode: 0, strength: 1.2 },
      trender: { length: 0.05, threshold: 1 },
      glow: { intensity: 0.7, radius: 0.55 },
    }),
  },
  {
    name: 'Chaotic Vortex',
    note: 'Turbulence well past 100%. The vortex is still in there — you can see it fighting.',
    graph: () => build({
      sphere: { radius: 1, strength: 1.4, softness: 0.4, escape: 0.6 },
      vortex: { strength: 8, core: 0.5, falloff: 0.6, spiral: 0.1, poloidal: 0.4 },
      curl: { strength: 1.4, scale: 2.2, speed: 1.2, evolution: 0.8, octaves: 3 },
      turb: { strength: 0.8, scale: 1.8, speed: 0.8, evolution: 0.9, octaves: 4, falloff: 0 },
      drag: { coef: 0.5, coupling: 0.5 },
      radial: { mode: 0, strength: 2 },
      trender: { length: 0.05 },
    }),
  },
  {
    name: 'Dust Storm',
    note: 'Low rotation + high turbulence + gravity = a drifting cloud. Weak walls; the heavy dust leaks out.',
    graph: () => build({
      sphere: { radius: 1.1, strength: 0.8, softness: 0.7, damping: 0.2, escape: 0.5 },
      vortex: { strength: 2.4, core: 0.9, falloff: 0.3, spiral: 0, poloidal: 0.2 },
      curl: { strength: 0.6, scale: 1.6, speed: 0.6, evolution: 0.4 },
      turb: { strength: 0.45, scale: 1.2, falloff: 0.6 },
      drag: { coef: 0.3, coupling: 0.6 },
      radial: null,
      gravity: { strength: 1.2, el: -90 },
      system: { core: 0.04, dust: 0.62 },
      prender: { opacity: 0.4, hue: 165, speedGlow: 0.4 },
      trender: { length: 0.04, threshold: 1.5 },
      glow: { intensity: 0.5 },
    }),
  },
  {
    name: 'Collapsing Orb',
    note: 'Inward pull beats the swirl’s spread. The orb implodes to a dense knot a sixth of its size.',
    graph: () => build({
      sphere: { radius: 1.1, strength: 0.6 },
      vortex: { strength: 6, core: 0.35, falloff: 0.85, spiral: 0.15, poloidal: 0.2 },
      curl: { strength: 0.35, scale: 3 },
      turb: null,
      drag: { coef: 0.18 },
      radial: { mode: 0, strength: 10, radius: 2.5, falloff: 0.2 },
      life: { min: 8, max: 18 },
      trender: { length: 0.07, threshold: 1.5 },
      glow: { intensity: 1.3, radius: 0.6 },
    }),
  },
  {
    name: 'Explosive Orb',
    note: 'Outward pressure beats the boundary. Particles punch through the shell and are reborn inside.',
    graph: () => build({
      sphere: { radius: 0.9, strength: 0.5, softness: 0.3, damping: 0.1, escape: 0.2 },
      vortex: { strength: 7, core: 0.5, falloff: 0.5, spiral: -0.15, poloidal: 0.3 },
      curl: { strength: 0.7, scale: 2.4, speed: 1 },
      turb: { strength: 0.3 },
      drag: { coef: 0.25 },
      radial: { mode: 1, strength: 9, radius: 3, falloff: 0.1 },
      life: { min: 1.2, max: 3.5, fadeIn: 0.15, fadeOut: 0.35 },
      velocity: { inherit: 0.4, random: 0.2 },
      prender: { hue: -18 },
      trender: { length: 0.08, threshold: 1.2 },
      glow: { intensity: 1.2, radius: 0.75 },
    }),
  },
];

export const DEFAULT_PRESET = 0;
