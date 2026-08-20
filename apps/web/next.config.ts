import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  transpilePackages: [
    "@schoolapp/api",
    "@schoolapp/auth",
    "@schoolapp/core",
    "@schoolapp/db",
    "@schoolapp/domain",
  ],
  serverExternalPackages: ["pg", "argon2"],
};

export default nextConfig;
