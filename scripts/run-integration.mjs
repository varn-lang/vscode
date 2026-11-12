import { build } from "esbuild";
import { runTests } from "@vscode/test-electron";
import { cpSync, existsSync, mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");

function findVn() {
    const candidates = [
        process.env.VN_CLI_PATH,
        resolve(root, "..", "varn-lang", "target", "quick", "vn.exe"),
        resolve(root, "..", "varn-lang", "target", "release", "vn.exe"),
        resolve(root, "..", "varn-lang", "target", "debug", "vn.exe"),
        resolve(root, "..", "varn-lang", "target", "quick", "vn"),
        resolve(root, "..", "varn-lang", "target", "release", "vn"),
    ];
    const found = candidates.find((candidate) => candidate && existsSync(candidate));
    if (!found) {
        console.error("No vn binary found. Build one (cargo build --profile quick --bin vn) or set VN_CLI_PATH.");
        process.exit(2);
    }
    return found;
}

function findLocalVsCode() {
    const candidates = [
        process.env.VSCODE_EXECUTABLE,
        join(process.env.LOCALAPPDATA ?? "", "Programs", "Microsoft VS Code", "Code.exe"),
        "/usr/share/code/code",
        "/Applications/Visual Studio Code.app/Contents/MacOS/Electron",
    ];
    return candidates.find((candidate) => candidate && existsSync(candidate));
}

const outDirectory = join(root, "out", "integration");
await build({
    entryPoints: [join(root, "test", "integration", "suite.ts")],
    outfile: join(outDirectory, "suite.cjs"),
    bundle: true,
    platform: "node",
    format: "cjs",
    target: "node20",
    external: ["vscode"],
    logLevel: "warning",
});

const scratch = mkdtempSync(join(tmpdir(), "vn-extension-it-"));
const workspace = join(scratch, "workspace");
mkdirSync(join(workspace, ".vscode"), { recursive: true });
cpSync(join(root, "test", "integration", "fixtures"), workspace, { recursive: true });
const vn = findVn();
writeFileSync(
    join(workspace, ".vscode", "settings.json"),
    JSON.stringify(
        {
            "vn.cli.path": vn,
            "vn.hotReload.watchBinary": false,
            "editor.semanticHighlighting.enabled": true,
            "[vn]": { "editor.semanticHighlighting.enabled": true, "editor.inlayHints.enabled": "off" },
        },
        null,
        2,
    ),
);

console.log(`vn binary: ${vn}`);
const vscodeExecutablePath = findLocalVsCode();
console.log(`VS Code:   ${vscodeExecutablePath ?? "downloading stable"}`);

try {
    await runTests({
        ...(vscodeExecutablePath ? { vscodeExecutablePath } : {}),
        extensionDevelopmentPath: root,
        extensionTestsPath: join(outDirectory, "suite.cjs"),
        launchArgs: [
            workspace,
            `--user-data-dir=${join(scratch, "user-data")}`,
            `--extensions-dir=${join(scratch, "extensions")}`,
            "--disable-extensions",
            "--disable-workspace-trust",
            "--skip-welcome",
            "--skip-release-notes",
        ],
    });
} catch (error) {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
}
