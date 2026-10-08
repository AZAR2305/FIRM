import type { NextConfig } from "next";

const config: NextConfig = {
  reactStrictMode: true,
  // the repo root holds several lockfiles (backend/, frontend/); pin Next's workspace root to this app
  turbopack: { root: __dirname },
};

export default config;
