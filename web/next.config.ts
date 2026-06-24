import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Default 1mb is too small for a real .pptx/.pdf deck upload (Feature 2, Step 3).
  experimental: {
    serverActions: {
      bodySizeLimit: '25mb',
    },
  },
};

export default nextConfig;
