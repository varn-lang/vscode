import { build } from "esbuild";

await build({
    entryPoints: ["extension.ts"],
    outfile: "dist/extension.cjs",
    bundle: true,
    platform: "node",
    format: "cjs",
    target: "node20",
    external: ["vscode"],
    sourcemap: true,
    logLevel: "info",
});
