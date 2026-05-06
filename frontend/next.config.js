/** @type {import('next').NextConfig} */
const nextConfig = {
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
        destination: 'https://web-production-e78a1.up.railway.app/api/:path*',
      },
      // FIX: tambahkan /sim dan /market agar ter-proxy ke backend
      {
        source: '/sim/:path*',
        destination: 'https://web-production-e78a1.up.railway.app/sim/:path*',
      },
      {
        source: '/market/:path*',
        destination: 'https://web-production-e78a1.up.railway.app/market/:path*',
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
