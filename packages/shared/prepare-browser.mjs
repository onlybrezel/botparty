import { mkdirSync, writeFileSync } from 'node:fs';

// Keep the browser output unambiguously ESM while retaining the Node CJS API.
const output = new URL('./dist/browser/', import.meta.url);
mkdirSync(output, { recursive: true });
writeFileSync(new URL('package.json', output), JSON.stringify({ type: 'module' }) + '\n');
