import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "desktop-dist/**",
    "out/**",
    "build/**",
    ".utmp/**",
    "Microsoft/**",
    "supabase/functions/**",
    "next-env.d.ts",
  ]),
  {
    files: ["electron/**/*.cjs", "scripts/**/*.cjs", "tests/**/*.cjs"],
    rules: {
      "@typescript-eslint/no-require-imports": "off",
    },
  },
]);

export default eslintConfig;
