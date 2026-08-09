import { readFile } from 'node:fs/promises';
import { performance } from 'node:perf_hooks';
import { assertPerformanceTargetAllowed } from './performance-target.mjs';

const baseUrl = new URL(process.env.PERFORMANCE_BASE_URL ?? 'http://127.0.0.1:8080');
const scenario = process.env.PERFORMANCE_SCENARIO ?? 'public-read';
const durationSeconds = Number(process.env.PERFORMANCE_DURATION_SECONDS ?? 30);
const concurrency = Number(process.env.PERFORMANCE_CONCURRENCY ?? 20);
const timeoutMs = Number(process.env.PERFORMANCE_TIMEOUT_MS ?? 5_000);
const maxRequests = Number(process.env.PERFORMANCE_MAX_REQUESTS ?? 1_000_000);
const clientOffset = Number(process.env.PERFORMANCE_CLIENT_OFFSET ?? 0);
const maxSuccessfulP95Ms = process.env.PERFORMANCE_MAX_SUCCESSFUL_P95_MS
  ? Number(process.env.PERFORMANCE_MAX_SUCCESSFUL_P95_MS)
  : null;
const maxErrorRate = process.env.PERFORMANCE_MAX_ERROR_RATE
  ? Number(process.env.PERFORMANCE_MAX_ERROR_RATE)
  : null;
const minSuccessfulRequestsPerSecond = process.env.PERFORMANCE_MIN_SUCCESS_RPS
  ? Number(process.env.PERFORMANCE_MIN_SUCCESS_RPS)
  : null;
const allowedScenarios = new Set([
  'stats',
  'public-read',
  'mixed',
  'write',
  'login',
  'file',
  'websocket',
]);

if (!allowedScenarios.has(scenario)) throw new Error(`Unknown scenario ${scenario}.`);
if (!Number.isInteger(durationSeconds) || durationSeconds < 1 || durationSeconds > 3_600) {
  throw new Error('PERFORMANCE_DURATION_SECONDS must be an integer from 1 to 3600.');
}
if (!Number.isInteger(concurrency) || concurrency < 1 || concurrency > 1_000) {
  throw new Error('PERFORMANCE_CONCURRENCY must be an integer from 1 to 1000.');
}
if (!Number.isInteger(timeoutMs) || timeoutMs < 100 || timeoutMs > 60_000) {
  throw new Error('PERFORMANCE_TIMEOUT_MS must be an integer from 100 to 60000.');
}
if (!Number.isInteger(maxRequests) || maxRequests < 1 || maxRequests > 5_000_000) {
  throw new Error('PERFORMANCE_MAX_REQUESTS must be an integer from 1 to 5000000.');
}
if (!Number.isInteger(clientOffset) || clientOffset < 0 || clientOffset > 1_000_000) {
  throw new Error('PERFORMANCE_CLIENT_OFFSET must be an integer from 0 to 1000000.');
}
for (const [name, value] of [
  ['PERFORMANCE_MAX_SUCCESSFUL_P95_MS', maxSuccessfulP95Ms],
  ['PERFORMANCE_MAX_ERROR_RATE', maxErrorRate],
  ['PERFORMANCE_MIN_SUCCESS_RPS', minSuccessfulRequestsPerSecond],
]) {
  if (value !== null && (!Number.isFinite(value) || value < 0)) {
    throw new Error(`${name} must be a non-negative number.`);
  }
}
assertPerformanceTargetAllowed(baseUrl, process.env.PERFORMANCE_ALLOW_DOCKER === 'true');

const samples = [];
const successfulSamples = [];
const overloadSamples = [];
const byOperation = new Map();
const operationStatuses = new Map();
const statuses = new Map();
const instances = new Map();
const errors = new Map();
const errorExamples = new Map();
let bytes = 0;
let issued = 0;
let authToken = '';
let primaryRobotId = '';
let uploadDataUrl = '';

function clientIp(workerId) {
  const value = (workerId + clientOffset) % 65_000;
  return `198.18.${Math.floor(value / 250)}.${(value % 250) + 1}`;
}

function percentile(values, quantile) {
  if (values.length === 0) return null;
  const ordered = [...values].sort((left, right) => left - right);
  return Number(
    ordered[Math.min(ordered.length - 1, Math.ceil(ordered.length * quantile) - 1)].toFixed(2),
  );
}

function record(operation, startedAt, status, responseBytes, instanceId, errorCode) {
  const latency = performance.now() - startedAt;
  samples.push(latency);
  if (status >= 200 && status < 400) successfulSamples.push(latency);
  if (status === 429 || status === 503) overloadSamples.push(latency);
  if (!byOperation.has(operation)) byOperation.set(operation, []);
  byOperation.get(operation).push(latency);
  if (!operationStatuses.has(operation)) operationStatuses.set(operation, new Map());
  const statusesForOperation = operationStatuses.get(operation);
  statusesForOperation.set(status, (statusesForOperation.get(status) ?? 0) + 1);
  bytes += responseBytes;
  if (status) statuses.set(status, (statuses.get(status) ?? 0) + 1);
  if (instanceId) instances.set(instanceId, (instances.get(instanceId) ?? 0) + 1);
  if (errorCode) errors.set(errorCode, (errors.get(errorCode) ?? 0) + 1);
}

async function request(operation, path, workerId, options = {}) {
  const startedAt = performance.now();
  try {
    const headers = {
      accept: 'application/json',
      'x-forwarded-for': clientIp(workerId),
      ...options.headers,
    };
    const response = await fetch(new URL(path, baseUrl), {
      ...options,
      headers,
      signal: AbortSignal.timeout(timeoutMs),
    });
    const body = new Uint8Array(await response.arrayBuffer());
    record(
      operation,
      startedAt,
      response.status,
      body.byteLength,
      response.headers.get('x-instance-id'),
      null,
    );
    if (response.status >= 400) {
      const key = `${operation}:${response.status}`;
      if (!errorExamples.has(key)) {
        errorExamples.set(key, new TextDecoder().decode(body).slice(0, 500));
      }
    }
    return { response, body };
  } catch (error) {
    const cause =
      error instanceof Error && error.cause && typeof error.cause === 'object' ? error.cause : null;
    const code =
      cause && 'code' in cause
        ? String(cause.code)
        : error instanceof Error
          ? error.name
          : 'unknown';
    record(operation, startedAt, 0, 0, null, code);
    return null;
  }
}

async function login(workerId = 0, requireSuccess = true) {
  const csrf = await request('login-csrf', '/api/v1/auth/csrf', workerId);
  if (!csrf || csrf.response.status !== 200) {
    if (requireSuccess) throw new Error('Could not obtain CSRF token.');
    return '';
  }
  const csrfBody = JSON.parse(new TextDecoder().decode(csrf.body));
  const cookie = csrf.response.headers.get('set-cookie')?.split(';', 1)[0];
  const result = await request('login', '/api/v1/auth/login', workerId, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      origin: process.env.PERFORMANCE_ORIGIN ?? baseUrl.origin,
      cookie: cookie ?? '',
      'x-csrf-token': csrfBody.csrfToken,
    },
    body: JSON.stringify({
      email: process.env.PERFORMANCE_EMAIL ?? 'admin@botparty.test',
      password: process.env.PERFORMANCE_PASSWORD ?? 'E2eAdminPassword!2026',
    }),
  });
  if (!result || result.response.status !== 200) {
    if (requireSuccess) throw new Error('Performance login failed.');
    return '';
  }
  return JSON.parse(new TextDecoder().decode(result.body)).accessToken;
}

async function prepare() {
  if (['mixed', 'write', 'file'].includes(scenario)) authToken = await login(0);
  if (['file', 'websocket'].includes(scenario)) {
    const robot = await request('fixture-robot', '/api/v1/robots/perf-primary', 0);
    if (!robot || robot.response.status !== 200)
      throw new Error('Performance robot is unavailable.');
    primaryRobotId = JSON.parse(new TextDecoder().decode(robot.body)).id;
  }
  if (scenario === 'file') {
    const file = await readFile(process.env.PERFORMANCE_UPLOAD_FILE ?? '/fixtures/upload.jpg');
    uploadDataUrl = `data:image/jpeg;base64,${file.toString('base64')}`;
  }
  samples.length = 0;
  successfulSamples.length = 0;
  overloadSamples.length = 0;
  byOperation.clear();
  operationStatuses.clear();
  statuses.clear();
  instances.clear();
  errors.clear();
  errorExamples.clear();
  bytes = 0;
  issued = 0;
}

const authHeaders = () => ({ authorization: `Bearer ${authToken}` });
const mixedOperations = [
  ['robots-popular', '/api/v1/robots?limit=24&sort=sessions'],
  ['robots-new', '/api/v1/robots?limit=24&sort=new'],
  ['robots-search', '/api/v1/robots?limit=24&q=Performance'],
  ['robots-featured', '/api/v1/robots/featured'],
  ['robots-overview', '/api/v1/robots/overview'],
  ['stats', '/api/v1/health/stats'],
];

async function execute(workerId, sequence) {
  if (scenario === 'stats') return request('stats', '/api/v1/health/stats', workerId);
  if (scenario === 'public-read') {
    const [operation, path] = mixedOperations[sequence % mixedOperations.length];
    return request(operation, path, workerId);
  }
  if (scenario === 'login') return login(workerId, false);
  if (scenario === 'write') {
    return request('profile-update', '/api/v1/users/me', workerId, {
      method: 'PATCH',
      headers: { ...authHeaders(), 'content-type': 'application/json' },
      body: JSON.stringify({ displayName: `Performance Admin ${sequence % 10}` }),
    });
  }
  if (scenario === 'file') {
    if (sequence % 5 === 0) {
      return request('thumbnail-upload', `/api/v1/robots/${primaryRobotId}/thumbnail`, workerId, {
        method: 'POST',
        headers: { ...authHeaders(), 'content-type': 'application/json' },
        body: JSON.stringify({ dataUrl: uploadDataUrl }),
      });
    }
    return request(
      'thumbnail-download',
      `/api/v1/robots/${primaryRobotId}/thumbnail-image`,
      workerId,
      {
        headers: authHeaders(),
      },
    );
  }
  if (scenario === 'mixed') {
    const slot = sequence % 100;
    if (slot < 55) {
      const [operation, path] = mixedOperations[sequence % mixedOperations.length];
      return request(operation, path, workerId);
    }
    if (slot < 70)
      return request('user-me', '/api/v1/users/me', workerId, { headers: authHeaders() });
    if (slot < 82)
      return request('notifications', '/api/v1/notifications?limit=25', workerId, {
        headers: authHeaders(),
      });
    if (slot < 90)
      return request('wallet', '/api/v1/wallet/me', workerId, { headers: authHeaders() });
    if (slot < 95) {
      return request('profile-update', '/api/v1/users/me', workerId, {
        method: 'PATCH',
        headers: { ...authHeaders(), 'content-type': 'application/json' },
        body: JSON.stringify({ displayName: `Performance Admin ${sequence % 10}` }),
      });
    }
    return request('analytics-event', '/api/v1/analytics/events', workerId, {
      method: 'POST',
      headers: { ...authHeaders(), 'content-type': 'application/json' },
      body: JSON.stringify({ event: 'DISCOVERY_ROBOT_VIEW', robotId: primaryRobotId || undefined }),
    });
  }
}

async function websocketWorker(workerId, stopAt) {
  while (performance.now() < stopAt && issued < maxRequests) {
    issued += 1;
    const startedAt = performance.now();
    await new Promise((resolve) => {
      const socket = new WebSocket(new URL('/ws', baseUrl).href.replace(/^http/, 'ws'));
      let settled = false;
      const finish = (status, errorCode = null) => {
        if (settled) return;
        settled = true;
        clearTimeout(timeout);
        record('websocket-connect', startedAt, status, 0, null, errorCode);
        resolve();
      };
      const timeout = setTimeout(() => {
        socket.close();
        finish(0, 'timeout');
      }, timeoutMs);
      socket.addEventListener(
        'open',
        () => {
          socket.send(
            JSON.stringify({
              event: 'room:join',
              data: { robotId: primaryRobotId, protocolVersion: 1 },
            }),
          );
          setTimeout(() => socket.close(1000), 250);
        },
        { once: true },
      );
      socket.addEventListener(
        'close',
        () => {
          finish(200);
        },
        { once: true },
      );
      socket.addEventListener(
        'error',
        () => {
          finish(0, 'websocket-error');
        },
        { once: true },
      );
    });
  }
}

await prepare();
const startedAt = performance.now();
const stopAt = startedAt + durationSeconds * 1_000;
if (scenario === 'websocket') {
  await Promise.all(
    Array.from({ length: concurrency }, (_, workerId) => websocketWorker(workerId, stopAt)),
  );
} else {
  await Promise.all(
    Array.from({ length: concurrency }, async (_, workerId) => {
      let sequence = workerId;
      const requestsPerClient = scenario === 'file' ? 5 : 50;
      while (performance.now() < stopAt && issued < maxRequests) {
        issued += 1;
        const clientSequence = Math.floor(sequence / (concurrency * requestsPerClient));
        const simulatedClientId = clientSequence * concurrency + workerId;
        await execute(simulatedClientId, sequence);
        sequence += concurrency;
      }
    }),
  );
}

const elapsedSeconds = (performance.now() - startedAt) / 1_000;
const successful = [...statuses.entries()]
  .filter(([status]) => status >= 200 && status < 400)
  .reduce((sum, [, count]) => sum + count, 0);
const rateLimited = statuses.get(429) ?? 0;
const unavailable = statuses.get(503) ?? 0;
const serverErrors = [...statuses.entries()]
  .filter(([status]) => status >= 500 && status !== 503)
  .reduce((sum, [, count]) => sum + count, 0);
const successfulRequestsPerSecond = Number((successful / elapsedSeconds).toFixed(2));
const successfulP95Ms = percentile(successfulSamples, 0.95);
const errorRate = samples.length
  ? Number(((samples.length - successful) / samples.length).toFixed(6))
  : 1;
const thresholdViolations = [];
if (
  maxSuccessfulP95Ms !== null &&
  (successfulP95Ms === null || successfulP95Ms > maxSuccessfulP95Ms)
) {
  thresholdViolations.push(
    `successful p95 ${successfulP95Ms ?? 'unavailable'} ms exceeds ${maxSuccessfulP95Ms} ms`,
  );
}
if (maxErrorRate !== null && errorRate > maxErrorRate) {
  thresholdViolations.push(`error rate ${errorRate} exceeds ${maxErrorRate}`);
}
if (
  minSuccessfulRequestsPerSecond !== null &&
  successfulRequestsPerSecond < minSuccessfulRequestsPerSecond
) {
  thresholdViolations.push(
    `successful rate ${successfulRequestsPerSecond} req/s is below ${minSuccessfulRequestsPerSecond} req/s`,
  );
}

const report = {
  scenario,
  target: baseUrl.href,
  durationSeconds: Number(elapsedSeconds.toFixed(2)),
  concurrency,
  clientOffset,
  totalRequests: samples.length,
  successfulRequests: successful,
  requestsPerSecond: Number((samples.length / elapsedSeconds).toFixed(2)),
  successfulRequestsPerSecond,
  latencyMs: {
    p50: percentile(samples, 0.5),
    p90: percentile(samples, 0.9),
    p95: percentile(samples, 0.95),
    p99: percentile(samples, 0.99),
    max: samples.length
      ? Number(samples.reduce((maximum, value) => Math.max(maximum, value), 0).toFixed(2))
      : null,
  },
  successfulLatencyMs: {
    p50: percentile(successfulSamples, 0.5),
    p95: successfulP95Ms,
    p99: percentile(successfulSamples, 0.99),
  },
  overloadLatencyMs: {
    p50: percentile(overloadSamples, 0.5),
    p95: percentile(overloadSamples, 0.95),
  },
  operations: Object.fromEntries(
    [...byOperation.entries()].map(([operation, values]) => [
      operation,
      {
        count: values.length,
        statuses: Object.fromEntries(operationStatuses.get(operation) ?? []),
        p50: percentile(values, 0.5),
        p95: percentile(values, 0.95),
        p99: percentile(values, 0.99),
      },
    ]),
  ),
  statusCounts: Object.fromEntries([...statuses.entries()].sort(([left], [right]) => left - right)),
  errorCounts: Object.fromEntries(errors),
  errorExamples: Object.fromEntries(errorExamples),
  instanceCounts: Object.fromEntries(instances),
  bytes,
  errorRate,
  overloadResponses: { rateLimited, unavailable, serverErrors },
  thresholds: {
    maxSuccessfulP95Ms,
    maxErrorRate,
    minSuccessfulRequestsPerSecond,
    violations: thresholdViolations,
  },
};
console.log(JSON.stringify(report, null, 2));
if (samples.length === 0 || serverErrors > 0 || errors.size > 0 || thresholdViolations.length > 0) {
  process.exitCode = 1;
}
