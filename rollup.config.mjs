import { nodeResolve } from "@rollup/plugin-node-resolve";
import commonjs from "@rollup/plugin-commonjs";

export default {
    input: "extension.js",
    output: {
        file: "dist/extension.cjs",
        format: "cjs",
        sourcemap: true,
        exports: "named",
    },
    external: ["vscode"],
    plugins: [nodeResolve({ preferBuiltins: true }), commonjs()],
};
