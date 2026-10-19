import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';

test('OpenAPI table descriptions cannot escape their cell with a backslash or carriage return', () => {
  const directory = mkdtempSync(join(tmpdir(), 'botparty-api-docs-'));
  const input = join(directory, 'openapi.json');
  const output = join(directory, 'api.md');
  try {
    writeFileSync(input, JSON.stringify({
      openapi: '3.0.0',
      info: { title: 'Fixture', version: '1.0.0' },
      paths: {
        '/fixture': {
          get: {
            parameters: [{ name: 'q', in: 'query', description: 'before\\|after\rnext', schema: { type: 'string' } }],
            responses: { 200: { description: 'OK' } },
          },
        },
      },
    }));
    execFileSync(process.execPath, [fileURLToPath(new URL('./generate-api-client-docs.mjs', import.meta.url)), '--input', input, '--output', output]);
    const markdown = readFileSync(output, 'utf8');
    assert.ok(markdown.includes('before' + '\\'.repeat(3) + '|after next'));
    assert.ok(!markdown.includes('\r'));
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
