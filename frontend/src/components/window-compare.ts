// Window comparison overlay: one colour per window, dB-normalised, plus a
// small table of main-lobe width / peak sidelobe attenuation.

import { api } from '../api';
import { state, subscribe } from '../state';
import type { WindowCompareCurve, WindowName } from '../types';

const WINDOW_COLORS: Record<string, string> = {
  rectangular: '#f87171',
  hann: '#38bdf8',
  hamming: '#34d399',
  blackman: '#fbbf24',
  kaiser: '#c084fc',
};

const ALL_WINDOWS: { name: WindowName; beta?: number }[] = [
  { name: 'rectangular' },
  { name: 'hann' },
  { name: 'hamming' },
  { name: 'blackman' },
  { name: 'kaiser', beta: 8.6 },
];

export function initWindowCompare(root: HTMLElement): void {
  root.innerHTML = `
    <h3>窗函数对比</h3>
    <div class="hint">同一信号在各窗下的幅度谱（归一化 dB），以及主瓣宽度 / 最高旁瓣衰减。</div>
    <div class="legend" id="winLegend"></div>
    <div class="canvas-wrap"><canvas id="winCanvas" height="220"></canvas></div>
    <table class="metrics" id="winTable">
      <thead><tr><th>窗</th><th>主瓣宽度 (bin)</th><th>最高旁瓣 (dB)</th></tr></thead>
      <tbody></tbody>
    </table>
  `;

  const canvas = root.querySelector<HTMLCanvasElement>('#winCanvas')!;
  const legend = root.querySelector<HTMLDivElement>('#winLegend')!;
  const tbody = root.querySelector<HTMLTableSectionElement>('#winTable tbody')!;
  const status = root.querySelector<HTMLDivElement>('.hint')!;

  let timer: number | undefined;
  let lastKey = '';

  async function refresh(): Promise<void> {
    const samples = getSamplesLazy();
    const windows: { name: WindowName; beta?: number }[] = ALL_WINDOWS.map((w) =>
      w.name === 'kaiser' ? { name: 'kaiser' as WindowName, beta: state.kaiserBeta } : w,
    );
    const key = JSON.stringify({
      samples: samples.slice(0, 16),
      len: samples.length,
      fs: state.sampleRate,
      n: state.paddedN ?? state.n,
      beta: state.kaiserBeta,
    });
    if (key === lastKey) return;
    lastKey = key;

    try {
      const data = await api.windowsCompare({
        samples,
        sample_rate: state.sampleRate,
        n: state.paddedN ?? state.n,
        windows,
      });
      state.windowCurves = data.curves;
      draw(data.curves);
    } catch (err) {
      status.textContent = '窗对比请求失败：' + (err as Error).message;
    }
  }

  function draw(curves: WindowCompareCurve[]): void {
    const n2 = Math.floor((state.paddedN ?? state.n) / 2) + 1;
    const freqs = curves[0].frequencies.slice(0, n2);

    // Normalise every curve to its own peak for fair shape comparison.
    const series = curves.map((c) => {
      const vals = c.magnitude.slice(0, n2);
      const peak = Math.max(...vals, 1e-12);
      const db = vals.map((v) => 20 * Math.log10(Math.max(v / peak, 1e-6)));
      return { freqs, db, curve: c };
    });

    // custom multi-curve draw reusing the spectrum renderer helpers
    const { ctx, w, h } = rawContext(canvas);
    const pad = { top: 28, right: 14, bottom: 34, left: 48 };
    const plotW = w - pad.left - pad.right;
    const plotH = h - pad.top - pad.bottom;
    ctx.fillStyle = '#0f172a'; ctx.fillRect(0, 0, w, h);
    ctx.fillStyle = '#111c33'; ctx.fillRect(pad.left, pad.top, plotW, plotH);
    const px = (f: number) => pad.left + (f / (freqs[freqs.length - 1] || 1)) * plotW;
    const py = (d: number) => pad.top + (1 - (d + 120) / 120) * plotH;

    for (const d of [-120, -90, -60, -30, 0]) {
      ctx.strokeStyle = '#1e2c48';
      ctx.beginPath(); ctx.moveTo(pad.left, py(d)); ctx.lineTo(pad.left + plotW, py(d)); ctx.stroke();
      ctx.fillStyle = '#94a3b8'; ctx.font = '10px system-ui';
      ctx.textAlign = 'right'; ctx.fillText(`${d}`, pad.left - 6, py(d));
    }
    ctx.strokeStyle = '#475569'; ctx.setLineDash([4, 4]);
    ctx.beginPath(); ctx.moveTo(pad.left, py(0)); ctx.lineTo(pad.left + plotW, py(0)); ctx.stroke();
    ctx.setLineDash([]);

    for (const s of series) {
      const color = WINDOW_COLORS[s.curve.name] ?? '#999';
      ctx.strokeStyle = color; ctx.lineWidth = 1.6;
      ctx.beginPath();
      s.db.forEach((d, i) => { const X = px(s.freqs[i]); const Y = py(d); i ? ctx.lineTo(X, Y) : ctx.moveTo(X, Y); });
      ctx.stroke();
    }
    ctx.fillStyle = '#e2e8f0'; ctx.font = 'bold 12px system-ui'; ctx.textAlign = 'left';
    ctx.fillText('不同窗下的幅度谱对比（dB）', pad.left, 14);
    ctx.fillStyle = '#94a3b8'; ctx.font = '10px system-ui'; ctx.textAlign = 'center';
    ctx.fillText('频率 (Hz)', pad.left + plotW / 2, h - 4);

    legend.innerHTML = curves
      .map((c) => `<span class="legend-item"><i style="background:${WINDOW_COLORS[c.name]}"></i>${c.label}${c.name === 'kaiser' ? ` β=${state.kaiserBeta.toFixed(1)}` : ''}</span>`)
      .join('');

    tbody.innerHTML = curves
      .map((c) => `<tr>
        <td><span class="dot" style="background:${WINDOW_COLORS[c.name]}"></span>${c.label}</td>
        <td>${c.metrics.main_lobe_bins ?? '—'}</td>
        <td>${c.metrics.peak_sidelobe_db ?? '—'} dB</td>
      </tr>`)
      .join('');
  }

  subscribe(() => {
    window.clearTimeout(timer);
    timer = window.setTimeout(refresh, 250);
  });

  window.addEventListener('fourier:redraw', () => {
    if (state.windowCurves) draw(state.windowCurves);
  });
}

import { getSamples } from './signal-builder';
function getSamplesLazy(): number[] {
  return getSamples();
}

function rawContext(canvas: HTMLCanvasElement) {
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
  return { ctx, w, h };
}
