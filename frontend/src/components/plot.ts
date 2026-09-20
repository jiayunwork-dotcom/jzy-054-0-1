// Minimal Canvas 2D plotting helpers — no third-party charting library.

export interface PlotOptions {
  xLabel?: string;
  yLabel?: string;
  title?: string;
  color?: string;
  lineWidth?: number;
  yMin?: number;
  yMax?: number;
  fill?: boolean;
}

const PADDING = { top: 28, right: 14, bottom: 34, left: 48 };

function setup(canvas: HTMLCanvasElement) {
  const dpr = window.devicePixelRatio || 1;
  const rect = canvas.getBoundingClientRect();
  const w = Math.max(1, rect.width);
  const h = Math.max(1, rect.height);
  if (canvas.width !== Math.round(w * dpr) || canvas.height !== Math.round(h * dpr)) {
    canvas.width = Math.round(w * dpr);
    canvas.height = Math.round(h * dpr);
  }
  const ctx = canvas.getContext('2d')!;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, w, h);
  return { ctx, w, h };
}

function niceTicks(min: number, max: number, count: number): number[] {
  if (!isFinite(min) || !isFinite(max) || min === max) return [min];
  const span = max - min;
  const step0 = span / count;
  const mag = Math.pow(10, Math.floor(Math.log10(step0)));
  const norm = step0 / mag;
  const step = (norm < 1.5 ? 1 : norm < 3 ? 2 : norm < 7 ? 5 : 10) * mag;
  const ticks: number[] = [];
  for (let v = Math.ceil(min / step) * step; v <= max + step * 1e-9; v += step) {
    ticks.push(Math.abs(v) < step * 1e-9 ? 0 : v);
  }
  return ticks;
}

export class Plot {
  xMin = 0;
  xMax = 1;
  yMin = -1;
  yMax = 1;

  constructor(private canvas: HTMLCanvasElement) {}

  draw(series: { x: number[]; y: number[]; opts?: PlotOptions }[], opts?: {
    xMin?: number; xMax?: number; yMin?: number; yMax?: number;
    xLabel?: string; yLabel?: string; title?: string;
    zeroLine?: boolean;
  }) {
    const { ctx, w, h } = setup(this.canvas);
    const pad = PADDING;
    const plotW = w - pad.left - pad.right;
    const plotH = h - pad.top - pad.bottom;

    this.xMin = opts?.xMin ?? (series[0]?.x[0] ?? 0);
    this.xMax = opts?.xMax ?? (series[0]?.x[series[0].x.length - 1] ?? 1);
    this.yMin = opts?.yMin ?? Math.min(0, ...series.flatMap((s) => s.y));
    this.yMax = opts?.yMax ?? Math.max(0, ...series.flatMap((s) => s.y));
    if (this.yMin === this.yMax) { this.yMin -= 1; this.yMax += 1; }

    const px = (x: number) => pad.left + ((x - this.xMin) / (this.xMax - this.xMin)) * plotW;
    const py = (y: number) => pad.top + (1 - (y - this.yMin) / (this.yMax - this.yMin)) * plotH;

    // background
    ctx.fillStyle = '#0f172a';
    ctx.fillRect(0, 0, w, h);
    ctx.fillStyle = '#111c33';
    ctx.fillRect(pad.left, pad.top, plotW, plotH);

    // grid + tick labels
    ctx.font = '10px system-ui, sans-serif';
    ctx.textBaseline = 'middle';
    for (const xt of niceTicks(this.xMin, this.xMax, 8)) {
      const x = px(xt);
      ctx.strokeStyle = '#1e2c48';
      ctx.beginPath(); ctx.moveTo(x, pad.top); ctx.lineTo(x, pad.top + plotH); ctx.stroke();
      ctx.fillStyle = '#94a3b8';
      ctx.textAlign = 'center';
      ctx.fillText(formatTick(xt), x, pad.top + plotH + 12);
    }
    for (const yt of niceTicks(this.yMin, this.yMax, 5)) {
      const y = py(yt);
      ctx.strokeStyle = '#1e2c48';
      ctx.beginPath(); ctx.moveTo(pad.left, y); ctx.lineTo(pad.left + plotW, y); ctx.stroke();
      ctx.fillStyle = '#94a3b8';
      ctx.textAlign = 'right';
      ctx.fillText(formatTick(yt), pad.left - 6, y);
    }

    // zero line
    if (opts?.zeroLine !== false && this.yMin < 0 && this.yMax > 0) {
      ctx.strokeStyle = '#475569';
      ctx.setLineDash([4, 4]);
      ctx.beginPath();
      ctx.moveTo(pad.left, py(0)); ctx.lineTo(pad.left + plotW, py(0));
      ctx.stroke();
      ctx.setLineDash([]);
    }

    // series
    for (const s of series) {
      const color = s.opts?.color ?? '#38bdf8';
      ctx.strokeStyle = color;
      ctx.lineWidth = s.opts?.lineWidth ?? 1.5;
      ctx.beginPath();
      let started = false;
      for (let i = 0; i < s.x.length; i++) {
        const X = px(s.x[i]);
        const Y = py(s.y[i]);
        if (!started) { ctx.moveTo(X, Y); started = true; } else ctx.lineTo(X, Y);
      }
      ctx.stroke();
      if (s.opts?.fill) {
        ctx.lineTo(px(s.x[s.x.length - 1]), py(0));
        ctx.lineTo(px(s.x[0]), py(0));
        ctx.closePath();
        ctx.globalAlpha = 0.25;
        ctx.fillStyle = color;
        ctx.fill();
        ctx.globalAlpha = 1;
      }
    }

    // titles
    ctx.fillStyle = '#e2e8f0';
    ctx.textAlign = 'left';
    ctx.font = 'bold 12px system-ui, sans-serif';
    if (opts?.title) ctx.fillText(opts.title, pad.left, 14);
    ctx.font = '10px system-ui, sans-serif';
    ctx.fillStyle = '#94a3b8';
    if (opts?.xLabel) { ctx.textAlign = 'center'; ctx.fillText(opts.xLabel, pad.left + plotW / 2, h - 4); }
    if (opts?.yLabel) {
      ctx.save();
      ctx.translate(12, pad.top + plotH / 2);
      ctx.rotate(-Math.PI / 2);
      ctx.textAlign = 'center';
      ctx.fillText(opts.yLabel, 0, 0);
      ctx.restore();
    }

    return { px, py, pad, plotW, plotH };
  }

  /** Convert a client pointer position to data coordinates. */
  toData(clientX: number, clientY: number, geom?: { pad: typeof PADDING; plotW: number; plotH: number }) {
    const rect = this.canvas.getBoundingClientRect();
    const x = clientX - rect.left;
    const y = clientY - rect.top;
    const pad = geom?.pad ?? PADDING;
    const plotW = geom?.plotW ?? rect.width - pad.left - pad.right;
    const plotH = geom?.plotH ?? rect.height - pad.top - pad.bottom;
    return {
      x: this.xMin + ((x - pad.left) / plotW) * (this.xMax - this.xMin),
      y: this.yMax - ((y - pad.top) / plotH) * (this.yMax - this.yMin),
    };
  }
}

function formatTick(v: number): string {
  if (v === 0) return '0';
  const a = Math.abs(v);
  if (a >= 1000) return (v / 1000).toFixed(a >= 10000 ? 0 : 1) + 'k';
  if (a >= 100) return v.toFixed(0);
  if (a >= 1) return v.toFixed(1);
  return v.toFixed(2);
}

/** Stem/bar renderer for spectra, with optional one-sided truncation. */
export function drawSpectrum(
  canvas: HTMLCanvasElement,
  freqs: number[],
  values: number[],
  opts: {
    title: string; yLabel: string; xLabel?: string;
    color?: string; db?: boolean; maxBins?: number;
  },
): { px: (x: number) => number; py: (y: number) => number; xMin: number; xMax: number; yMin: number; yMax: number } {
  const { ctx, w, h } = setup(canvas);
  const pad = PADDING;
  const plotW = w - pad.left - pad.right;
  const plotH = h - pad.top - pad.bottom;

  const limit = opts.maxBins ?? freqs.length; // one-sided: include Nyquist
  const xs = freqs.slice(0, limit);
  let ys = values.slice(0, limit);
  if (opts.db) {
    const peak = Math.max(...ys, 1e-12);
    ys = ys.map((v) => 20 * Math.log10(Math.max(v / peak, 1e-6)));
  }

  const xMin = xs[0] ?? 0;
  const xMax = xs[xs.length - 1] ?? 1;
  const yMin = opts.db ? -120 : Math.min(0, ...ys);
  const yMax = opts.db ? 0 : Math.max(...ys, 1e-9) * 1.05;
  const px = (x: number) => pad.left + ((x - xMin) / (xMax - xMin || 1)) * plotW;
  const py = (y: number) => pad.top + (1 - (y - yMin) / (yMax - yMin || 1)) * plotH;

  ctx.fillStyle = '#0f172a';
  ctx.fillRect(0, 0, w, h);
  ctx.fillStyle = '#111c33';
  ctx.fillRect(pad.left, pad.top, plotW, plotH);

  ctx.font = '10px system-ui, sans-serif';
  for (const xt of niceTicks(xMin, xMax, 8)) {
    const X = px(xt);
    ctx.strokeStyle = '#1e2c48';
    ctx.beginPath(); ctx.moveTo(X, pad.top); ctx.lineTo(X, pad.top + plotH); ctx.stroke();
    ctx.fillStyle = '#94a3b8'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText(formatTick(xt), X, pad.top + plotH + 12);
  }
  const yTicks = opts.db ? [-120, -90, -60, -30, 0] : niceTicks(yMin, yMax, 5);
  for (const yt of yTicks) {
    const Y = py(yt);
    ctx.strokeStyle = '#1e2c48';
    ctx.beginPath(); ctx.moveTo(pad.left, Y); ctx.lineTo(pad.left + plotW, Y); ctx.stroke();
    ctx.fillStyle = '#94a3b8'; ctx.textAlign = 'right';
    ctx.fillText(opts.db ? `${yt}` : formatTick(yt), pad.left - 6, Y);
  }

  // stems
  const color = opts.color ?? '#38bdf8';
  ctx.strokeStyle = color;
  ctx.lineWidth = 1;
  const step = plotW / Math.max(ys.length - 1, 1);
  const barWidth = Math.max(1, Math.min(step * 0.8, 4));
  ctx.beginPath();
  for (let i = 0; i < ys.length; i++) {
    const X = px(xs[i]);
    const Y = py(ys[i]);
    ctx.moveTo(X, py(0));
    ctx.lineTo(X, Y);
  }
  ctx.stroke();
  ctx.fillStyle = color;
  for (let i = 0; i < ys.length; i++) {
    ctx.fillRect(px(xs[i]) - barWidth / 2, py(ys[i]), barWidth, barWidth);
  }

  ctx.fillStyle = '#e2e8f0';
  ctx.font = 'bold 12px system-ui, sans-serif';
  ctx.textAlign = 'left';
  ctx.fillText(opts.title, pad.left, 14);
  ctx.font = '10px system-ui, sans-serif';
  ctx.fillStyle = '#94a3b8';
  ctx.textAlign = 'center';
  ctx.fillText(opts.xLabel ?? '频率 (Hz)', pad.left + plotW / 2, h - 4);
  ctx.save();
  ctx.translate(12, pad.top + plotH / 2);
  ctx.rotate(-Math.PI / 2);
  ctx.fillText(opts.yLabel, 0, 0);
  ctx.restore();

  return { px, py, xMin, xMax, yMin, yMax };
}
