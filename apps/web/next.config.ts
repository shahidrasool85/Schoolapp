import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  distDir: process.env.NEXT_DIST_DIR ?? ".next",
  allowedDevOrigins: ["127.0.0.1", "localhost", "*.localhost"],
  transpilePackages: [
    "@schoolapp/api",
    "@schoolapp/auth",
    "@schoolapp/core",
    "@schoolapp/db",
    "@schoolapp/domain",
  ],
  serverExternalPackages: ["pg", "argon2"],
  webpack: (config, { isServer }) => {
    config.resolve.extensionAlias = {
      ...config.resolve.extensionAlias,
      ".js": [".ts", ".tsx", ".js", ".jsx"],
    };
    if (isServer) {
      const previous = config.externals;
      config.externals = [
        ...(Array.isArray(previous) ? previous : previous ? [previous] : []),
        "argon2",
        "pg",
      ];
    }
    return config;
  },
};

export default nextConfig;
