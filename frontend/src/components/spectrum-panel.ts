// Middle panel: N / sample-rate aware DFT spectra (magnitude, phase, power).

import { api } from '../api';
import { emit, state, subscribe } from '../state';
import type { DFTResponse } from '../types';
import { drawSpectrum } from './plot';

export function initSpectrumPanel(root: HTMLElement): void {
  root.innerHTML = `
    <h2>② 离散傅里叶变换</h2>
    <div class="row wrap">
      <label>窗函数
        <select id="windowSelect">
          <option value="rectangular">矩形窗</option>
          <option value="hann">汉宁窗</option>
          <option value="hamming">汉明窗</option>
          <option value="blackman">布莱克曼窗</option>
          <option value="kaiser">凯泽窗 Kaiser</option>
        </select>
      </label>
      <label id="betaRow" hidden>Kaiser β
        <input type="range" id="betaInput" min="0" max="14" step="0.1" value="8.6">
        <span id="betaVal" class="val">8.6</span>
      </label>
    </div>
    <div id="spectrumStatus" class="hint">调整信号后点击「计算频谱」。</div>
    <div id="energyLine" class="hint"></div>
    <div class="canvas-wrap spectra">
      <canvas id="magCanvas" height="180"></canvas>
      <canvas id="phaseCanvas" height="180"></canvas>
      <canvas id="powerCanvas" height="180"></canvas>
    </div>
  `;

  const windowSelect = root.querySelector<HTMLSelectElement>('#windowSelect')!;
  const betaRow = root.querySelector<HTMLLabelElement>('#betaRow')!;
  const betaInput = root.querySelector<HTMLInputElement>('#betaInput')!;
  const betaVal = root.querySelector<HTMLSpanElement>('#betaVal')!;
  const status = root.querySelector<HTMLDivElement>('#spectrumStatus')!;
  const energyLine = root.querySelector<HTMLDivElement>('#energyLine')!;
  const magCanvas = root.querySelector<HTMLCanvasElement>('#magCanvas')!;
  const phaseCanvas = root.querySelector<HTMLCanvasElement>('#phaseCanvas')!;
  const powerCanvas = root.querySelector<HTMLCanvasElement>('#powerCanvas')!;

  windowSelect.addEventListener('change', () => {
    state.selectedWindow = windowSelect.value as typeof state.selectedWindow;
    betaRow.hidden = state.selectedWindow !== 'kaiser';
    emit();
  });
  betaInput.addEventListener('input', () => {
    state.kaiserBeta = Number(betaInput.value);
    betaVal.textContent = betaInput.value;
    emit();
  });

  let pending: Promise<void> | null = null;
  let pendingTimer: number | undefined;

  async function refresh(): Promise<void> {
    const samples = getSamplesLazy();
    if (!samples.some((v) => v !== 0)) {
      status.textContent = '当前为全零信号：频谱处处为 0（合法退化情形）。';
    } else {
      status.textContent = '计算中…';
    }
    try {
      const result = await api.dft({
        samples,
        sample_rate: state.sampleRate,
        n: state.paddedN ?? state.n,
        window: state.selectedWindow === 'rectangular' ? undefined : state.selectedWindow,
        beta: state.selectedWindow === 'kaiser' ? state.kaiserBeta : undefined,
      });
      state.spectrum = result;
      state.spectrumError = null;
      drawAll(result);
      status.textContent =
        `N=${result.n}，fs=${state.sampleRate} Hz，频率分辨率 ${(state.sampleRate / result.n).toFixed(2)} Hz` +
        (state.paddedN && state.paddedN !== state.n ? '（已补零，频谱被插值细化）' : '');
      const ratio = result.freq_energy / result.time_energy;
      energyLine.textContent =
        `帕塞瓦尔校验：时域能量 Σ|x|²=${result.time_energy.toFixed(4)}，` +
        `频域能量 (1/N)Σ|X|²=${result.freq_energy.toFixed(4)}，比值=${ratio.toFixed(6)}`;
      emit();
    } catch (err) {
      state.spectrumError = (err as Error).message;
      status.textContent = '请求被后端拒绝：' + state.spectrumError;
      energyLine.textContent = '';
    }
  }

  // debounce rapid slider changes
  subscribe(() => {
    window.clearTimeout(pendingTimer);
    pendingTimer = window.setTimeout(() => {
      pending = refresh();
    }, 180);
  });

  // viewport resize: repaint the last result without another request
  window.addEventListener('fourier:redraw', () => {
    if (state.spectrum) drawAll(state.spectrum);
  });

  function drawAll(r: DFTResponse): void {
    const oneSided = Math.floor(r.n / 2) + 1;
    drawSpectrum(magCanvas, r.frequencies, r.magnitude, {
      title: '幅度谱 |X(f)|', yLabel: '幅度', maxBins: oneSided, color: '#38bdf8',
    });
    drawSpectrum(phaseCanvas, r.frequencies, r.phase, {
      title: '相位谱 ∠X(f)', yLabel: '相位 (rad)', maxBins: oneSided, color: '#fbbf24',
    });
    drawSpectrum(powerCanvas, r.frequencies, r.power, {
      title: '功率谱 |X(f)|²', yLabel: '功率', maxBins: oneSided, color: '#34d399',
    });
  }

  void pending;
}

// local import kept at bottom to avoid circular initialisation concerns
import { getSamples } from './signal-builder';
function getSamplesLazy(): number[] {
  return getSamples();
}
