import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const inputs = [
  'apps/api/src',
  'apps/web/src',
  'packages/prisma/seed.ts',
  'docker-compose.yml',
  'docker-compose.dev.yml',
  'docker/api/Dockerfile',
  'docker/web/Dockerfile',
  'scripts/benchmark-queue.ts',
  'scripts/migrate-webhook-secrets.mjs',
  'scripts/prepare-prisma-baseline.mjs',
  'scripts/validate-public-env.mjs',
  'scripts/verify-prisma-migrations.mjs',
];

const ignored = new Set([
  'CI',
  'GITHUB_ACTIONS',
  'NODE_OPTIONS',
  'NEXT_RUNTIME',
  'npm_package_version',
]);

function filesAt(path) {
  const result = BunLikeGlob(path);
  return result;
}

function BunLikeGlob(path) {
  const { execFileSync } = awaitImportChildProcess();
  const output = execFileSync('rg', ['--files', path], { cwd: root, encoding: 'utf8' });
  return output.trim().split('\n').filter(Boolean);
}

function awaitImportChildProcess() {
  // Kept synchronous so the check is deterministic and produces one concise error.
  return childProcess;
}

import * as childProcess from 'node:child_process';

const files = inputs.flatMap((entry) => {
  try {
    return filesAt(entry);
  } catch {
    return [entry];
  }
});

const used = new Set();
for (const file of files) {
  const source = readFileSync(resolve(root, file), 'utf8');
  const patterns = [
    /process\.env\.([A-Za-z_][A-Za-z0-9_]*)/g,
    /process\.env\[['"]([A-Za-z_][A-Za-z0-9_]*)['"]\]/g,
    /config(?:Service)?\.(?:get|getOrThrow)(?:<[^>]+>)?\(\s*['"]([A-Z][A-Z0-9_]*)['"]/g,
  ];
  if (file.includes('docker-compose')) patterns.push(/\$\{([A-Z][A-Z0-9_]*)(?=[:}?])/g);
  if (file.endsWith('Dockerfile')) patterns.push(/\bARG\s+([A-Z][A-Z0-9_]*)/g);
  for (const pattern of patterns) {
    for (const match of source.matchAll(pattern)) used.add(match[1]);
  }
}

const documented = new Set();
const example = readFileSync(resolve(root, '.env.example'), 'utf8');
for (const match of example.matchAll(/^#?\s*([A-Z][A-Z0-9_]*)=/gm)) documented.add(match[1]);

const missing = [...used].filter((name) => !documented.has(name) && !ignored.has(name)).sort();
if (missing.length > 0) {
  console.error(`Environment variables used but not documented in .env.example:\n${missing.join('\n')}`);
  process.exit(1);
}

console.log(`Environment parity passed: ${used.size} used variables are documented or explicitly runtime-owned.`);
