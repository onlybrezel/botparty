import assert from 'node:assert/strict';
import test from 'node:test';
import { assertPerformanceTargetAllowed } from './performance-target.mjs';

test('allows loopback targets without the Docker opt-in', () => {
  assert.doesNotThrow(() => assertPerformanceTargetAllowed(new URL('http://127.0.0.1:4000'), false));
});

test('allows the isolated matrix gateway only with the Docker opt-in', () => {
  assert.throws(() => assertPerformanceTargetAllowed(new URL('http://performance-gateway:8080'), false));
  assert.doesNotThrow(() => assertPerformanceTargetAllowed(new URL('http://performance-gateway:8080'), true));
});

test('rejects public targets even with the Docker opt-in', () => {
  assert.throws(() => assertPerformanceTargetAllowed(new URL('https://example.com'), true));
});
