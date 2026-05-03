import path from 'path';
import type { NextConfig } from 'next';

const API_URL = process.env.API_URL ?? 'http://localhost:4000';

function readOrigin(value: string | undefined): string | null {
  const trimmed = value?.trim();
  if (!trimmed) return null;
  try {
    return new URL(trimmed).origin;
  } catch {
    return null;
  }
}

function collectExtraOrigins(): string[] {
  const origins = new Set<string>();
  const keys = [
    'NEXT_PUBLIC_API_URL',
    'NEXT_PUBLIC_WS_URL',
    'NEXT_PUBLIC_LIVEKIT_URL',
    'NEXT_PUBLIC_APP_URL',
    'CSP_EXTRA_CONNECT_ORIGINS',
    'CSP_EXTRA_IMG_ORIGINS',
  ];
  for (const key of keys) {
    const raw = process.env[key];
    if (!raw) continue;
    for (const entry of raw.split(',')) {
      const origin = readOrigin(entry);
      if (origin) origins.add(origin);
    }
  }
  return [...origins];
}

const isDev = process.env.NODE_ENV !== 'production';
const extraOrigins = collectExtraOrigins();

// Build a strict CSP. Only allow the origins we actually need.
// Note: Next.js + React 19 require 'unsafe-inline' for hydration scripts
// unless we plumb nonces through the App Router (separate task). We do not
// allow 'unsafe-eval' anywhere.
const cspDirectives: Record<string, string[]> = {
  'default-src': ["'self'"],
  'base-uri': ["'self'"],
  'frame-ancestors': ["'none'"],
  'object-src': ["'none'"],
  'script-src': ["'self'", "'unsafe-inline'"],
  'style-src': ["'self'", "'unsafe-inline'"],
  'img-src': ["'self'", 'data:', 'blob:', 'https:'],
  'font-src': ["'self'", 'data:'],
  'media-src': ["'self'", 'blob:', 'https:'],
  'worker-src': ["'self'", 'blob:'],
  'connect-src': ["'self'", 'https:', 'wss:', ...extraOrigins],
  'manifest-src': ["'self'"],
};

if (isDev) {
  // Local dev needs http/ws to talk to the API container without TLS.
  const connectSrc = cspDirectives['connect-src'];
  if (connectSrc) {
    connectSrc.push('http:', 'ws:');
  }
}

const cspValue = Object.entries(cspDirectives)
  .map(([directive, sources]) => `${directive} ${[...new Set(sources)].join(' ')}`)
  .join('; ');

const securityHeaders = [
  { key: 'Content-Security-Policy', value: cspValue },
  { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
  { key: 'X-Content-Type-Options', value: 'nosniff' },
  { key: 'X-Frame-Options', value: 'DENY' },
  { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=()' },
];

function buildImageRemotePatterns(): NonNullable<NonNullable<NextConfig['images']>['remotePatterns']> {
  const patterns: NonNullable<NonNullable<NextConfig['images']>['remotePatterns']> = [];
  const extra = process.env.NEXT_PUBLIC_IMAGE_REMOTE_HOSTS;
  const hosts = new Set<string>();

  for (const key of ['THUMBNAIL_PUBLIC_BASE_URL', 'NEXT_PUBLIC_API_URL', 'NEXT_PUBLIC_APP_URL']) {
    const raw = process.env[key];
    if (!raw) continue;
    try {
      const url = new URL(raw);
      hosts.add(`${url.protocol}//${url.hostname}`);
    } catch {
      // ignore
    }
  }

  for (const host of hosts) {
    try {
      const url = new URL(host);
      patterns.push({
        protocol: url.protocol.replace(':', '') as 'http' | 'https',
        hostname: url.hostname,
      });
    } catch {
      // ignore
    }
  }

  if (extra) {
    for (const entry of extra.split(',').map((e) => e.trim()).filter(Boolean)) {
      const [proto, host] = entry.includes('://') ? entry.split('://') : ['https', entry];
      if (!host) continue;
      patterns.push({ protocol: (proto as 'http' | 'https') ?? 'https', hostname: host });
    }
  }

  if (isDev) {
    patterns.push({ protocol: 'http', hostname: 'localhost' });
    patterns.push({ protocol: 'http', hostname: '127.0.0.1' });
    patterns.push({ protocol: 'http', hostname: 'minio' });
  }

  // Ensure at least one host is set so next/image does not throw at runtime.
  if (patterns.length === 0) {
    patterns.push({ protocol: 'https', hostname: 'localhost' });
  }

  return patterns;
}

const nextConfig: NextConfig = {
  output: 'standalone',
  outputFileTracingRoot: path.join(__dirname, '../../'),
  reactStrictMode: true,
  transpilePackages: ['@botparty/shared'],
  eslint: {
    ignoreDuringBuilds: true,
  },
  typescript: {
    ignoreBuildErrors: true,
  },
  experimental: {
    serverActions: {
      bodySizeLimit: '2mb',
    },
  },
  images: {
    remotePatterns: buildImageRemotePatterns(),
  },
  async rewrites() {
    return [
      {
        source: '/api/v1/:path*',
        destination: `${API_URL}/api/v1/:path*`,
      },
    ];
  },
  async headers() {
    return [
      {
        source: '/:path*',
        headers: securityHeaders,
      },
    ];
  },
};

// Wrap with @next/bundle-analyzer when ANALYZE=true. Loaded lazily so the
// dependency stays optional in CI/runtime images.
function withOptionalAnalyzer(config: NextConfig): NextConfig {
  if (process.env.ANALYZE !== 'true') return config;
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const withBundleAnalyzer = require('@next/bundle-analyzer')({
      enabled: true,
      openAnalyzer: false,
    });
    return withBundleAnalyzer(config);
  } catch {
    // eslint-disable-next-line no-console
    console.warn('[next.config] ANALYZE=true but @next/bundle-analyzer is not installed');
    return config;
  }
}

export default withOptionalAnalyzer(nextConfig);
