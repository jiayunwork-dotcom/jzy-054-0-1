// Left panel: component stack, time-domain canvas, hand-draw mode.

import { api } from '../api';
import { buildSignal, denseSignal, resampleStroke, WAVEFORM_LABELS } from '../signals';
import { emit, registerSampleBuilder, state, subscribe } from '../state';
import type { SignalComponent, WaveformType } from '../types';
import { Plot } from './plot';

const WAVE_TYPES: WaveformType[] = ['sine', 'cosine', 'square', 'triangle', 'sawtooth'];

export function initSignalBuilder(root: HTMLElement): void {
  root.innerHTML = `
    <h2>① 信号构造</h2>
    <div class="mode-switch">
      <label><input type="radio" name="sourceMode" value="compose" checked> 波形叠加</label>
      <label><input type="radio" name="sourceMode" value="draw"> 手绘波形</label>
    </div>

    <div id="composePanel">
      <div id="componentList"></div>
      <button id="addComponent" class="secondary">＋ 添加分量（最多 8 个）</button>
    </div>

    <div id="drawPanel" hidden>
      <p class="hint">在下方画布上按住鼠标左键拖动，画出任意波形；系统按当前 N 与采样率离散化。</p>
      <div class="row">
        <button id="clearDraw" class="secondary">清除手绘</button>
      </div>
    </div>

    <div class="canvas-wrap">
      <canvas id="timeCanvas" height="240"></canvas>
      <canvas id="sampleCanvas" height="120" hidden></canvas>
    </div>
    <div class="row">
      <label>采样点数 N
        <select id="nSelect">
          <option>64</option><option>128</option><option selected>256</option>
          <option>512</option><option>1024</option>
        </select>
      </label>
      <label>采样率 fs (Hz)
        <input type="number" id="fsInput" value="1000" min="1" step="50">
      </label>
    </div>
    <div class="row">
      <label>补零到 N'
        <select id="padSelect">
          <option value="">不补零</option>
          <option>64</option><option>128</option><option>256</option>
          <option>512</option><option>1024</option>
        </select>
      </label>
      <button id="analyzeBtn">计算频谱 →</button>
    </div>
    <div id="buildError" class="error"></div>
  `;

  registerSampleBuilder((s) => buildSignal(s.components, s.n, s.sampleRate));

  const list = root.querySelector<HTMLDivElement>('#componentList')!;
  const addBtn = root.querySelector<HTMLButtonElement>('#addComponent')!;
  const timeCanvas = root.querySelector<HTMLCanvasElement>('#timeCanvas')!;
  const sampleCanvas = root.querySelector<HTMLCanvasElement>('#sampleCanvas')!;
  const nSelect = root.querySelector<HTMLSelectElement>('#nSelect')!;
  const fsInput = root.querySelector<HTMLInputElement>('#fsInput')!;
  const padSelect = root.querySelector<HTMLSelectElement>('#padSelect')!;
  const composePanel = root.querySelector<HTMLDivElement>('#composePanel')!;
  const drawPanel = root.querySelector<HTMLDivElement>('#drawPanel')!;
  const errBox = root.querySelector<HTMLDivElement>('#buildError')!;
  const timePlot = new Plot(timeCanvas);

  function renderComponent(c: SignalComponent): string {
    return `
      <fieldset class="component" data-id="${c.id}" ${c.enabled ? '' : 'disabled'}>
        <legend>
          <input type="checkbox" class="c-en" ${c.enabled ? 'checked' : ''}>
          <select class="c-type">
            ${WAVE_TYPES.map((t) => `<option value="${t}" ${t === c.type ? 'selected' : ''}>${WAVEFORM_LABELS[t]}</option>`).join('')}
          </select>
          <button class="c-remove ghost" title="删除分量">✕</button>
        </legend>
        <label>振幅 A
          <input type="range" class="c-amp" min="0" max="2" step="0.05" value="${c.amplitude}">
          <span class="val">${c.amplitude.toFixed(2)}</span>
        </label>
        <label>频率 f (Hz)
          <input type="range" class="c-freq" min="0" max="500" step="1" value="${c.frequency}">
          <span class="val">${c.frequency}</span>
        </label>
        <label>初相 φ (°)
          <input type="range" class="c-phase" min="-180" max="180" step="5" value="${Math.round((c.phase * 180) / Math.PI)}">
          <span class="val">${Math.round((c.phase * 180) / Math.PI)}°</span>
        </label>
      </fieldset>`;
  }

  function renderList(): void {
    list.innerHTML = state.components.map(renderComponent).join('');
    addBtn.disabled = state.components.length >= 8;
    addBtn.textContent =
      state.components.length >= 8 ? '已达 8 个分量上限' : '＋ 添加分量（最多 8 个）';
  }

  addBtn.addEventListener('click', () => {
    if (state.components.length >= 8) return;
    state.components.push({
      id: state.nextComponentId++,
      type: 'sine', amplitude: 0.5,
      frequency: 20 * state.components.length + 30,
      phase: 0, enabled: true,
    });
    renderList();
    drawTimeDomain();
    emit();
  });

  list.addEventListener('input', (e) => {
    const el = e.target as HTMLElement;
    const box = el.closest<HTMLFieldSetElement>('.component')!;
    const id = Number(box.dataset.id);
    const c = state.components.find((x) => x.id === id);
    if (!c) return;
    if (el.classList.contains('c-en')) c.enabled = (el as HTMLInputElement).checked;
    if (el.classList.contains('c-type')) c.type = (el as HTMLSelectElement).value as WaveformType;
    if (el.classList.contains('c-amp')) {
      c.amplitude = Number((el as HTMLInputElement).value);
      box.querySelector('.c-amp + .val')!.textContent = c.amplitude.toFixed(2);
    }
    if (el.classList.contains('c-freq')) {
      c.frequency = Number((el as HTMLInputElement).value);
      box.querySelector('.c-freq + .val')!.textContent = String(c.frequency);
    }
    if (el.classList.contains('c-phase')) {
      c.phase = (Number((el as HTMLInputElement).value) * Math.PI) / 180;
      box.querySelector('.c-phase + .val')!.textContent = `${(el as HTMLInputElement).value}°`;
    }
    drawTimeDomain();
    emit();
  });

  list.addEventListener('change', (e) => {
    const el = e.target as HTMLElement;
    if (el.classList.contains('c-en')) {
      renderList();
      drawTimeDomain();
      emit();
    }
  });

  list.addEventListener('click', (e) => {
    const btn = e.target as HTMLElement;
    if (!btn.classList.contains('c-remove')) return;
    const id = Number(btn.closest('.component')!.getAttribute('data-id'));
    state.components = state.components.filter((c) => c.id !== id);
    renderList();
    drawTimeDomain();
    emit();
  });

  nSelect.addEventListener('change', () => {
    state.n = Number(nSelect.value);
    // Re-discretise any hand-drawn stroke at the new N
    if (state.sourceMode === 'draw' && currentStroke) {
      state.drawnSamples = resampleStroke(currentStroke, state.n, timeCanvas.clientWidth, timeCanvas.clientHeight);
    }
    validatePadding();
    drawTimeDomain();
    drawSamples();
    emit();
  });

  fsInput.addEventListener('input', () => {
    state.sampleRate = Number(fsInput.value);
    drawTimeDomain();
    emit();
  });

  padSelect.addEventListener('change', () => {
    state.paddedN = padSelect.value ? Number(padSelect.value) : null;
    validatePadding();
    emit();
  });

  function validatePadding(): void {
    // disable padded sizes shorter than the signal length
    for (const opt of Array.from(padSelect.options)) {
      if (opt.value === '') continue;
      opt.disabled = Number(opt.value) < state.n;
    }
    if (state.paddedN !== null && state.paddedN < state.n) {
      state.paddedN = null;
      padSelect.value = '';
      errBox.textContent = `补零长度不能短于信号长度 N=${state.n}，已取消补零。`;
    } else {
      errBox.textContent = '';
    }
  }

  root.querySelectorAll<HTMLInputElement>('input[name="sourceMode"]').forEach((r) => {
    r.addEventListener('change', () => {
      state.sourceMode = r.checked ? (r.value as 'compose' | 'draw') : state.sourceMode;
      const draw = state.sourceMode === 'draw';
      composePanel.hidden = draw;
      drawPanel.hidden = !draw;
      sampleCanvas.hidden = !draw;
      drawTimeDomain();
      drawSamples();
      emit();
    });
  });

  root.querySelector<HTMLButtonElement>('#clearDraw')!.addEventListener('click', () => {
    currentStroke = [];
    state.drawnSamples = new Array(state.n).fill(0);
    drawTimeDomain();
    drawSamples();
    emit();
  });

  root.querySelector<HTMLButtonElement>('#analyzeBtn')!.addEventListener('click', () => emit());

  // ---------------------------------------------------------------- hand draw
  let currentStroke: { x: number; y: number }[] = [];
  let drawing = false;

  timeCanvas.addEventListener('pointerdown', (e) => {
    if (state.sourceMode !== 'draw') return;
    drawing = true;
    timeCanvas.setPointerCapture(e.pointerId);
    const rect = timeCanvas.getBoundingClientRect();
    currentStroke = [{ x: e.clientX - rect.left, y: e.clientY - rect.top }];
  });
  timeCanvas.addEventListener('pointermove', (e) => {
    if (!drawing || state.sourceMode !== 'draw') return;
    const rect = timeCanvas.getBoundingClientRect();
    const point = { x: e.clientX - rect.left, y: e.clientY - rect.top };
    const last = currentStroke[currentStroke.length - 1];
    if (!last || Math.abs(point.x - last.x) > 1) {
      currentStroke.push(point);
      state.drawnSamples = resampleStroke(currentStroke, state.n, rect.width, rect.height);
      drawTimeDomain();
      drawSamples();
      emit();
    }
  });
  const stop = () => {
    if (!drawing) return;
    drawing = false;
    if (currentStroke.length > 0) {
      const rect = timeCanvas.getBoundingClientRect();
      state.drawnSamples = resampleStroke(currentStroke, state.n, rect.width, rect.height);
    }
    drawSamples();
    emit();
  };
  timeCanvas.addEventListener('pointerup', stop);
  timeCanvas.addEventListener('pointercancel', stop);

  // ---------------------------------------------------------------- rendering
  function drawTimeDomain(): void {
    const duration = state.n / state.sampleRate;
    let t: number[], y: number[];
    if (state.sourceMode === 'draw' && currentStroke.length > 1) {
      // show the raw stroke as a dense curve
      t = currentStroke.map((p) => (p.x / timeCanvas.clientWidth) * duration);
      y = currentStroke.map((p) => -(p.y - timeCanvas.clientHeight / 2) / (timeCanvas.clientHeight / 2));
    } else if (state.sourceMode === 'draw') {
      t = [0, duration];
      y = [0, 0];
    } else {
      const dense = denseSignal(state.components, 600, duration);
      t = dense.t; y = dense.y;
    }
    const series = [{ x: t, y, opts: { color: '#38bdf8', lineWidth: 2 } }];
    timePlot.draw(series, {
      title: '时域波形 x(t)', xLabel: '时间 (s)', yLabel: '幅度',
      xMin: 0, xMax: duration,
      yMin: niceAmp(y) * -1, yMax: niceAmp(y),
    });
  }

  function drawSamples(): void {
    if (state.sourceMode !== 'draw' && sampleCanvas.hidden) return;
    const samples = getSamples();
    const duration = state.n / state.sampleRate;
    const x = samples.map((_, i) => (i / (samples.length - 1)) * duration);
    const plot = new Plot(sampleCanvas);
    plot.draw([{ x, y: samples, opts: { color: '#f472b6', lineWidth: 1.5 } }], {
      title: `离散采样点 x[n]（N=${samples.length}）`, xLabel: '时间 (s)', yLabel: '幅度',
      xMin: 0, xMax: duration, yMin: -1.6, yMax: 1.6,
    });
  }

  subscribe(() => {
    drawTimeDomain();
    drawSamples();
  });

  renderList();
  drawTimeDomain();
  // expose for other panels
  void api;
}

function niceAmp(y: number[]): number {
  const m = Math.max(1, ...y.map((v) => Math.abs(v)));
  return Math.ceil(m * 1.2 * 10) / 10;
}

export function getSamples(): number[] {
  if (state.sourceMode === 'draw' && state.drawnSamples) return state.drawnSamples;
  return buildSignal(state.components, state.n, state.sampleRate);
}
