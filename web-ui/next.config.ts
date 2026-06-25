import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: 'standalone',
  devIndicators: false,
  async rewrites() {
    const fastapiBase = (process.env.FASTAPI_URL || 'http://127.0.0.1:8001/api/v1')
      .replace(/\/api\/v1\/?$/, '');
    return [
      {
        source: '/outputs/:path*',
        destination: `${fastapiBase}/outputs/:path*`,
      },
    ];
  },
};

export default nextConfig;
