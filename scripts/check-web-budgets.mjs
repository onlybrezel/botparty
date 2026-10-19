import { existsSync, readFileSync, statSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { runInNewContext } from 'node:vm';

export function pageChunks(nextDir, manifestKey) {
  const manifestPath = [
    resolve(nextDir, 'app-build-manifest.json'),
    resolve(nextDir, 'server/app-build-manifest.json'),
  ].find(existsSync);
  if (manifestPath) {
    const files = JSON.parse(readFileSync(manifestPath, 'utf8')).pages?.[manifestKey];
    if (!Array.isArray(files) || files.length === 0) {
      throw new Error(`No Next.js chunks found for ${manifestKey}`);
    }
    return [...new Set(files.filter((file) => file.endsWith('.js')).map(decodeURIComponent))];
  }

  // Next 16 removed app-build-manifest. Preserve its page-entrypoint metric:
  // main-app files plus the page's own group, excluding inherited layouts.
  const buildManifest = JSON.parse(readFileSync(resolve(nextDir, 'build-manifest.json'), 'utf8'));
  const context = Object.create(null);
  const referencePath = resolve(nextDir, `server/app${manifestKey}_client-reference-manifest.js`);
  runInNewContext(readFileSync(referencePath, 'utf8'), context, { timeout: 1000 });
  const reference = context.__RSC_MANIFEST?.[manifestKey];
  const prefix = `static/chunks/app${manifestKey}-`;
  const pageGroups = Object.values(reference?.clientModules ?? {})
    .map((entry) => entry.chunks)
    .filter(Array.isArray)
    .map((chunks) => chunks
      .filter((file) => typeof file === 'string' && file.endsWith('.js'))
      .map(decodeURIComponent))
    .filter((chunks) => chunks.some((file) => file.startsWith(prefix)));
  if (!Array.isArray(buildManifest.rootMainFiles)
      || buildManifest.rootMainFiles.length === 0 || pageGroups.length === 0) {
    throw new Error(`Cannot reconstruct Next.js page entrypoint for ${manifestKey}`);
  }
  return [...new Set([...buildManifest.rootMainFiles, ...pageGroups.flat()]
    .filter((file) => file.endsWith('.js')).map(decodeURIComponent))];
}

export function checkWebBudgets(root) {
  const nextDir = resolve(root, 'apps/web/.next');
  const budgetConfig = JSON.parse(
    readFileSync(resolve(root, 'apps/web/performance-budgets.json'), 'utf8'),
  );
  const results = budgetConfig.routes.map((route) => {
    const files = pageChunks(nextDir, route.manifestKey);
    const bytes = files.reduce((total, file) => total + statSync(resolve(nextDir, file)).size, 0);
    const limit = Math.min(route.maxBytes, Math.floor(route.baselineBytes * 1.1));
    return { route: route.route, bytes, limit, maxBytes: route.maxBytes, baselineBytes: route.baselineBytes };
  });
  for (const result of results) {
    console.log(
      `${result.route}: ${result.bytes} bytes (limit ${result.limit}, baseline ${result.baselineBytes})`,
    );
  }
  const failed = results.filter((result) => result.bytes > result.limit);
  if (failed.length > 0) {
    throw new Error(`Web bundle budget exceeded for: ${failed.map((result) => result.route).join(', ')}`);
  }
  return results;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  checkWebBudgets(resolve(import.meta.dirname, '..'));
}
