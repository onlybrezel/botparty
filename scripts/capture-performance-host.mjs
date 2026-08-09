import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import os from 'node:os';

function command(executable, args) {
  try {
    return execFileSync(executable, args, { encoding: 'utf8' }).trim();
  } catch {
    return null;
  }
}

function lscpuField(name) {
  const output = command('lscpu', ['-J']);
  if (!output) return null;
  const fields = JSON.parse(output).lscpu;
  return fields.find((entry) => entry.field.replace(/:$/, '') === name)?.data ?? null;
}

let osRelease = {};
try {
  osRelease = Object.fromEntries(
    readFileSync('/etc/os-release', 'utf8')
      .split('\n')
      .filter((line) => line.includes('='))
      .map((line) => {
        const [key, ...rest] = line.split('=');
        return [key, rest.join('=').replace(/^"|"$/g, '')];
      }),
  );
} catch {}

const cpus = os.cpus();
console.log(JSON.stringify({
  capturedAt: new Date().toISOString(),
  hostname: os.hostname(),
  cpu: {
    model: cpus[0]?.model ?? lscpuField('Model name'),
    logicalProcessors: cpus.length,
    sockets: Number(lscpuField('Socket(s)')) || null,
    coresPerSocket: Number(lscpuField('Core(s) per socket')) || null,
    threadsPerCore: Number(lscpuField('Thread(s) per core')) || null,
    numaNodes: Number(lscpuField('NUMA node(s)')) || null,
  },
  memory: {
    totalBytes: os.totalmem(),
    freeBytesAtCapture: os.freemem(),
    swap: command('sh', ['-c', "free -b | awk '/^Swap:/ {print $2}'"]),
  },
  software: {
    platform: os.platform(),
    architecture: os.arch(),
    kernel: os.release(),
    distribution: osRelease.PRETTY_NAME ?? null,
    node: process.version,
    pnpm: command('pnpm', ['--version']),
    dockerEngine: command('docker', ['version', '--format', '{{.Server.Version}}']),
    dockerCompose: command('docker', ['compose', 'version', '--short']),
    dockerCgroupVersion: command('docker', ['info', '--format', '{{.CgroupVersion}}']),
    postgresImage: 'postgres:16-alpine',
    redisImage: 'redis:7-alpine',
  },
  source: {
    commit: command('git', ['rev-parse', 'HEAD']),
    dirty: Boolean(command('git', ['status', '--porcelain'])),
  },
}, null, 2));
