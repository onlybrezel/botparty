import { existsSync, readFileSync, statSync } from 'node:fs';
import { resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const nextDir = resolve(root, 'apps/web/.next');
const manifestPath = [
  resolve(nextDir, 'app-build-manifest.json'),
  resolve(nextDir, 'server/app-build-manifest.json'),
].find(existsSync);
if (!manifestPath) {
  throw new Error('Next.js app build manifest is missing; run the web production build first');
}
const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
const budgetConfig = JSON.parse(
  readFileSync(resolve(root, 'apps/web/performance-budgets.json'), 'utf8'),
);
const results = [];

for (const route of budgetConfig.routes) {
  const files = manifest.pages?.[route.manifestKey];
  if (!Array.isArray(files) || files.length === 0) {
    throw new Error(`No Next.js chunks found for ${route.manifestKey}`);
  }
  const unique = [...new Set(files.filter((file) => file.endsWith('.js')))];
  const bytes = unique.reduce((total, file) => total + statSync(resolve(nextDir, file)).size, 0);
  const regressionLimit = Math.floor(route.baselineBytes * 1.1);
  const limit = Math.min(route.maxBytes, regressionLimit);
  results.push({
    route: route.route,
    bytes,
    limit,
    maxBytes: route.maxBytes,
    baselineBytes: route.baselineBytes,
  });
}

for (const result of results) {
  console.log(
    `${result.route}: ${result.bytes} bytes (limit ${result.limit}, baseline ${result.baselineBytes})`,
  );
}
const failed = results.filter((result) => result.bytes > result.limit);
if (failed.length > 0) {
  throw new Error(
    `Web bundle budget exceeded for: ${failed.map((result) => result.route).join(', ')}`,
  );
}
