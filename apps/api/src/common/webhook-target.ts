import { lookup } from 'node:dns/promises';
import { isIP } from 'node:net';

const BLOCKED_HOST_SUFFIXES = ['.localhost', '.local', '.internal', '.home', '.lan'];

export async function assertSafeWebhookTarget(rawUrl: string): Promise<URL> {
  let parsed: URL;
  try {
    parsed = new URL(rawUrl.trim());
  } catch {
    throw new Error('Webhook URL must be a valid absolute URL.');
  }

  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new Error('Webhook URL must use http or https.');
  }

  if (parsed.username || parsed.password) {
    throw new Error('Webhook URL must not include embedded credentials.');
  }

  await assertSafeWebhookHostname(parsed.hostname);
  return parsed;
}

async function assertSafeWebhookHostname(hostname: string): Promise<void> {
  const normalized = hostname.trim().toLowerCase();
  if (!normalized) {
    throw new Error('Webhook URL must include a hostname.');
  }

  if (
    normalized === 'localhost' ||
    BLOCKED_HOST_SUFFIXES.some((suffix) => normalized.endsWith(suffix))
  ) {
    throw new Error('Webhook URL must not target localhost or a local-network hostname.');
  }

  if (isIP(normalized) !== 0) {
    if (isPrivateAddress(normalized)) {
      throw new Error('Webhook URL must not target loopback, private, or link-local IP ranges.');
    }
    return;
  }

  let records: Array<{ address: string }>;
  try {
    records = await webhookDns.lookupHostname(normalized);
  } catch {
    throw new Error('Webhook URL hostname could not be resolved.');
  }

  if (records.length === 0) {
    throw new Error('Webhook URL hostname could not be resolved.');
  }

  for (const record of records) {
    if (isPrivateAddress(record.address)) {
      throw new Error('Webhook URL resolved to a loopback, private, or link-local address.');
    }
  }
}

export const webhookDns = {
  async lookupHostname(hostname: string): Promise<Array<{ address: string }>> {
    return lookup(hostname, { all: true, verbatim: true });
  },
};

function isPrivateAddress(address: string): boolean {
  const version = isIP(address);
  if (version === 4) {
    return isPrivateIpv4(address);
  }
  if (version === 6) {
    return isPrivateIpv6(address);
  }
  return true;
}

function isPrivateIpv4(address: string): boolean {
  const octets = address.split('.').map((segment) => Number(segment));
  if (octets.length !== 4 || octets.some((segment) => Number.isNaN(segment) || segment < 0 || segment > 255)) {
    return true;
  }

  const [a, b] = octets;
  if (a === undefined || b === undefined) {
    return true;
  }

  if (a === 0 || a === 10 || a === 127) {
    return true;
  }
  if (a === 100 && b >= 64 && b <= 127) {
    return true;
  }
  if (a === 169 && b === 254) {
    return true;
  }
  if (a === 172 && b >= 16 && b <= 31) {
    return true;
  }
  if (a === 192 && (b === 0 || b === 168)) {
    return true;
  }
  if (a === 198 && (b === 18 || b === 19)) {
    return true;
  }
  if (a >= 224) {
    return true;
  }

  return false;
}

function isPrivateIpv6(address: string): boolean {
  const normalized = address.toLowerCase();

  if (normalized === '::' || normalized === '::1') {
    return true;
  }
  if (normalized.startsWith('fe80:') || normalized.startsWith('fe90:') || normalized.startsWith('fea') || normalized.startsWith('feb')) {
    return true;
  }
  if (normalized.startsWith('fc') || normalized.startsWith('fd')) {
    return true;
  }
  if (normalized.startsWith('ff')) {
    return true;
  }
  if (normalized.startsWith('2001:db8:')) {
    return true;
  }
  if (normalized.startsWith('::ffff:')) {
    return isPrivateIpv4(normalized.slice('::ffff:'.length));
  }

  return false;
}
