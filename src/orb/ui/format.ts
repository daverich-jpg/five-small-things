import { ParamDef } from '../graph';

export function decimals(step: number) {
  if (step >= 1) return 0;
  return Math.min(4, Math.max(0, Math.ceil(-Math.log10(step) - 1e-9)));
}

/** Value as displayed in the UI (percent and degree params are shown in their own units). */
export function toDisplay(pd: ParamDef, v: number) { return pd.fmt === 'pct' ? v * 100 : v; }
export function fromDisplay(pd: ParamDef, v: number) { return pd.fmt === 'pct' ? v / 100 : v; }

export function fmt(pd: ParamDef, v: number) {
  if (pd.type === 'enum') return pd.options![Math.round(v)] ?? '';
  const d = pd.fmt === 'pct' ? Math.max(0, decimals(pd.step * 100)) : decimals(pd.step);
  return toDisplay(pd, v).toFixed(d);
}

export function unit(pd: ParamDef) {
  if (pd.fmt === 'pct') return '%';
  if (pd.fmt === 'deg') return '°';
  return pd.unit || '';
}

export function el<K extends keyof HTMLElementTagNameMap>(tag: K, cls?: string, html?: string): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (html !== undefined) e.innerHTML = html;
  return e;
}
