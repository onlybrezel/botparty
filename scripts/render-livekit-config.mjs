import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

const outputDirectory = resolve(process.argv[2] ?? '/output');
const secretDirectory = resolve(process.env.RUNTIME_SECRET_DIR ?? '/run/secrets');

function required(name) {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is required to render LiveKit configuration`);
  return value;
}

function secret(name) {
  const value = readFileSync(resolve(secretDirectory, name), 'utf8').replace(/\r?\n$/, '');
  if (!value) throw new Error(`Secret file ${name} is empty`);
  return value;
}

const apiKey = required('LIVEKIT_API_KEY');
const apiSecret = secret('livekit_api_secret');
const redisPassword = secret('redis_password');
const redis = { address: 'redis:6379', password: redisPassword };

const configurations = {
  'livekit.json': {
    port: 7880,
    rtc: {
      port_range_start: 50000,
      port_range_end: 50100,
      tcp_port: 7881,
      use_external_ip: true,
      interfaces: { excludes: ['lo', 'docker*', 'br-*', 'veth*'] },
    },
    logging: { level: 'warn', pion_level: 'error' },
    room: { auto_create: true, empty_timeout: 300, max_participants: 1000 },
    redis,
    keys: { [apiKey]: apiSecret },
    ingress: { whip_base_url: required('LIVEKIT_WHIP_BASE_URL') },
  },
  'ingress.json': {
    api_key: apiKey,
    api_secret: apiSecret,
    ws_url: 'ws://livekit:7880',
    redis,
    log_level: 'info',
    health_port: 9091,
    whip_port: 8080,
    rtc_config: { use_external_ip: true, tcp_port: 7882, udp_port: 7885 },
  },
  'egress.json': {
    api_key: apiKey,
    api_secret: apiSecret,
    ws_url: 'ws://livekit:7880',
    redis,
    log_level: 'warn',
    health_port: 9090,
  },
};

mkdirSync(outputDirectory, { recursive: true, mode: 0o755 });
for (const [name, configuration] of Object.entries(configurations)) {
  // LiveKit, ingress, and egress images use different non-root UIDs. The
  // dedicated Docker volume is mounted only into those services, so a readable
  // runtime config is safer than relying on image-specific numeric ownership.
  writeFileSync(resolve(outputDirectory, name), `${JSON.stringify(configuration, null, 2)}\n`, { mode: 0o644 });
}
console.log('LiveKit runtime configuration rendered from secret files.');
