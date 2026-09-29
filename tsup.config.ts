import { defineConfig } from "tsup";

export default defineConfig({
  entry: {
    cli: "src/cli.ts",
    index: "src/index.ts",
  },
  format: ["esm"],
  target: "node20",
  outExtension: () => ({ js: ".mjs" }),
  // Declarations come from tsc, not tsup: tsup's dts step uses rollup-plugin-dts,
  // which pokes at TypeScript's internal JS API and breaks on the native TS 7.
  dts: false,
  clean: true,
  sourcemap: true,
  treeshake: true,
});
