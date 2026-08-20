import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    extensionAlias: {
      ".js": [".ts", ".js"],
    },
  },
  test: {
    fileParallelism: false,
    include: ["src/**/*.test.ts"],
  },
});
