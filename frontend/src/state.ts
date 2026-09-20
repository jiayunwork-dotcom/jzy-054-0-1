// Tiny observable store — no framework, just a typed state object with
// subscribe/emit. Modules mutate state and rerender their own sections.

import type {
  AliasInfo, DFTResponse, FilterResponse, FilterType, SamplingDemo,
  SignalComponent, WindowCompareCurve, WindowName,
} from './types';

export type SourceMode = 'compose' | 'draw';

export interface State {
  // signal construction
  components: SignalComponent[];
  sourceMode: SourceMode;
  drawnSamples: number[] | null;
  nextComponentId: number;

  // sampling / DFT settings
  n: number;
  sampleRate: number;
  paddedN: number | null;

  // analysis results
  spectrum: DFTResponse | null;
  selectedWindow: WindowName;
  kaiserBeta: number;
  windowCurves: WindowCompareCurve[] | null;
  spectrumError: string | null;

  // sampling theorem
  demo: SamplingDemo | null;
  demoFreq: number;
  demoSampleRate: number;

  // filtering
  filterType: FilterType;
  filterLow: number;
  filterHigh: number;
  filterResult: FilterResponse | null;
  filterError: string | null;
}

export const state: State = {
  components: [
    { id: 1, type: 'sine', amplitude: 1, frequency: 50, phase: 0, enabled: true },
  ],
  sourceMode: 'compose',
  drawnSamples: null,
  nextComponentId: 2,

  n: 256,
  sampleRate: 1000,
  paddedN: null,

  spectrum: null,
  selectedWindow: 'rectangular',
  kaiserBeta: 8.6,
  windowCurves: null,
  spectrumError: null,

  demo: null,
  demoFreq: 40,
  demoSampleRate: 100,

  filterType: 'lowpass',
  filterLow: 0,
  filterHigh: 200,
  filterResult: null,
  filterError: null,
};

type Listener = () => void;
const listeners = new Set<Listener>();

export function subscribe(fn: Listener): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

export function emit(): void {
  for (const fn of listeners) fn();
}

export function currentSamples(): number[] {
  if (state.sourceMode === 'draw' && state.drawnSamples) {
    return state.drawnSamples;
  }
  // compose mode: build locally (signals.ts) — lazy import avoided by
  // registering the builder at app start.
  return sampleBuilder(state);
}

// Indirection so signals.ts (which imports types only) can be plugged in
// without creating an import cycle.
type Builder = (s: State) => number[];
let sampleBuilder: Builder = () => new Array(state.n).fill(0);
export function registerSampleBuilder(fn: Builder): void {
  sampleBuilder = fn;
}

export function aliasInfo(demo?: SamplingDemo): AliasInfo | null {
  return (demo ?? state.demo)?.aliasing ?? null;
}
