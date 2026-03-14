await Bun.build({
  entrypoints: ["src/index.ts"],
  outdir: "dist",
  target: "bun",
  format: "esm",
  sourcemap: "external",
  naming: {
    entry: "[dir]/[name].js",
  },
});
