import type { NextConfig } from "next";

const config: NextConfig = {
  transpilePackages: ["@acex/shared"],
  // @acex/shared uses NodeNext-style ".js" import specifiers that point at ".ts" sources;
  // Turbopack cannot alias those yet, so dev/build run with webpack (see package.json scripts).
  webpack(cfg) {
    cfg.resolve.extensionAlias = { ".js": [".ts", ".tsx", ".js"] };
    return cfg;
  },
};

export default config;
