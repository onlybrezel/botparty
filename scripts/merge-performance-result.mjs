import { readFile, writeFile } from 'node:fs/promises';

const [profilePath, loadPath, metricsPath, outputPath, loadExitCode, phase, startedAt, finishedAt, imageId, preGatePath, postGatePath] = process.argv.slice(2);
if (!imageId) throw new Error('Missing merge-performance-result arguments.');

async function json(path) {
  return JSON.parse(await readFile(path, 'utf8'));
}

const profile = await json(profilePath);
const load = await json(loadPath);
const metrics = await json(metricsPath);
const preGate = await json(preGatePath);
const postGate = await json(postGatePath);
const apiLifecycle = metrics.lifecycle.filter(({ service }) => service === 'api');
const cgroups = Object.values(metrics.apiCgroups);
const result = {
  schemaVersion: 1,
  phase,
  startedAt,
  finishedAt,
  apiImageId: imageId,
  profile,
  load,
  resources: {
    hostLoadAverage: metrics.hostLoadAverage,
    ...metrics.services,
    apiMemoryPeakBytes: Math.max(0, ...cgroups.map(({ memoryPeakBytes }) => memoryPeakBytes)),
    apiCpuThrottling: {
      periods: cgroups.reduce((sum, value) => sum + (value.cpuThrottlingDelta.periods ?? 0), 0),
      throttledPeriods: cgroups.reduce((sum, value) => sum + (value.cpuThrottlingDelta.throttledPeriods ?? 0), 0),
      throttledUsec: cgroups.reduce((sum, value) => sum + (value.cpuThrottlingDelta.throttledUsec ?? 0), 0),
    },
  },
  runtime: metrics.apiRuntimeMetrics,
  stability: {
    loadExitCode: Number(loadExitCode),
    apiRestarts: apiLifecycle.reduce((sum, value) => sum + value.restartCount, 0),
    apiOomKilled: apiLifecycle.some((value) => value.oomKilled),
    apiInstances: apiLifecycle,
  },
  measurementQuality: {
    accepted: preGate.accepted && postGate.accepted,
    sharedHost: true,
    contentionContext: {
      preActiveForeignPerformanceContainers: preGate.foreignPerformanceContainers,
      postActiveForeignPerformanceContainers: postGate.foreignPerformanceContainers,
      preHostIdlePercent: preGate.hostIdlePercent,
      postHostIdlePercent: postGate.hostIdlePercent,
      preLoadAverageOneMinute: preGate.loadAverageOneMinute,
      postLoadAverageOneMinute: postGate.loadAverageOneMinute,
    },
    preGate,
    postGate,
    remainingHostActivity: 'The objective host-idle/load gate permits bounded unrelated background activity.',
  },
  measurementNotes: [
    'Docker CPU percent is aggregated across API replicas; 100% corresponds to one fully used logical CPU.',
    'cgroup memory.peak includes API startup, warmup, and measured load after the collector starts.',
    'Prometheus runtime metrics are scraped directly from every API replica during the run.',
    'The load generator and database are isolated containers and are not included in API memory figures.',
  ],
};
await writeFile(outputPath, `${JSON.stringify(result, null, 2)}\n`);
