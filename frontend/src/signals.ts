// Signal construction: analytic waveform components and hand-drawn
// resampling. The produced array of N samples is the single input to every
// frequency-domain operation.

import type { SignalComponent, WaveformType } from './types';

export const WAVEFORM_LABELS: Record<WaveformType, string> = {
  sine: '正弦',
  cosine: '余弦',
  square: '方波',
  triangle: '三角波',
  sawtooth: '锯齿波',
};

/** One period-normalised value in [-1, 1]; phase in radians. */
export function waveformValue(type: WaveformType, phase: number): number {
  const p = ((phase % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI); // [0, 2π)
  switch (type) {
    case 'sine':
      return Math.sin(phase);
    case 'cosine':
      return Math.cos(phase);
    case 'square':
      return p < Math.PI ? 1 : -1;
    case 'triangle':
      // -1 at p=0, +1 at p=π, -1 at p=2π
      return p < Math.PI ? -1 + (2 * p) / Math.PI : 3 - (2 * p) / Math.PI;
    case 'sawtooth':
      return p / Math.PI - 1; // -1 at 0, +1 at 2π
  }
}

/** Sample a single component at n uniformly spaced instants. */
export function sampleComponent(c: SignalComponent, n: number, sampleRate: number): number[] {
  const out = new Array<number>(n);
  for (let i = 0; i < n; i++) {
    const t = i / sampleRate;
    out[i] = c.enabled
      ? c.amplitude * waveformValue(c.type, 2 * Math.PI * c.frequency * t + c.phase)
      : 0;
  }
  return out;
}

/** Sum up to `maxComponents` components into one real sample sequence. */
export function buildSignal(
  components: SignalComponent[],
  n: number,
  sampleRate: number,
): number[] {
  const out = new Array<number>(n).fill(0);
  for (const c of components) {
    if (!c.enabled) continue;
    const part = sampleComponent(c, n, sampleRate);
    for (let i = 0; i < n; i++) out[i] += part[i];
  }
  return out;
}

/**
 * Discretise a hand-drawn stroke.
 *
 * The stroke is a list of (x, y) points captured in canvas coordinates, with
 * x increasing monotonically. We resample it onto N uniformly spaced x
 * positions by linear interpolation, then map y (canvas pixels, top-down) to
 * signal values in [-1, 1]. Gaps between captured points are interpolated;
 * points outside the drawn span hold the nearest endpoint value.
 */
export function resampleStroke(
  stroke: { x: number; y: number }[],
  n: number,
  canvasWidth: number,
  canvasHeight: number,
): number[] {
  if (stroke.length === 0 || canvasWidth <= 0 || canvasHeight <= 0) {
    return new Array<number>(n).fill(0);
  }
  const sorted = [...stroke].sort((a, b) => a.x - b.x);
  const xMin = 0;
  const xMax = canvasWidth;
  const out = new Array<number>(n);

  let j = 0;
  for (let i = 0; i < n; i++) {
    const x = xMin + (i / (n - 1)) * (xMax - xMin);
    while (j + 1 < sorted.length - 1 && sorted[j + 1].x < x) j++;

    let y: number;
    if (x <= sorted[0].x) {
      y = sorted[0].y;
    } else if (x >= sorted[sorted.length - 1].x) {
      y = sorted[sorted.length - 1].y;
    } else {
      // advance to the bracketing segment
      while (j + 1 < sorted.length && sorted[j + 1].x < x) j++;
      const a = sorted[j];
      const b = sorted[Math.min(j + 1, sorted.length - 1)];
      const frac = b.x === a.x ? 0 : (x - a.x) / (b.x - a.x);
      y = a.y + frac * (b.y - a.y);
    }
    // canvas y grows downward; centre maps to 0, half-height to ±1
    out[i] = Math.max(-1.5, Math.min(1.5, -(y - canvasHeight / 2) / (canvasHeight / 2)));
  }
  return out;
}

/** Smooth-ish dense evaluation of the composed signal for the time canvas. */
export function denseSignal(
  components: SignalComponent[],
  points: number,
  duration: number,
): { t: number[]; y: number[] } {
  const t = new Array<number>(points);
  const y = new Array<number>(points).fill(0);
  for (const c of components) {
    if (!c.enabled) continue;
    for (let i = 0; i < points; i++) {
      const ti = (i / (points - 1)) * duration;
      y[i] += c.amplitude * waveformValue(c.type, 2 * Math.PI * c.frequency * ti + c.phase);
      t[i] = ti;
    }
  }
  if (points > 0) t[0] = 0;
  return { t, y };
}
