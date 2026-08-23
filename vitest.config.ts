import react from "@vitejs/plugin-react";
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    projects: [
      {
        test: {
          name: "node",
          environment: "node",
          include: ["packages/**/*.test.ts", "infra/**/*.test.ts", "tooling/**/*.test.ts"],
        },
      },
      {
        plugins: [react()],
        test: {
          name: "dashboard",
          environment: "jsdom",
          include: ["apps/dashboard/**/*.test.tsx"],
          setupFiles: ["apps/dashboard/src/test/setup.ts"],
        },
      },
    ],
    coverage: {
      provider: "v8",
      include: [
        "apps/dashboard/src/**/*.{ts,tsx}",
        "infra/**/*.ts",
        "packages/*/src/**/*.ts",
        "tooling/run-sst.mjs",
      ],
      exclude: [
        "**/*.d.ts",
        "**/*.test.{ts,tsx}",
        "**/src/main.tsx",
        "**/src/test/**",
        "infra/api.ts",
        "infra/dashboard.ts",
      ],
      thresholds: {
        statements: 80,
        branches: 80,
        functions: 80,
        lines: 80,
      },
    },
  },
});
