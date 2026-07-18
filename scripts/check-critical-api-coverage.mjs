#!/usr/bin/env node

import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const REPOSITORY_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const COVERAGE_FILE = path.join(REPOSITORY_ROOT, 'apps/api/coverage/coverage-final.json');
const MINIMUM_PERCENT = 90;
const CRITICAL_FILES = [
  'apps/api/src/auth/auth.service.ts',
  'apps/api/src/billing/billing.service.ts',
  'apps/api/src/controls/controls.service.ts',
  'apps/api/src/earnings/payouts.service.ts',
  'apps/api/src/gateway/control.handler.ts',
  'apps/api/src/livekit/livekit.service.ts',
  'apps/api/src/wallet/donation.service.ts',
  'apps/api/src/wallet/wallet.service.ts',
];

function summary(entry) {
  const lineHits = new Map();
  for (const [id, location] of Object.entries(entry.statementMap)) {
    const line = location.start.line;
    lineHits.set(line, Math.max(lineHits.get(line) ?? 0, entry.s[id] ?? 0));
  }

  const counters = {
    statements: Object.values(entry.s),
    functions: Object.values(entry.f),
    branches: Object.values(entry.b).flat(),
    lines: [...lineHits.values()],
  };

  return Object.fromEntries(
    Object.entries(counters).map(([metric, values]) => {
      const total = values.length;
      const covered = values.filter((hits) => hits > 0).length;
      const percent = total === 0 ? 100 : Math.floor((covered / total) * 10_000) / 100;
      return [metric, { total, covered, percent }];
    }),
  );
}

const coverage = JSON.parse(await readFile(COVERAGE_FILE, 'utf8'));
const failures = [];

for (const relativeFile of CRITICAL_FILES) {
  const absoluteFile = path.join(REPOSITORY_ROOT, relativeFile);
  const entry = coverage[absoluteFile];
  if (!entry) {
    failures.push(`${relativeFile}: missing from coverage report`);
    continue;
  }

  const fileSummary = summary(entry);
  const rendered = Object.entries(fileSummary)
    .map(([metric, value]) => `${metric} ${value.percent.toFixed(2)}%`)
    .join(', ');
  console.log(`${relativeFile}: ${rendered}`);

  for (const [metric, value] of Object.entries(fileSummary)) {
    if (value.percent < MINIMUM_PERCENT) {
      failures.push(
        `${relativeFile}: ${metric} ${value.percent.toFixed(2)}% < ${MINIMUM_PERCENT}%`,
      );
    }
  }
}

if (failures.length > 0) {
  console.error(`Critical API coverage gate failed:\n${failures.join('\n')}`);
  process.exit(1);
}

console.log(`Critical API coverage gate passed (${MINIMUM_PERCENT}% per metric).`);
