import eslint from "@eslint/js";
import globals from "globals";
import tseslint from "typescript-eslint";

export default tseslint.config(
  {
    ignores: [
      ".sst/**",
      ".tsbuild/**",
      "coverage/**",
      "dist/**",
      "**/dist/**",
      "node_modules/**",
      "**/sst-env.d.ts",
    ],
  },
  {
    ...eslint.configs.recommended,
    files: ["**/*.{js,mjs}"],
    languageOptions: {
      globals: globals.node,
    },
  },
  ...tseslint.configs.recommendedTypeChecked.map((config) => ({
    ...config,
    files: ["**/*.{ts,tsx}"],
    languageOptions: {
      ...config.languageOptions,
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
  })),
  {
    files: ["apps/dashboard/**/*.{ts,tsx}"],
    languageOptions: {
      globals: {
        ...globals.browser,
        ...globals.node,
      },
    },
  },
  {
    ...tseslint.configs.disableTypeChecked,
    files: ["sst.config.ts"],
    languageOptions: {
      ...tseslint.configs.disableTypeChecked.languageOptions,
    },
    rules: {
      ...tseslint.configs.disableTypeChecked.rules,
      "@typescript-eslint/triple-slash-reference": "off",
    },
  },
  {
    files: ["**/*.test.{ts,tsx}"],
    languageOptions: {
      globals: globals.node,
    },
  },
);
