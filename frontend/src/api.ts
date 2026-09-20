// Thin fetch wrapper around the FastAPI backend. All errors carry the
// backend's explanatory Chinese message.

import type {
  AppConfig,
  DFTResponse,
  FilterResponse,
  FilterType,
  SamplingDemo,
  WindowCompareCurve,
  WindowName,
} from './types';

const BASE = '/api';

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const resp = await fetch(BASE + path, {
    headers: { 'Content-Type': 'application/json' },
    ...init,
  });
  if (!resp.ok) {
    let message = `HTTP ${resp.status}`;
    try {
      const body = await resp.json();
      if (body?.detail) message = typeof body.detail === 'string' ? body.detail : JSON.stringify(body.detail);
    } catch {
      /* keep generic message */
    }
    throw new Error(message);
  }
  return resp.json() as Promise<T>;
}

export const api = {
  config: () => request<AppConfig>('/config'),

  dft: (params: {
    samples: number[];
    sample_rate: number;
    n?: number;
    window?: WindowName;
    beta?: number;
  }) => request<DFTResponse>('/dft', { method: 'POST', body: JSON.stringify(params) }),

  idft: (real: number[], imag: number[]) =>
    request<{ samples: number[] }>('/idft', {
      method: 'POST',
      body: JSON.stringify({ real, imag }),
    }),

  filter: (params: {
    samples: number[];
    sample_rate: number;
    filter_type: FilterType;
    low_hz: number;
    high_hz: number;
    n?: number;
  }) => request<FilterResponse>('/filter', { method: 'POST', body: JSON.stringify(params) }),

  alias: (signalFreq: number, sampleRate: number) =>
    request<{ aliased: boolean; apparent_freq: number; nyquist: number }>(
      `/alias?signal_freq=${signalFreq}&sample_rate=${sampleRate}`,
    ),

  samplingDemo: (params: { signal_freq: number; sample_rate: number; duration?: number }) =>
    request<SamplingDemo>('/sampling-demo', { method: 'POST', body: JSON.stringify(params) }),

  windowsCompare: (params: {
    samples: number[];
    sample_rate: number;
    n?: number;
    windows: { name: WindowName; beta?: number }[];
  }) =>
    request<{ curves: WindowCompareCurve[] }>('/windows/compare', {
      method: 'POST',
      body: JSON.stringify(params),
    }),
};
