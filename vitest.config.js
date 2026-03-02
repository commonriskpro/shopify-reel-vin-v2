import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: ["tests/**/*.test.js", "app/**/*.test.js"],
    globals: false,
  },
});
