// Sampling theorem demo: dense original, discrete samples, sinc
// reconstruction; reconstruction turns bold red whenever aliasing occurs.

import { api } from '../api';
import { state } from '../state';
import { Plot } from './plot';

export function initSamplingPanel(root: HTMLElement): void {
  root.innerHTML = `
    <h2>③ 采样定理与混叠</h2>
    <div class="row wrap">
      <label>信号频率 f₀ (Hz)
        <input type="range" id="demoFreq" min="1" max="400" step="1" value="40">
        <span id="demoFreqVal" class="val">40</span>
      </label>
      <label>采样率 fs (Hz)
        <input type="range" id="demoFs" min="10" max="600" step="2" value="100">
        <span id="demoFsVal" class="val">100</span>
      </label>
    </div>
    <div id="aliasBanner" class="banner ok"></div>
    <div class="canvas-wrap"><canvas id="demoCanvas" height="260"></canvas></div>
    <div class="hint">
      <span style="color:#38bdf8">━</span> 密集采样的原始信号　·
      <span style="color:#fbbf24">●</span> 离散采样点　·
      <span style="color:#f472b6">━</span> 采样点重建信号（<b style="color:#ef4444">混叠时变红</b>）
    </div>
  `;

  const freqInput = root.querySelector<HTMLInputElement>('#demoFreq')!;
  const fsInput = root.querySelector<HTMLInputElement>('#demoFs')!;
  const freqVal = root.querySelector<HTMLSpanElement>('#demoFreqVal')!;
  const fsVal = root.querySelector<HTMLSpanElement>('#demoFsVal')!;
  const banner = root.querySelector<HTMLDivElement>('#aliasBanner')!;
  const canvas = root.querySelector<HTMLCanvasElement>('#demoCanvas')!;
  const plot = new Plot(canvas);

  let timer: number | undefined;
  let reqId = 0;

  async function refresh(): Promise<void> {
    const id = ++reqId;
    try {
      const demo = await api.samplingDemo({
        signal_freq: state.demoFreq,
        sample_rate: state.demoSampleRate,
        duration: 0.5,
      });
      if (id !== reqId) return; // a newer request superseded this one
      state.demo = demo;
      draw(demo);
    } catch (err) {
      banner.className = 'banner error';
      banner.textContent = '后端拒绝请求：' + (err as Error).message;
    }
  }

  function draw(demo: NonNullable<typeof state.demo>): void {
    const alias = demo.aliasing;
    const geom = plot.draw(
      [
        { x: demo.dense_t, y: demo.dense_y, opts: { color: '#38bdf8', lineWidth: 2 } },
        {
          x: demo.reconstructed_t, y: demo.reconstructed_y,
          opts: { color: alias.aliased ? '#ef4444' : '#f472b6', lineWidth: alias.aliased ? 3 : 2 },
        },
      ],
      { title: '采样与重建', xLabel: '时间 (s)', yLabel: '幅度', xMin: 0, xMax: demo.duration,
        yMin: -1.4, yMax: 1.4 },
    );

    // Discrete samples as explicit yellow dots, using the plot's own geometry.
    const ctx = specContext(canvas);
    ctx.fillStyle = '#fbbf24';
    for (let i = 0; i < demo.sample_t.length; i++) {
      const X = geom.px(demo.sample_t[i]);
      const Y = geom.py(demo.sample_y[i]);
      ctx.beginPath(); ctx.arc(X, Y, 3.2, 0, Math.PI * 2); ctx.fill();
    }

    if (alias.aliased) {
      banner.className = 'banner danger';
      banner.innerHTML = `⚠ 混叠！f₀=${alias.signal_freq.toFixed(0)} Hz &gt; fs/2=${alias.nyquist.toFixed(0)} Hz，`
        + `采样点看起来只有 <b>${alias.apparent_freq.toFixed(1)} Hz</b>（折叠后的表观频率）。拖高采样率观察混叠消失。`;
    } else {
      banner.className = 'banner ok';
      banner.textContent = `✓ f₀=${alias.signal_freq.toFixed(0)} Hz ≤ fs/2=${alias.nyquist.toFixed(0)} Hz，满足奈奎斯特条件，重建信号与原信号重合。`;
    }
  }

  freqInput.addEventListener('input', () => {
    state.demoFreq = Number(freqInput.value);
    freqVal.textContent = freqInput.value;
    schedule();
  });
  fsInput.addEventListener('input', () => {
    state.demoSampleRate = Number(fsInput.value);
    fsVal.textContent = fsInput.value;
    schedule();
  });

  function schedule(): void {
    window.clearTimeout(timer);
    timer = window.setTimeout(refresh, 120);
  }

  window.addEventListener('fourier:redraw', () => {
    if (state.demo) draw(state.demo);
  });

  void refresh();
}

// Return a 2D context with device-pixel-ratio transform matching Plot.setup.
function specContext(canvas: HTMLCanvasElement): CanvasRenderingContext2D {
  const ctx = canvas.getContext('2d')!;
  const dpr = window.devicePixelRatio || 1;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  return ctx;
}
