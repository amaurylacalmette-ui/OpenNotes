import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // The canvas ink engine handles effect cleanup correctly; keep strict-mode
  // double-mounting off so dev sessions with an active stylus stay stable.
  reactStrictMode: false,
};

export default nextConfig;
