// Shared TypeScript types mirroring the backend API contracts.

export type WaveformType = 'sine' | 'cosine' | 'square' | 'triangle' | 'sawtooth';
export type WindowName = 'rectangular' | 'hann' | 'hamming' | 'blackman' | 'kaiser';
export type FilterType = 'lowpass' | 'highpass' | 'bandpass';

export interface SignalComponent {
  id: number;
  type: WaveformType;
  amplitude: number;
  frequency: number; // Hz
  phase: number;     // radians
  enabled: boolean;
}

export interface WindowInfo {
  name: WindowName;
  label: string;
  main_lobe_bins: number | null;
  peak_sidelobe_db: number | null;
  beta?: number;
}

export interface DFTResponse {
  n: number;
  sample_rate: number;
  frequencies: number[];
  real: number[];
  imag: number[];
  magnitude: number[];
  phase: number[];
  power: number[];
  time_energy: number;
  freq_energy: number;
  window: string;
  beta?: number;
}

export interface WindowCompareCurve {
  name: string;
  label: string;
  metrics: { main_lobe_bins: number | null; peak_sidelobe_db: number | null };
  magnitude: number[];
  power: number[];
  frequencies: number[];
}

export interface FilterResponse {
  n: number;
  sample_rate: number;
  frequencies: number[];
  mask: number[];
  original_magnitude: number[];
  original_phase: number[];
  filtered_magnitude: number[];
  filtered_phase: number[];
  filtered_samples: number[];
}

export interface AliasInfo {
  signal_freq: number;
  sample_rate: number;
  nyquist: number;
  aliased: boolean;
  apparent_freq: number;
  ratio: number;
}

export interface SamplingDemo {
  signal_freq: number;
  sample_rate: number;
  amplitude: number;
  phase: number;
  duration: number;
  dense_t: number[];
  dense_y: number[];
  sample_t: number[];
  sample_y: number[];
  reconstructed_t: number[];
  reconstructed_y: number[];
  aliasing: AliasInfo;
}

export interface AppConfig {
  allowed_fft_sizes: number[];
  windows: WindowInfo[];
  filter_types: FilterType[];
  max_components: number;
}
