import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  distDir: process.env.NEXT_DIST_DIR ?? ".next",
  allowedDevOrigins: ["127.0.0.1", "localhost", "*.localhost"],
  async headers() {
    return [
      {
        source: "/admissions/embed/:path*",
        headers: [{ key: "Content-Security-Policy", value: "frame-ancestors *" }],
      },
    ];
  },
  transpilePackages: [
    "@schoolapp/api",
    "@schoolapp/auth",
    "@schoolapp/core",
    "@schoolapp/db",
    "@schoolapp/domain",
  ],
  serverExternalPackages: ["pg", "argon2", "qrcode"],
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
        "qrcode",
      ];
    }
    return config;
  },
};

export default nextConfig;
