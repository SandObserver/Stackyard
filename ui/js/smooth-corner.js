const rad = deg => (deg * Math.PI) / 180;
const n = v => Math.round(v * 100) / 100;

/** A rounded rectangle whose corners ease into the edge. `smoothing` 0 is a plain arc.
    @param {number} w @param {number} h @param {number} radius @param {number} smoothing
    @returns {string} SVG path data, also valid inside CSS path() */
export function smoothRectPath(w, h, radius, smoothing) {
  const half = Math.min(w, h) / 2;
  const r = Math.min(radius, half);
  const s = Math.max(0, Math.min(smoothing, half / r - 1));
  const p = Math.min((1 + s) * r, half);
  const arc = 90 * (1 - s);
  const arcLen = Math.sin(rad(arc / 2)) * r * Math.SQRT2;
  const alpha = (90 - arc) / 2;
  const beta = 45 * s;
  const c = r * Math.tan(rad(alpha / 2)) * Math.cos(rad(beta));
  const d = c * Math.tan(rad(beta));
  const b = (p - arcLen - c - d) / 3;
  const a = 2 * b;
  const k = a + b + c;

  return [
    `M${n(p)} 0`,
    `L${n(w - p)} 0`,
    `C${n(w - p + a)} 0 ${n(w - p + a + b)} 0 ${n(w - p + k)} ${n(d)}`,
    `A${n(r)} ${n(r)} 0 0 1 ${n(w - d)} ${n(p - k)}`,
    `C${n(w)} ${n(p - a - b)} ${n(w)} ${n(p - a)} ${n(w)} ${n(p)}`,
    `L${n(w)} ${n(h - p)}`,
    `C${n(w)} ${n(h - p + a)} ${n(w)} ${n(h - p + a + b)} ${n(w - d)} ${n(h - p + k)}`,
    `A${n(r)} ${n(r)} 0 0 1 ${n(w - p + k)} ${n(h - d)}`,
    `C${n(w - p + a + b)} ${n(h)} ${n(w - p + a)} ${n(h)} ${n(w - p)} ${n(h)}`,
    `L${n(p)} ${n(h)}`,
    `C${n(p - a)} ${n(h)} ${n(p - a - b)} ${n(h)} ${n(p - k)} ${n(h - d)}`,
    `A${n(r)} ${n(r)} 0 0 1 ${n(d)} ${n(h - p + k)}`,
    `C0 ${n(h - p + a + b)} 0 ${n(h - p + a)} 0 ${n(h - p)}`,
    `L0 ${n(p)}`,
    `C0 ${n(p - a)} 0 ${n(p - a - b)} ${n(d)} ${n(p - k)}`,
    `A${n(r)} ${n(r)} 0 0 1 ${n(p - k)} ${n(d)}`,
    `C${n(p - a - b)} 0 ${n(p - a)} 0 ${n(p)} 0`,
    'Z',
  ].join('');
}
