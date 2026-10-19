import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { checkWebBudgets, pageChunks } from './check-web-budgets.mjs';

function fixture(t) {
  const root = mkdtempSync(join(tmpdir(), 'web-budget-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const next = join(root, 'apps/web/.next');
  const put = (path, value) => {
    const target = join(next, path);
    mkdirSync(join(target, '..'), { recursive: true });
    writeFileSync(target, typeof value === 'string' ? value : JSON.stringify(value));
  };
  return { root, next, put };
}

test('legacy manifest deduplicates decoded JavaScript filenames', (t) => {
  const { next, put } = fixture(t);
  put('app-build-manifest.json', { pages: { '/page': ['root.js', 'root.js', 'x.css', 'a%5Bb%5D.js'] } });
  assert.deepEqual(pageChunks(next, '/page'), ['root.js', 'a[b].js']);
});

test('Next 16 counts root and page groups once, excluding inherited layout and error groups', (t) => {
  const { next, put } = fixture(t);
  put('build-manifest.json', { rootMainFiles: ['root.js', 'shared.js'] });
  const chunks = ['17', 'shared.js', '18', 'static/chunks/app/robot/%5B...parts%5D/page-abc.js'];
  put('server/app/robot/[...parts]/page_client-reference-manifest.js',
    `globalThis.__RSC_MANIFEST = ${JSON.stringify({ '/robot/[...parts]/page': { clientModules: {
      first: { chunks }, duplicate: { chunks },
      layout: { chunks: ['1', 'layout-only.js'] }, error: { chunks: ['2', 'error-only.js'] },
    } } })};`);
  assert.deepEqual(pageChunks(next, '/robot/[...parts]/page'),
    ['root.js', 'shared.js', 'static/chunks/app/robot/[...parts]/page-abc.js']);
});

test('incomplete Next 16 metadata fails closed instead of reporting a partial budget', (t) => {
  const { next, put } = fixture(t);
  put('build-manifest.json', { rootMainFiles: ['root.js'] });
  put('server/app/page_client-reference-manifest.js', 'globalThis.__RSC_MANIFEST = {};');
  assert.throws(() => pageChunks(next, '/page'), /Cannot reconstruct/);
});

test('both baseline regression and absolute caps remain enforced', (t) => {
  const { root, next, put } = fixture(t);
  put('app-build-manifest.json', { pages: { '/page': ['root.js'] } });
  put('root.js', 'x'.repeat(12));
  writeFileSync(join(next, '../performance-budgets.json'), JSON.stringify({ routes: [
    { route: '/', manifestKey: '/page', baselineBytes: 10, maxBytes: 100 },
  ] }));
  assert.throws(() => checkWebBudgets(root), /Web bundle budget exceeded/);
  writeFileSync(join(next, '../performance-budgets.json'), JSON.stringify({ routes: [
    { route: '/', manifestKey: '/page', baselineBytes: 100, maxBytes: 11 },
  ] }));
  assert.throws(() => checkWebBudgets(root), /Web bundle budget exceeded/);
});
