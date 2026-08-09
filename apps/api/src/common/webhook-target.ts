import { lookup } from 'node:dns/promises';
import { request as httpRequest } from 'node:http';
import { request as httpsRequest } from 'node:https';
import { isIP } from 'node:net';

const BLOCKED_HOST_SUFFIXES = ['.localhost', '.local', '.internal', '.home', '.lan'];

export async function assertSafeWebhookTarget(rawUrl: string): Promise<URL> {
  return (await resolveSafeWebhookTarget(rawUrl)).url;
}

type ResolvedWebhookTarget = {
  url: URL;
  addresses: Array<{ address: string; family: 4 | 6 }>;
};

async function resolveSafeWebhookTarget(rawUrl: string): Promise<ResolvedWebhookTarget> {
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

  const addresses = await resolveSafeWebhookHostname(parsed.hostname);
  return { url: parsed, addresses };
}

async function resolveSafeWebhookHostname(
  hostname: string,
): Promise<Array<{ address: string; family: 4 | 6 }>> {
  const normalized = hostname.trim().toLowerCase().replace(/^\[|\]$/g, '');
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
    return [{ address: normalized, family: isIP(normalized) as 4 | 6 }];
  }

  let records: Array<{ address: string; family?: number }>;
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

  return records.map((record) => ({
    address: record.address,
    family: (record.family ?? isIP(record.address)) as 4 | 6,
  }));
}

export const webhookDns = {
  async lookupHostname(hostname: string): Promise<Array<{ address: string; family: number }>> {
    return lookup(hostname, { all: true, verbatim: true });
  },
};

type WebhookDelivery = {
  ok: boolean;
  status: number;
};

const REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308]);

/**
 * Delivers a webhook while pinning each connection to the public IP address that
 * was checked. Redirects are resolved and checked as independent targets.
 */
export async function postWebhookSafely(
  rawUrl: string,
  body: string,
  headers: Record<string, string>,
  options: { timeoutMs?: number; maxRedirects?: number } = {},
): Promise<WebhookDelivery> {
  const timeoutMs = options.timeoutMs ?? 8_000;
  const maxRedirects = options.maxRedirects ?? 3;
  let nextUrl = rawUrl;

  for (let redirectCount = 0; redirectCount <= maxRedirects; redirectCount += 1) {
    const target = await resolveSafeWebhookTarget(nextUrl);
    const response = await requestPinnedTarget(target, body, headers, timeoutMs);
    const location = response.headers['location'];

    if (!REDIRECT_STATUSES.has(response.status) || !location) {
      return { ok: response.status >= 200 && response.status < 300, status: response.status };
    }
    if (redirectCount === maxRedirects) {
      throw new Error('Webhook redirect limit exceeded.');
    }

    nextUrl = new URL(location, target.url).toString();
  }

  throw new Error('Webhook redirect limit exceeded.');
}

async function requestPinnedTarget(
  target: ResolvedWebhookTarget,
  body: string,
  headers: Record<string, string>,
  timeoutMs: number,
): Promise<{ status: number; headers: Record<string, string | undefined> }> {
  const pinned = target.addresses[Math.floor(Math.random() * target.addresses.length)];
  if (!pinned) {
    throw new Error('Webhook URL hostname could not be resolved.');
  }

  const request = target.url.protocol === 'https:' ? httpsRequest : httpRequest;
  return new Promise((resolve, reject) => {
    const outgoing = request(
      target.url,
      {
        method: 'POST',
        headers: {
          ...headers,
          'content-length': Buffer.byteLength(body).toString(),
        },
        lookup: (_hostname, _options, callback) => {
          callback(null, pinned.address, pinned.family);
        },
        servername: target.url.hostname,
        timeout: timeoutMs,
      },
      (incoming) => {
        incoming.resume();
        resolve({
          status: incoming.statusCode ?? 0,
          headers: {
            location: Array.isArray(incoming.headers.location)
              ? incoming.headers.location[0]
              : incoming.headers.location,
          },
        });
      },
    );
    outgoing.once('timeout', () => outgoing.destroy(new Error('Webhook request timed out.')));
    outgoing.once('error', reject);
    outgoing.end(body);
  });
}

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
