import type { NextConfig } from "next";

const config: NextConfig = {
  transpilePackages: ["@acex/shared"],
  turbopack: {},
};

export default config;
