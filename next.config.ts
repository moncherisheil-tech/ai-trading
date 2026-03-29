import type {NextConfig} from 'next';
import path from 'path';

const nextConfig: NextConfig = {
  reactStrictMode: true,
  eslint: {
    ignoreDuringBuilds: true,
  },
  typescript: {
    ignoreBuildErrors: true,
  },
  output: 'standalone',
  outputFileTracingRoot: path.join(process.cwd()),
  // Externalize heavy native/server-only packages so they are loaded from
  // node_modules at runtime rather than bundled into server chunks.
  // This is critical for standalone mode: bundling these causes broken module
  // references, missing server-reference-manifest.json entries, and MIME errors.
  serverExternalPackages: [
    'pg',
    'pg-native',
    'ws',
    '@prisma/client',
    'prisma',
    '@prisma/adapter-pg',
    'ccxt',
    'protobufjs',
  ],
  poweredByHeader: false,
  assetPrefix: '',
  basePath: '',
  compress: true,
  productionBrowserSourceMaps: false,
  compiler: {
    // Keep log/warn/error for production audit trails
    removeConsole: process.env.NODE_ENV === 'production' ? { exclude: ['log', 'warn', 'error'] } : false,
  },
  images: {
    remotePatterns: [
      {
        protocol: 'https',
        hostname: 'picsum.photos',
        port: '',
        pathname: '/**', // This allows any path under the hostname
      },
    ],
  },
  transpilePackages: ['motion', 'lightweight-charts'],
  async redirects() {
    return [
      { source: '/dashboard', destination: '/ops', permanent: false },
      { source: '/alpha', destination: '/admin/signals', permanent: false },
      { source: '/pnl', destination: '/ops/pnl', permanent: false },
    ];
  },
  // Security headers tuned to support non-SSL environments when needed.
  async headers() {
    return [
      {
        source: '/(.*)',
        headers: [
          {
            key: 'Content-Security-Policy',
            value:
              "default-src 'self'; script-src 'self' 'unsafe-eval' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' blob: data:; font-src 'self'; object-src 'none'; base-uri 'self'; form-action 'self'; frame-ancestors 'none'; connect-src 'self' wss://stream.binance.com:9443 https://api.binance.com https://*.neon.tech;",
          },
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'X-Frame-Options', value: 'DENY' },
          { key: 'X-XSS-Protection', value: '1; mode=block' },
          { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
          { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=()' },
        ],
      },
    ];
  },
  webpack: (config, {dev}) => {
    // HMR is disabled in AI Studio via DISABLE_HMR env var.
    // Do not modify - file watching is disabled to prevent flickering during agent edits.
    if (dev && process.env.DISABLE_HMR === 'true') {
      config.watchOptions = {
        ignored: /.*/,
      };
    }
    const prev = config.ignoreWarnings;
    const ccxtCriticalDep = (warning: { message?: string; module?: { resource?: string } }) => {
      const msg = warning.message ?? '';
      const res = warning.module?.resource ?? '';
      return (
        /Critical dependency: the request of a dependency is an expression/.test(msg) &&
        /[/\\]ccxt[/\\]/.test(res.replace(/\\/g, '/'))
      );
    };
    config.ignoreWarnings = Array.isArray(prev) ? [...prev, ccxtCriticalDep] : prev ? [prev, ccxtCriticalDep] : [ccxtCriticalDep];
    return config;
  },
};

export default nextConfig;
