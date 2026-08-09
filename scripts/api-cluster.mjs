import cluster from 'node:cluster';
import { availableParallelism } from 'node:os';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const MAX_WORKERS = 64;

function readCpuQuota() {
  try {
    const [quota, period] = readFileSync('/sys/fs/cgroup/cpu.max', 'utf8').trim().split(/\s+/);
    if (quota === 'max') return null;
    const quotaValue = Number(quota);
    const periodValue = Number(period);
    if (quotaValue > 0 && periodValue > 0) return quotaValue / periodValue;
  } catch {}
  return null;
}

function readMemoryLimitMb() {
  try {
    const raw = readFileSync('/sys/fs/cgroup/memory.max', 'utf8').trim();
    if (raw === 'max') return null;
    const bytes = Number(raw);
    return Number.isSafeInteger(bytes) && bytes > 0 ? Math.floor(bytes / 1024 / 1024) : null;
  } catch {}
  return null;
}

export function workerCount(raw = process.env.API_WORKERS) {
  if (raw && raw !== 'auto') {
    const configured = Number(raw);
    if (!Number.isInteger(configured) || configured < 1 || configured > MAX_WORKERS) {
      throw new Error(`API_WORKERS must be auto or an integer from 1 to ${MAX_WORKERS}`);
    }
    return configured;
  }

  const quota = readCpuQuota();
  const detected = quota === null ? availableParallelism() : Math.ceil(quota);
  return Math.max(1, Math.min(MAX_WORKERS, detected));
}

export function workerHeapMb(memoryLimitMb, workers) {
  if (memoryLimitMb === null) return null;
  return Math.max(128, Math.min(2_048, Math.floor((memoryLimitMb * 0.65) / workers)));
}

if (cluster.isPrimary && process.argv[1] === fileURLToPath(import.meta.url)) {
  const desiredWorkers = workerCount();
  if (!process.env.NODE_OPTIONS?.includes('--max-old-space-size')) {
    const heapMb = workerHeapMb(readMemoryLimitMb(), desiredWorkers);
    if (heapMb !== null) {
      process.env.NODE_OPTIONS =
        `${process.env.NODE_OPTIONS ?? ''} --max-old-space-size=${heapMb}`.trim();
    }
  }
  let stopping = false;
  cluster.setupPrimary({
    exec: fileURLToPath(new URL('../apps/api/dist/main.js', import.meta.url)),
  });
  for (let index = 0; index < desiredWorkers; index += 1) cluster.fork();

  const stop = (signal) => {
    if (stopping) return;
    stopping = true;
    for (const worker of Object.values(cluster.workers)) worker?.process.kill(signal);
    const deadline = setTimeout(() => process.exit(1), 15_000);
    deadline.unref();
  };
  process.on('SIGINT', () => stop('SIGINT'));
  process.on('SIGTERM', () => stop('SIGTERM'));
  cluster.on('exit', () => {
    if (!stopping) cluster.fork();
    else if (Object.keys(cluster.workers).length === 0) process.exit(0);
  });
}
