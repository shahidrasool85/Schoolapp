import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    extensionAlias: {
      ".js": [".ts", ".js"],
    },
  },
  test: {
    fileParallelism: false,
    testTimeout: 30000,
    hookTimeout: 60000,
  },
});
