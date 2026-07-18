import { performance } from 'node:perf_hooks';

const target = new URL(process.env.LOAD_TEST_URL ?? process.argv[2] ?? 'http://127.0.0.1:8080/api/v1/health/stats');
const durationSeconds = Number(process.env.LOAD_TEST_DURATION_SECONDS ?? process.argv[3] ?? 15);
const concurrency = Number(process.env.LOAD_TEST_CONCURRENCY ?? process.argv[4] ?? 20);
const timeoutMs = Number(process.env.LOAD_TEST_TIMEOUT_MS ?? 5_000);
const minimumInstances = Number(process.env.LOAD_TEST_MIN_INSTANCES ?? 1);
const maximumRequests = Number(process.env.LOAD_TEST_MAX_REQUESTS ?? 0);

const localHosts = new Set(['127.0.0.1', 'localhost', '::1']);
if (!localHosts.has(target.hostname) && process.env.LOAD_TEST_ALLOW_REMOTE !== 'true') {
  throw new Error('Remote load tests require LOAD_TEST_ALLOW_REMOTE=true.');
}
if (!Number.isInteger(durationSeconds) || durationSeconds < 1 || durationSeconds > 300) {
  throw new Error('LOAD_TEST_DURATION_SECONDS must be an integer from 1 to 300.');
}
if (!Number.isInteger(concurrency) || concurrency < 1 || concurrency > 200) {
  throw new Error('LOAD_TEST_CONCURRENCY must be an integer from 1 to 200.');
}
if (!Number.isInteger(minimumInstances) || minimumInstances < 1 || minimumInstances > 20) {
  throw new Error('LOAD_TEST_MIN_INSTANCES must be an integer from 1 to 20.');
}
if (!Number.isInteger(maximumRequests) || maximumRequests < 0 || maximumRequests > 1_000_000) {
  throw new Error('LOAD_TEST_MAX_REQUESTS must be an integer from 0 to 1000000.');
}

const latencies = [];
const statusCounts = new Map();
const instanceCounts = new Map();
const transportErrorCounts = new Map();
const transportErrorSamples = [];
let transportErrors = 0;
let issuedRequests = 0;
const startedAt = performance.now();
const stopAt = startedAt + durationSeconds * 1_000;

async function worker() {
  while (performance.now() < stopAt) {
    if (maximumRequests > 0 && issuedRequests >= maximumRequests) break;
    issuedRequests += 1;

    const requestStartedAt = performance.now();
    try {
      const response = await fetch(target, {
        headers: { accept: 'application/json' },
        signal: AbortSignal.timeout(timeoutMs),
      });
      await response.arrayBuffer();
      latencies.push(performance.now() - requestStartedAt);
      statusCounts.set(response.status, (statusCounts.get(response.status) ?? 0) + 1);
      const instanceId = response.headers.get('x-instance-id') ?? 'missing';
      instanceCounts.set(instanceId, (instanceCounts.get(instanceId) ?? 0) + 1);
    } catch (error) {
      transportErrors += 1;
      const cause = error instanceof Error && error.cause && typeof error.cause === 'object'
        ? error.cause
        : null;
      const code = cause && 'code' in cause && typeof cause.code === 'string'
        ? cause.code
        : error instanceof Error
          ? error.name
          : 'unknown';
      transportErrorCounts.set(code, (transportErrorCounts.get(code) ?? 0) + 1);
      if (transportErrorSamples.length < 10) {
        transportErrorSamples.push({
          atMs: Number((performance.now() - startedAt).toFixed(2)),
          code,
          message: error instanceof Error ? error.message.slice(0, 160) : 'Unknown transport error',
        });
      }
      latencies.push(performance.now() - requestStartedAt);
    }
  }
}

await Promise.all(Array.from({ length: concurrency }, () => worker()));

latencies.sort((a, b) => a - b);
const elapsedSeconds = (performance.now() - startedAt) / 1_000;
const percentile = (value) => {
  if (latencies.length === 0) return null;
  return Number(latencies[Math.min(latencies.length - 1, Math.ceil(latencies.length * value) - 1)].toFixed(2));
};
const totalRequests = latencies.length;
const unsuccessfulResponses = [...statusCounts.entries()]
  .filter(([status]) => status < 200 || status >= 400)
  .reduce((total, [, count]) => total + count, 0);
const failedRequests = unsuccessfulResponses + transportErrors;
const respondingInstances = [...instanceCounts.keys()].filter((instanceId) => instanceId !== 'missing');

const report = {
  target: target.toString(),
  durationSeconds: Number(elapsedSeconds.toFixed(2)),
  concurrency,
  totalRequests,
  requestsPerSecond: Number((totalRequests / elapsedSeconds).toFixed(2)),
  latencyMs: {
    p50: percentile(0.5),
    p95: percentile(0.95),
    p99: percentile(0.99),
    max: latencies.length > 0 ? Number(latencies.at(-1).toFixed(2)) : null,
  },
  statusCounts: Object.fromEntries([...statusCounts.entries()].sort(([a], [b]) => a - b)),
  transportErrors,
  transportErrorCounts: Object.fromEntries(transportErrorCounts),
  transportErrorSamples,
  errorRate: totalRequests > 0 ? Number((failedRequests / totalRequests).toFixed(6)) : 1,
  instanceCounts: Object.fromEntries(instanceCounts),
  respondingInstances: respondingInstances.length,
  minimumInstances,
  maximumRequests: maximumRequests || null,
};

console.log(JSON.stringify(report, null, 2));

if (
  totalRequests === 0
  || report.errorRate > 0.01
  || respondingInstances.length < minimumInstances
) {
  process.exitCode = 1;
}
