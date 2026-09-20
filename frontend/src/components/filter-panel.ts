// Frequency-domain filtering: drag a band on the magnitude spectrum, pick
// low/high/band-pass, the backend masks bins and inverse-transforms.

import { api } from '../api';
import { state, subscribe } from '../state';
import type { FilterType } from '../types';
import { drawSpectrum, Plot } from './plot';

export function initFilterPanel(root: HTMLElement): void {
  root.innerHTML = `
    <h2>④ 频域滤波</h2>
    <div class="row wrap">
      <label>类型
        <select id="filterType">
          <option value="lowpass">低通</option>
          <option value="highpass">高通</option>
          <option value="bandpass" selected>带通</option>
        </select>
      </label>
      <label>下界 (Hz) <input type="number" id="filterLow" value="50" min="0" step="5"></label>
      <label>上界 (Hz) <input type="number" id="filterHigh" value="250" min="0" step="5"></label>
      <button id="applyFilter">应用滤波</button>
    </div>
    <p class="hint">也可以直接在下方幅度谱上按住鼠标<b>框选频段</b>（带通用），再点「应用滤波」。</p>
    <div class="canvas-wrap"><canvas id="filterSpecCanvas" height="200"></canvas></div>
    <div class="canvas-wrap"><canvas id="filterTimeCanvas" height="220"></canvas></div>
    <div id="filterStatus" class="hint"></div>
  `;

  const typeSel = root.querySelector<HTMLSelectElement>('#filterType')!;
  const lowInput = root.querySelector<HTMLInputElement>('#filterLow')!;
  const highInput = root.querySelector<HTMLInputElement>('#filterHigh')!;
  const applyBtn = root.querySelector<HTMLButtonElement>('#applyFilter')!;
  const specCanvas = root.querySelector<HTMLCanvasElement>('#filterSpecCanvas')!;
  const timeCanvas = root.querySelector<HTMLCanvasElement>('#filterTimeCanvas')!;
  const statusEl = root.querySelector<HTMLDivElement>('#filterStatus')!;

  typeSel.value = state.filterType;
  lowInput.value = String(state.filterLow);
  highInput.value = String(state.filterHigh);

  let geom: { px(x: number): number; xMin: number; xMax: number } | null = null;
  let dragStart: number | null = null;
  let dragEnd: number | null = null;
  let lastSpectrum: { frequencies: number[]; magnitude: number[]; n: number } | null = null;
  async function drawSpectrumOnly(): Promise<void> {
    const samples = getSamplesLazy();
    try {
      // the main spectrum result is reused when available for speed; the
      // filter endpoint itself recomputes, so this is purely visual.
      const result = await api.dft({
        samples,
        sample_rate: state.sampleRate,
        n: state.paddedN ?? state.n,
      });
      lastSpectrum = result;
      redrawBaseSpectrum('#38bdf8', '在幅度谱上框选保留频段');
    } catch (err) {
      statusEl.textContent = (err as Error).message;
    }
  }

  function redrawBaseSpectrum(color: string, title: string): void {
    if (!lastSpectrum) return;
    const oneSided = Math.floor(lastSpectrum.n / 2) + 1;
    geom = drawSpectrum(specCanvas, lastSpectrum.frequencies, lastSpectrum.magnitude, {
      title, yLabel: '幅度', maxBins: oneSided, color,
    });
    paintSelectionOverlay();
  }

  function paintSelectionOverlay(): void {
    if (!geom || dragStart === null) {
      // static band from inputs
      paintBand(state.filterLow, state.filterHigh);
      return;
    }
    const a = Math.min(dragStart, dragEnd ?? dragStart);
    const b = Math.max(dragStart, dragEnd ?? dragStart);
    paintBand(a, b);
  }

  function paintBand(low: number, high: number): void {
    if (!geom) return;
    const g = geom as { px(x: number): number; py(y: number): number; xMin: number; xMax: number; yMin: number; yMax: number };
    const dpr = window.devicePixelRatio || 1;
    const rect = specCanvas.getBoundingClientRect();
    const ctx = specCanvas.getContext('2d')!;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    const x1 = g.px(Math.max(low, g.xMin));
    const x2 = g.px(Math.min(high, g.xMax));
    ctx.fillStyle = 'rgba(52, 211, 153, 0.18)';
    const padTop = 28;
    const plotH = rect.height - 28 - 34;
    ctx.fillRect(x1, padTop, Math.max(0, x2 - x1), plotH);
    ctx.strokeStyle = '#34d399';
    ctx.lineWidth = 1.5;
    ctx.setLineDash([6, 4]);
    ctx.strokeRect(x1, padTop, Math.max(0, x2 - x1), plotH);
    ctx.setLineDash([]);
  }

  // drag-to-select
  specCanvas.addEventListener('pointerdown', (e) => {
    const f = eventToFreq(e);
    if (f === null) return;
    dragStart = dragEnd = f;
    specCanvas.setPointerCapture(e.pointerId);
  });
  specCanvas.addEventListener('pointermove', (e) => {
    if (dragStart === null) return;
    const f = eventToFreq(e);
    if (f === null) return;
    dragEnd = f;
    // purely local redraw using the cached spectrum — no backend call
    redrawBaseSpectrum('#38bdf8', '在幅度谱上框选保留频段');
  });
  specCanvas.addEventListener('pointerup', () => {
    if (dragStart === null) return;
    const a = Math.min(dragStart, dragEnd ?? dragStart);
    const b = Math.max(dragStart, dragEnd ?? dragStart);
    if (b - a > 1) {
      state.filterLow = Math.round(a);
      state.filterHigh = Math.round(b);
      lowInput.value = String(state.filterLow);
      highInput.value = String(state.filterHigh);
    }
    dragStart = dragEnd = null;
  });

  function eventToFreq(e: PointerEvent): number | null {
    if (!geom) return null;
    const rect = specCanvas.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const padLeft = 48;
    const plotW = rect.width - 48 - 14;
    const f = ((x - padLeft) / plotW) * (geom.xMax - geom.xMin) + geom.xMin;
    return Math.max(geom.xMin, Math.min(geom.xMax, f));
  }

  typeSel.addEventListener('change', () => {
    state.filterType = typeSel.value as FilterType;
  });
  lowInput.addEventListener('change', () => {
    state.filterLow = Number(lowInput.value);
    paintSelectionOverlay();
  });
  highInput.addEventListener('change', () => {
    state.filterHigh = Number(highInput.value);
    paintSelectionOverlay();
  });

  applyBtn.addEventListener('click', applyFilter);

  async function applyFilter(): Promise<void> {
    statusEl.textContent = '后端滤波与逆变换中…';
    try {
      const result = await api.filter({
        samples: getSamplesLazy(),
        sample_rate: state.sampleRate,
        filter_type: state.filterType,
        low_hz: state.filterLow,
        high_hz: state.filterHigh,
        n: state.paddedN ?? state.n,
      });
      state.filterResult = result;
      statusEl.textContent = `已完成：频段外分量置零后做 ${result.n} 点逆 DFT。`;

      // filtered spectrum + shaded mask
      const oneSided = Math.floor(result.n / 2) + 1;
      lastSpectrum = { n: result.n, frequencies: result.frequencies, magnitude: result.filtered_magnitude };
      geom = drawSpectrum(specCanvas, result.frequencies, result.filtered_magnitude, {
        title: `滤波后幅度谱（${typeSel.selectedOptions[0].textContent} ${state.filterLow}–${state.filterHigh} Hz）`,
        yLabel: '幅度', maxBins: oneSided, color: '#34d399',
      });
      paintBand(state.filterLow, state.filterHigh);

      // time-domain overlay: original solid, filtered dashed
      const n = result.n;
      const duration = n / state.sampleRate;
      const orig = getSamplesLazy();
      const origPadded = orig.concat(new Array(Math.max(0, n - orig.length)).fill(0));
      const t = Array.from({ length: n }, (_, i) => (i / (n - 1)) * duration);
      const plot = new Plot(timeCanvas);
      plot.draw(
        [
          { x: t, y: origPadded, opts: { color: '#64748b', lineWidth: 1.5 } },
          { x: t, y: result.filtered_samples, opts: { color: '#34d399', lineWidth: 2 } },
        ],
        {
          title: '时域对比：原信号（灰实线）vs 滤波后（绿虚线）',
          xLabel: '时间 (s)', yLabel: '幅度',
          xMin: 0, xMax: duration,
        },
      );
      // overlay the filtered series a second time, dashed — Canvas dash state
      const ctx = timeCanvas.getContext('2d')!;
      const dpr = window.devicePixelRatio || 1;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      const rect = timeCanvas.getBoundingClientRect();
      const padL = 48, padT = 28;
      const plotW = rect.width - 48 - 14;
      const plotH = rect.height - 28 - 34;
      const allY = origPadded.concat(result.filtered_samples);
      const yMin = Math.min(...allY);
      const yMax = Math.max(...allY);
      const span = yMax - yMin || 1;
      ctx.strokeStyle = '#34d399';
      ctx.lineWidth = 2;
      ctx.setLineDash([7, 5]);
      ctx.beginPath();
      result.filtered_samples.forEach((v, i) => {
        const X = padL + (i / (n - 1)) * plotW;
        const Y = padT + (1 - (v - yMin) / span) * plotH;
        i === 0 ? ctx.moveTo(X, Y) : ctx.lineTo(X, Y);
      });
      ctx.stroke();
      ctx.setLineDash([]);
    } catch (err) {
      state.filterResult = null;
      statusEl.textContent = '后端拒绝：' + (err as Error).message;
    }
  }

  // Refresh the base spectrum (debounced) whenever the upstream signal or
  // sampling settings change, but not when only the filter band moves.
  let refreshTimer: number | undefined;
  let lastRefreshKey = '';
  subscribe(() => {
    const samples = getSamplesLazy();
    const key = JSON.stringify([
      samples.length, samples.slice(0, 8), state.sampleRate, state.paddedN ?? state.n,
    ]);
    if (key === lastRefreshKey) return;
    lastRefreshKey = key;
    window.clearTimeout(refreshTimer);
    refreshTimer = window.setTimeout(drawSpectrumOnly, 220);
  });

  window.addEventListener('fourier:redraw', () => {
    redrawBaseSpectrum(
      state.filterResult ? '#34d399' : '#38bdf8',
      state.filterResult
        ? `滤波后幅度谱（${typeSel.selectedOptions[0].textContent} ${state.filterLow}–${state.filterHigh} Hz）`
        : '在幅度谱上框选保留频段',
    );
  });

  void drawSpectrumOnly();
  (root as unknown as { _redraw: () => Promise<void> })._redraw = drawSpectrumOnly;
}

import { getSamples } from './signal-builder';
function getSamplesLazy(): number[] {
  return getSamples();
}
