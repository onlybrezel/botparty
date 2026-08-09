import { readdirSync, readFileSync } from 'node:fs';
import { extname, relative, resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const sourceRoot = resolve(root, 'apps/web/src');
const DEFAULT_MAX_LINES = 500;
const legacyBudgets = new Map(
  Object.entries({
    'apps/web/src/components/dashboard/use-dashboard-page.ts': 972,
    'apps/web/src/components/robot-view/use-robot-view-state.ts': 1266,
    'apps/web/src/components/livekit/video-renderer.tsx': 774,
    'apps/web/src/app/mod/page.tsx': 751,
    'apps/web/src/components/mod/runtime-view.tsx': 593,
    'apps/web/src/app/settings/page.tsx': 616,
    'apps/web/src/app/wallet/page.tsx': 501,
    'apps/web/src/components/dashboard/dashboard-settings-section.tsx': 559,
  }),
);

function* sourceFiles(directory) {
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const path = resolve(directory, entry.name);
    if (entry.isDirectory()) yield* sourceFiles(path);
    else if (['.ts', '.tsx'].includes(extname(entry.name))) yield path;
  }
}

const violations = [];
for (const file of sourceFiles(sourceRoot)) {
  const projectPath = relative(root, file).replaceAll('\\', '/');
  const source = readFileSync(file, 'utf8');
  const lines = source.split(/\r?\n/).length - (source.endsWith('\n') ? 1 : 0);
  const limit = legacyBudgets.get(projectPath) ?? DEFAULT_MAX_LINES;
  if (lines > limit) violations.push(`${projectPath}: ${lines} lines (limit ${limit})`);
}

if (violations.length > 0) {
  throw new Error(`Web module size budget exceeded:\n${violations.join('\n')}`);
}

console.log(
  `Web module size budget passed; new TypeScript modules are limited to ${DEFAULT_MAX_LINES} lines.`,
);
