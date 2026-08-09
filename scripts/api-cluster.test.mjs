import assert from 'node:assert/strict';
import test from 'node:test';
import { workerCount, workerHeapMb } from './api-cluster.mjs';

test('accepts an explicit worker count', () => {
  assert.equal(workerCount('32'), 32);
});

test('rejects unsafe worker counts', () => {
  assert.throws(() => workerCount('0'), /API_WORKERS/);
  assert.throws(() => workerCount('65'), /API_WORKERS/);
  assert.throws(() => workerCount('1.5'), /API_WORKERS/);
});

test('reserves native memory and divides the heap between workers', () => {
  assert.equal(workerHeapMb(1_536, 2), 499);
  assert.equal(workerHeapMb(256, 1), 166);
  assert.equal(workerHeapMb(null, 8), null);
});
