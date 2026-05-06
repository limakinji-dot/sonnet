/** @type {import('next').NextConfig} */
const BACKEND_URL = process.env.NEXT_PUBLIC_BACKEND_URL || "https://web-production-e78a1.up.railway.app";

const nextConfig = {
  env: {
    NEXT_PUBLIC_BACKEND_URL: BACKEND_URL,
  },
  reactStrictMode: true,
  swcMinify: true,

  images: {
    unoptimized: true,
    remotePatterns: [
      {
        protocol: 'https',
        hostname: '**',
      },
    ],
  },

  async rewrites() {
    return [
      {
        source: '/api/:path*',
        destination: `${BACKEND_URL}/api/:path*`,
      },
      // /sim dan /market di-proxy ke backend untuk HTTP requests.
      // NOTE: WebSocket (/sim/ws) TIDAK bisa lewat Next.js rewrites —
      // frontend harus connect WS langsung ke BACKEND_URL.
      {
        source: '/sim/:path*',
        destination: `${BACKEND_URL}/sim/:path*`,
      },
      {
        source: '/market/:path*',
        destination: `${BACKEND_URL}/market/:path*`,
      },
    ];
  },

  webpack: (config, { isServer }) => {
    if (!isServer) {
      config.resolve.fallback = {
        ...config.resolve.fallback,
        fs: false,
        net: false,
        tls: false,
      };
    }
    config.externals.push('utf-8-validate', 'bufferutil');
    return config;
  },
};

module.exports = nextConfig;
