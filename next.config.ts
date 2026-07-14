import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  devIndicators: false, // the floating "N/route" badge is dev-only noise, not part of the app
};

export default nextConfig;
