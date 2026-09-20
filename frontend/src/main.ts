// Application bootstrap: mount panels, fetch backend config.

import './styles.css';
import { initFilterPanel } from './components/filter-panel';
import { initSamplingPanel } from './components/sampling-panel';
import { initSignalBuilder } from './components/signal-builder';
import { initSpectrumPanel } from './components/spectrum-panel';
import { initWindowCompare } from './components/window-compare';
import { api } from './api';

async function boot(): Promise<void> {
  const app = document.querySelector<HTMLDivElement>('#app')!;
  app.innerHTML = `
    <header>
      <h1>傅里叶变换实验室</h1>
      <div class="sub">叠波形 · 看频谱 · 拨采样率 · 做滤波 —— 前端搭信号，后端做变换
        <span id="backendState" class="pill">连接后端中…</span></div>
    </header>
    <main>
      <section id="leftPanel" class="panel"></section>
      <section id="centerPanel" class="panel">
        <div id="spectrumSlot"></div>
        <div id="filterSlot"></div>
      </section>
      <section id="rightPanel" class="panel">
        <div id="windowSlot"></div>
        <div id="samplingSlot"></div>
      </section>
    </main>
    <footer>
      DFT 约定：X[k]=Σx[n]e<sup>-j2πkn/N</sup>，逆变换 1/N 归一化；
      帕塞瓦尔：Σ|x|²=(1/N)Σ|X|²。所有算术由 Python 后端完成并由自动化测试守护。
    </footer>
  `;

  initSignalBuilder(document.querySelector('#leftPanel')!);
  initSpectrumPanel(document.querySelector('#spectrumSlot')!);
  initWindowCompare(document.querySelector('#windowSlot')!);
  initSamplingPanel(document.querySelector('#samplingSlot')!);
  initFilterPanel(document.querySelector('#filterSlot')!);

  // Resizing the viewport should repaint canvases from cached results
  // without hammering the backend — debounced custom event.
  let resizeTimer: number | undefined;
  window.addEventListener('resize', () => {
    window.clearTimeout(resizeTimer);
    resizeTimer = window.setTimeout(() => {
      window.dispatchEvent(new Event('fourier:redraw'));
    }, 150);
  });

  try {
    const cfg = await api.config();
    const pill = document.querySelector<HTMLSpanElement>('#backendState')!;
    pill.textContent = `后端已连接 · 可选 N：${cfg.allowed_fft_sizes.join('/')}`;
    pill.classList.add('ok');
  } catch (err) {
    const pill = document.querySelector<HTMLSpanElement>('#backendState')!;
    pill.textContent = '后端不可用：' + (err as Error).message;
    pill.classList.add('bad');
  }
}

boot();
