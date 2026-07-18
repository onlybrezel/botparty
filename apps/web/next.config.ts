import path from 'path';
import type { NextConfig } from 'next';
import bundleAnalyzer from '@next/bundle-analyzer';

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

const isDev = process.env.NODE_ENV !== 'production';

const securityHeaders = [
  { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
  { key: 'X-Content-Type-Options', value: 'nosniff' },
  { key: 'X-Frame-Options', value: 'DENY' },
  { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=()' },
];

function buildImageRemotePatterns(): NonNullable<
  NonNullable<NextConfig['images']>['remotePatterns']
> {
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
    for (const entry of extra
      .split(',')
      .map((e) => e.trim())
      .filter(Boolean)) {
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
  allowedDevOrigins: isDev ? ['127.0.0.1', 'localhost'] : undefined,
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

const withBundleAnalyzer = bundleAnalyzer({
  enabled: process.env.ANALYZE === 'true',
  openAnalyzer: false,
});

export default withBundleAnalyzer(nextConfig);
