import {
  accessSync,
  constants,
  readFileSync,
  readdirSync,
  rmSync,
} from 'node:fs';
import { spawn, spawnSync } from 'node:child_process';
import { resolve } from 'node:path';

const candidates = [
  process.env.CHROME_PATH,
  '/usr/bin/google-chrome',
  '/usr/bin/chromium',
  '/usr/bin/chromium-browser',
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
].filter(Boolean);

const chromePath = candidates.find((candidate) => {
  try {
    accessSync(candidate, constants.X_OK);
    return true;
  } catch {
    return false;
  }
});

if (!chromePath) {
  console.error('No Chrome/Chromium executable found. Set CHROME_PATH before running Lighthouse.');
  process.exit(1);
}

const configPath = resolve('lighthouserc.json');
const outputDirectory = resolve('.lighthouseci');
const lighthouseEnvironment = { ...process.env, CHROME_PATH: chromePath };
const competingProcessPatterns = [
  /(?:^|[/\s])jest(?:\.js)?(?:\s|$)/i,
  /(?:^|[/\s])vitest(?:\.mjs)?(?:\s|$)/i,
  /@playwright\/test\/cli\.js\s+test(?:\s|$)/i,
  /playwright\s+test(?:\s|$)/i,
  /next\/dist\/bin\/next\s+build(?:\s|$)/i,
  /(?:^|[/\s])pnpm(?:\.cjs)?\s+install(?:\s|$)/i,
];
const idleStabilityChecks = 15;

function finishFromResult(result) {
  if (result.error) throw result.error;
  if (result.signal) {
    console.error(`Lighthouse terminated by ${result.signal}.`);
    process.exit(1);
  }
  return result.status ?? 1;
}

function runLhciSync(args) {
  return finishFromResult(spawnSync('lhci', args, {
    env: lighthouseEnvironment,
    stdio: 'inherit',
  }));
}

function findCompetingProcesses() {
  const result = spawnSync('ps', ['-eo', 'pid=,args='], { encoding: 'utf8' });
  if (result.status !== 0 || !result.stdout) {
    return [];
  }

  return result.stdout
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .filter((line) => !line.includes('@playwright/mcp'))
    .filter((line) => competingProcessPatterns.some((pattern) => pattern.test(line)));
}

function wait(delayMs) {
  return new Promise((resolveWait) => setTimeout(resolveWait, delayMs));
}

async function waitForIdleWindow() {
  let stableChecks = 0;
  let lastNoticeAt = 0;

  while (stableChecks < idleStabilityChecks) {
    const competingProcesses = findCompetingProcesses();
    if (competingProcesses.length === 0) {
      stableChecks += 1;
    } else {
      stableChecks = 0;
      const now = Date.now();
      if (now - lastNoticeAt >= 30_000) {
        console.log(`Waiting for competing test/build work to finish (${competingProcesses.length} process(es))...`);
        lastNoticeAt = now;
      }
    }
    await wait(2_000);
  }
}

function listOutputFiles() {
  try {
    return new Set(readdirSync(outputDirectory));
  } catch {
    return new Set();
  }
}

function removeFilesAddedSince(before) {
  for (const fileName of listOutputFiles()) {
    if (!before.has(fileName)) {
      rmSync(resolve(outputDirectory, fileName), { force: true, recursive: true });
    }
  }
}

async function runTrackedCollection(args) {
  let competingWorkDetected = false;
  const timer = setInterval(() => {
    if (findCompetingProcesses().length > 0) {
      competingWorkDetected = true;
    }
  }, 1_000);

  const result = await new Promise((resolveResult, reject) => {
    const child = spawn('lhci', args, {
      env: lighthouseEnvironment,
      stdio: 'inherit',
    });
    child.once('error', reject);
    child.once('exit', (status, signal) => resolveResult({ status, signal }));
  }).finally(() => clearInterval(timer));

  if (result.signal) {
    throw new Error(`Lighthouse collection terminated by ${result.signal}.`);
  }
  return {
    status: result.status ?? 1,
    competingWorkDetected,
  };
}

async function runResourceAwareLocalCollection() {
  const config = JSON.parse(readFileSync(configPath, 'utf8'));
  const urls = config?.ci?.collect?.url;
  const numberOfRuns = config?.ci?.collect?.numberOfRuns ?? 3;
  if (!Array.isArray(urls) || urls.length === 0) {
    throw new Error('lighthouserc.json must define at least one ci.collect.url.');
  }

  let acceptedRuns = 0;
  for (const url of urls) {
    for (let runNumber = 1; runNumber <= numberOfRuns; runNumber += 1) {
      let accepted = false;
      while (!accepted) {
        await waitForIdleWindow();
        const outputBefore = listOutputFiles();
        console.log(`Collecting ${url} (${runNumber}/${numberOfRuns}) in an idle window...`);
        const collection = await runTrackedCollection([
          'collect',
          '--config=lighthouserc.json',
          `--url=${url}`,
          '--numberOfRuns=1',
          ...(acceptedRuns > 0 ? ['--additive'] : []),
        ]);

        if (collection.competingWorkDetected) {
          removeFilesAddedSince(outputBefore);
          console.warn(`Discarded ${url} run ${runNumber}: competing test/build work started during collection.`);
          continue;
        }
        if (collection.status !== 0) {
          return collection.status;
        }

        accepted = true;
        acceptedRuns += 1;
      }
    }
  }

  const assertionStatus = runLhciSync(['assert', '--config=lighthouserc.json']);
  if (assertionStatus !== 0) {
    return assertionStatus;
  }
  return runLhciSync(['upload', '--config=lighthouserc.json']);
}

let status;
if (process.env.CI) {
  status = runLhciSync(['autorun', '--config=lighthouserc.json']);
} else {
  status = await runResourceAwareLocalCollection();
}

process.exit(status);
