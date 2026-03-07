import nextTs from "eslint-config-next/typescript";
import nextVitals from "eslint-config-next/core-web-vitals";
import { defineConfig, globalIgnores } from "eslint/config";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  {
    files: ["src/**/*.{ts,tsx}"],
    rules: {
      // Existing code relies on dynamic payloads in API/debug tooling.
      // Keep visible as warning first, then tighten incrementally.
      "@typescript-eslint/no-explicit-any": "warn",
    },
  },
  {
    files: [
      "src/app/api/fetch-wiki-stream/route.ts",
      "src/app/api/process-image-stream/route.ts",
      "src/lib/canvas-detection.ts",
      "src/lib/panel-detection.ts",
    ],
    rules: {
      // These modules process heterogeneous LLM/detection payloads where strict
      // typing is still under migration; keep lint noise low meanwhile.
      "@typescript-eslint/no-explicit-any": "off",
    },
  },
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
  ]),
]);

export default eslintConfig;
