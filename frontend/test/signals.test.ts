// Node:test checks for the browser-side signal construction math.
// Run with: node --test --import tsx test/signals.test.ts

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildSignal, resampleStroke, sampleComponent, waveformValue } from '../src/signals';
import type { SignalComponent } from '../src/types';

const cmp = (patch: Partial<SignalComponent> = {}): SignalComponent => ({
  id: 1, type: 'sine', amplitude: 1, frequency: 1, phase: 0, enabled: true, ...patch,
});

test('sine/cosine values at quarter periods', () => {
  assert.ok(Math.abs(waveformValue('sine', 0) - 0) < 1e-12);
  assert.ok(Math.abs(waveformValue('sine', Math.PI / 2) - 1) < 1e-12);
  assert.ok(Math.abs(waveformValue('cosine', 0) - 1) < 1e-12);
  assert.ok(Math.abs(waveformValue('cosine', Math.PI) + 1) < 1e-12);
});

test('square wave switches at pi', () => {
  assert.equal(waveformValue('square', 0.1), 1);
  assert.equal(waveformValue('square', Math.PI + 0.1), -1);
});

test('triangle and sawtooth stay within [-1, 1]', () => {
  for (const type of ['triangle', 'sawtooth'] as const) {
    for (let p = 0; p <= 8; p += 0.25) {
      const v = waveformValue(type, p);
      assert.ok(v >= -1 - 1e-12 && v <= 1 + 1e-12, `${type} ${p} -> ${v}`);
    }
  }
});

test('built signal sums enabled components and ignores disabled', () => {
  const comps = [cmp({ amplitude: 1 }), cmp({ id: 2, amplitude: 2, enabled: false })];
  const signal = buildSignal(comps, 16, 8);
  assert.equal(signal.length, 16);
  const single = sampleComponent(comps[0], 16, 8);
  assert.deepEqual(signal, single);
});

test('component at an exact bin lands energy in one period of N samples', () => {
  // 1 Hz over fs=8Hz, N=8 => one sample per hour, 8 samples per cycle
  const n = 8, fs = 8;
  const signal = buildSignal([cmp({ type: 'cosine', frequency: 1 })], n, fs);
  const mean = signal.reduce((a, b) => a + b, 0) / n;
  assert.ok(Math.abs(mean) < 1e-12);
  const energy = signal.reduce((a, b) => a + b * b, 0);
  assert.ok(Math.abs(energy - n / 2) < 1e-9);
});

test('empty stroke yields zeros', () => {
  assert.deepEqual(resampleStroke([], 32, 100, 100), new Array(32).fill(0));
});

test('horizontal stroke through canvas centre yields zeros', () => {
  const stroke = Array.from({ length: 50 }, (_, i) => ({ x: i * 2, y: 50 }));
  const out = resampleStroke(stroke, 64, 100, 100);
  assert.ok(out.every((v) => Math.abs(v) < 1e-9));
});

test('stroke along top edge yields positive values', () => {
  const stroke = Array.from({ length: 50 }, (_, i) => ({ x: i * 2, y: 10 }));
  const out = resampleStroke(stroke, 64, 100, 100);
  assert.ok(out.every((v) => v > 0.5));
});
