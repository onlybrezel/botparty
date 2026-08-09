import { execFile } from 'node:child_process';
import { access, writeFile } from 'node:fs/promises';
import { promisify } from 'node:util';
import os from 'node:os';

const execFileAsync = promisify(execFile);
const [project, outputPath, stopPath] = process.argv.slice(2);
if (!project || !outputPath || !stopPath) {
  throw new Error('Usage: performance-metrics-collector.mjs PROJECT OUTPUT STOP_FILE');
}

const intervalMs = Number(process.env.PERFORMANCE_SAMPLE_INTERVAL_MS ?? 1_000);
const samples = [];
const cgroupByContainer = new Map();
const prometheusByContainer = new Map();

async function run(command, args, options = {}) {
  try {
    const result = await execFileAsync(command, args, {
      encoding: 'utf8',
      maxBuffer: 16 * 1024 * 1024,
      ...options,
    });
    return result.stdout.trim();
  } catch {
    return '';
  }
}

async function stopped() {
  try {
    await access(stopPath);
    return true;
  } catch {
    return false;
  }
}

function parsePercent(value) {
  const number = Number.parseFloat(value.replace('%', ''));
  return Number.isFinite(number) ? number : null;
}

function parseBytes(value) {
  const match = /^([\d.]+)\s*([KMGT]?i?B)$/.exec(value.trim());
  if (!match) return null;
  const amount = Number(match[1]);
  const units = { B: 1, kB: 1e3, KB: 1e3, KiB: 1024, MB: 1e6, MiB: 1024 ** 2, GB: 1e9, GiB: 1024 ** 3, TB: 1e12, TiB: 1024 ** 4 };
  const multiplier = units[match[2]];
  return multiplier ? Math.round(amount * multiplier) : null;
}

function parseKeyValues(raw) {
  return Object.fromEntries(
    raw
      .split('\n')
      .map((line) => line.trim().split(/\s+/, 2))
      .filter((entry) => entry.length === 2)
      .map(([key, value]) => [key, Number(value)]),
  );
}

function parsePrometheus(raw) {
  const metrics = {};
  for (const line of raw.split('\n')) {
    if (!line || line.startsWith('#')) continue;
    const match = /^([^\s{]+)(?:\{[^}]*\})?\s+([-+\d.eE]+)$/.exec(line);
    if (match) metrics[match[1]] = Number(match[2]);
  }
  return metrics;
}

async function containerIds(all = false) {
  const args = [
    'ps',
    ...(all ? ['-a'] : []),
    '--filter',
    `label=com.docker.compose.project=${project}`,
    '--format',
    '{{.ID}}',
  ];
  const raw = await run('docker', args);
  return raw ? raw.split('\n').filter(Boolean) : [];
}

async function inspectContainers(ids) {
  if (ids.length === 0) return [];
  const raw = await run('docker', ['inspect', ...ids]);
  try {
    return JSON.parse(raw);
  } catch {
    return [];
  }
}

async function sample() {
  const ids = await containerIds();
  if (ids.length === 0) return;
  const inspected = await inspectContainers(ids);
  const metadata = new Map();
  for (const item of inspected) {
    const value = {
      name: item.Name.replace(/^\//, ''),
      service: item.Config.Labels['com.docker.compose.service'] ?? 'unknown',
    };
    metadata.set(item.Id, value);
    metadata.set(item.Id.slice(0, 12), value);
  }
  const rawStats = await run('docker', [
    'stats',
    '--no-stream',
    '--format',
    '{{json .}}',
    ...ids,
  ]);
  const containers = rawStats
    .split('\n')
    .filter(Boolean)
    .flatMap((line) => {
      try {
        const value = JSON.parse(line);
        const id = ids.find((candidate) => candidate.startsWith(value.ID)) ?? value.ID;
        const info = metadata.get(id) ?? { name: value.Name, service: 'unknown' };
        const [memoryUsage, memoryLimit] = value.MemUsage.split('/').map(parseBytes);
        return [{
          id,
          ...info,
          cpuPercent: parsePercent(value.CPUPerc),
          memoryPercent: parsePercent(value.MemPerc),
          memoryUsageBytes: memoryUsage,
          memoryLimitBytes: memoryLimit,
        }];
      } catch {
        return [];
      }
    });
  samples.push({ at: new Date().toISOString(), hostLoadAverage: os.loadavg(), containers });

  await Promise.all(containers.filter(({ service }) => service === 'api').map(async (container) => {
    const [cpuRaw, memoryPeakRaw, memoryEventsRaw, metricsRaw] = await Promise.all([
      run('docker', ['exec', container.id, 'cat', '/sys/fs/cgroup/cpu.stat']),
      run('docker', ['exec', container.id, 'cat', '/sys/fs/cgroup/memory.peak']),
      run('docker', ['exec', container.id, 'cat', '/sys/fs/cgroup/memory.events']),
      run('docker', [
        'exec',
        container.id,
        'wget',
        '-qO-',
        'http://127.0.0.1:4000/api/v1/health/metrics',
      ]),
    ]);
    if (cpuRaw) {
      const entries = cgroupByContainer.get(container.name) ?? [];
      entries.push({
        at: new Date().toISOString(),
        cpu: parseKeyValues(cpuRaw),
        memoryPeakBytes: Number(memoryPeakRaw),
        memoryEvents: parseKeyValues(memoryEventsRaw),
      });
      cgroupByContainer.set(container.name, entries);
    }
    if (metricsRaw) {
      const entries = prometheusByContainer.get(container.name) ?? [];
      entries.push({ at: new Date().toISOString(), values: parsePrometheus(metricsRaw) });
      prometheusByContainer.set(container.name, entries);
    }
  }));
}

function summarizeService(service) {
  const values = samples.map(({ containers }) => containers.filter((item) => item.service === service));
  const cpu = values.map((items) => items.reduce((sum, item) => sum + (item.cpuPercent ?? 0), 0));
  const memory = values.map((items) => items.reduce((sum, item) => sum + (item.memoryUsageBytes ?? 0), 0));
  const memoryPercent = values.map((items) => items.reduce((sum, item) => sum + (item.memoryPercent ?? 0), 0));
  const average = (numbers) => numbers.length ? numbers.reduce((sum, value) => sum + value, 0) / numbers.length : null;
  return {
    replicasObserved: Math.max(0, ...values.map((items) => items.length)),
    averageCpuPercent: average(cpu),
    peakCpuPercent: cpu.length ? Math.max(...cpu) : null,
    averageMemoryBytes: average(memory),
    peakMemoryBytes: memory.length ? Math.max(...memory) : null,
    peakAggregateMemoryPercent: memoryPercent.length ? Math.max(...memoryPercent) : null,
  };
}

function delta(first, last, key) {
  const before = first?.[key];
  const after = last?.[key];
  return Number.isFinite(before) && Number.isFinite(after) ? after - before : null;
}

const metricNames = [
  'botparty_api_process_resident_memory_bytes',
  'botparty_api_nodejs_heap_size_total_bytes',
  'botparty_api_nodejs_heap_size_used_bytes',
  'botparty_api_nodejs_external_memory_bytes',
  'botparty_api_nodejs_eventloop_lag_p50_seconds',
  'botparty_api_nodejs_eventloop_lag_p90_seconds',
  'botparty_api_nodejs_eventloop_lag_p99_seconds',
  'botparty_api_nodejs_eventloop_lag_max_seconds',
];

while (!(await stopped())) {
  await sample();
  await new Promise((resolve) => setTimeout(resolve, intervalMs));
}
await sample();

const finalIds = await containerIds(true);
const finalInspect = await inspectContainers(finalIds);
const services = new Set(samples.flatMap(({ containers }) => containers.map(({ service }) => service)));
const cgroups = Object.fromEntries(
  [...cgroupByContainer.entries()].map(([container, entries]) => {
    const first = entries[0];
    const last = entries.at(-1);
    return [container, {
      sampleCount: entries.length,
      memoryPeakBytes: Math.max(...entries.map((entry) => entry.memoryPeakBytes).filter(Number.isFinite)),
      cpuThrottlingDelta: {
        periods: delta(first?.cpu, last?.cpu, 'nr_periods'),
        throttledPeriods: delta(first?.cpu, last?.cpu, 'nr_throttled'),
        throttledUsec: delta(first?.cpu, last?.cpu, 'throttled_usec'),
      },
      memoryEventsDelta: Object.fromEntries(
        ['low', 'high', 'max', 'oom', 'oom_kill'].map((key) => [
          key,
          delta(first?.memoryEvents, last?.memoryEvents, key),
        ]),
      ),
    }];
  }),
);
const runtimeMetrics = Object.fromEntries(
  [...prometheusByContainer.entries()].map(([container, entries]) => {
    const first = entries[0]?.values;
    const last = entries.at(-1)?.values;
    const peaks = Object.fromEntries(metricNames.map((name) => [
      name,
      Math.max(...entries.map((entry) => entry.values[name]).filter(Number.isFinite)),
    ]));
    return [container, {
      sampleCount: entries.length,
      peaks,
      cpuUserSecondsDelta: delta(first, last, 'botparty_api_process_cpu_user_seconds_total'),
      cpuSystemSecondsDelta: delta(first, last, 'botparty_api_process_cpu_system_seconds_total'),
      gcDurationSecondsDelta: delta(first, last, 'botparty_api_nodejs_gc_duration_seconds_sum'),
      gcCyclesDelta: delta(first, last, 'botparty_api_nodejs_gc_duration_seconds_count'),
    }];
  }),
);
const lifecycle = finalInspect.map((item) => ({
  name: item.Name.replace(/^\//, ''),
  service: item.Config.Labels['com.docker.compose.service'] ?? 'unknown',
  status: item.State.Status,
  exitCode: item.State.ExitCode,
  restartCount: item.RestartCount,
  oomKilled: item.State.OOMKilled,
}));

await writeFile(outputPath, `${JSON.stringify({
  sampleIntervalMs: intervalMs,
  sampleCount: samples.length,
  hostLoadAverage: {
    averageOneMinute: samples.reduce((sum, entry) => sum + entry.hostLoadAverage[0], 0) / samples.length,
    peakOneMinute: Math.max(...samples.map((entry) => entry.hostLoadAverage[0])),
  },
  services: Object.fromEntries([...services].map((service) => [service, summarizeService(service)])),
  apiCgroups: cgroups,
  apiRuntimeMetrics: runtimeMetrics,
  lifecycle,
}, null, 2)}\n`);
