import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import './prepare-browser.mjs';

const tsc = createRequire(import.meta.url).resolve('typescript/bin/tsc');
const children = [[], ['-p', 'tsconfig.browser.json']].map((args) =>
  spawn(process.execPath, [tsc, ...args, '--watch'], { stdio: 'inherit' }));
for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => {
    for (const child of children) child.kill(signal);
  });
}
for (const child of children) {
  child.on('exit', (code) => {
    for (const sibling of children) if (sibling !== child) sibling.kill();
    process.exitCode = code ?? 1;
  });
}
