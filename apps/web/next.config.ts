import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  reactStrictMode: true,
  transpilePackages: ['@botparty/shared'],
  experimental: {
    serverActions: {
      bodySizeLimit: '2mb',
    },
  },
  images: {
    remotePatterns: [
      { protocol: 'https', hostname: '**' },
    ],
  },
};

export default nextConfig;
