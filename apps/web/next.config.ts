import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  distDir: process.env.NEXT_DIST_DIR ?? ".next",
  allowedDevOrigins: ["127.0.0.1", "localhost", "*.localhost"],
  experimental: {
    serverActions: { bodySizeLimit: "25mb" },
    middlewareClientMaxBodySize: "25mb",
  },
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
    "@schoolapp/storage",
  ],
  serverExternalPackages: ["pg", "argon2", "qrcode", "@aws-sdk/client-s3", "@aws-sdk/s3-request-presigner"],
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
        "@aws-sdk/client-s3",
        "@aws-sdk/s3-request-presigner",
      ];
    }
    return config;
  },
};

export default nextConfig;
