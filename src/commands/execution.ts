import * as vscode from "vscode";
import * as path from "node:path";
import { resolveTargetFile, runInOutputChannel, resolveCliPath, formatTerminalCommand } from "./base.js";
import { updateBuildModeStatusBar } from "../status.js";
import { VarnVisualInspectorPanel } from "../views/visual_debugger.js";

type TargetUri = vscode.Uri | string | undefined;

const BINARY_NOT_FOUND = "Varn binary not found.";
const BINARY_NOT_FOUND_WITH_HINT =
    "Varn binary not found. Build with `cargo build --release --bin vn` or set Varn.cli.path.";

const DEBUG_PHASES = [
    "tokens",
    "ast",
    "bytecode",
    "symbols",
    "binds",
    "modules",
    "types",
    "expr",
    "errors",
    "trace",
    "calls",
    "consts",
    "scope",
    "graph",
];

function toUri(target: TargetUri): vscode.Uri | undefined {
    return typeof target === "string" ? vscode.Uri.parse(target) : target;
}

interface Invocation {
    file: string;
    cliPath: string;
    cwd: string;
    name: string;
}

function prepare(context: vscode.ExtensionContext, target: TargetUri, notFound = BINARY_NOT_FOUND): Invocation | undefined {
    const file = resolveTargetFile(toUri(target));
    if (!file) return undefined;

    const cliPath = resolveCliPath(context);
    if (!cliPath) {
        void vscode.window.showErrorMessage(notFound);
        return undefined;
    }
    return { file, cliPath, cwd: path.dirname(file), name: path.basename(file) };
}

/** Run a Varn file (vn run). */
function runVarnFile(
    context: vscode.ExtensionContext,
    uri: TargetUri,
    opts: { terminal: boolean; verbose?: boolean },
): void {
    const run = prepare(context, uri, BINARY_NOT_FOUND_WITH_HINT);
    if (!run) return;

    const verbose = opts.verbose ?? vscode.workspace.getConfiguration("Varn").get<boolean>("run.verbose") ?? false;
    const args = ["run", run.file];
    if (verbose) args.push("--verbose");

    if (opts.terminal) {
        const terminal = vscode.window.createTerminal({ name: `Varn Run: ${run.name}`, cwd: run.cwd });
        terminal.show(true);
        terminal.sendText(formatTerminalCommand(run.cliPath, args));
    } else {
        runInOutputChannel(run.cliPath, args, run.cwd, `Run: ${run.name}`);
    }
}

/** Check types in a Varn file (vn check). */
function runCheck(context: vscode.ExtensionContext, uri: TargetUri): void {
    const run = prepare(context, uri);
    if (run) runInOutputChannel(run.cliPath, ["check", run.file], run.cwd, `Check: ${run.name}`);
}

/** Compile a Varn file (vn build). */
function runBuild(context: vscode.ExtensionContext, uri: TargetUri): void {
    const run = prepare(context, uri);
    if (run) runInOutputChannel(run.cliPath, ["build", run.file], run.cwd, `Build: ${run.name}`);
}

/** Inspect specific debug phases (vn debug -p <phases>). */
function runWithDebugPhase(context: vscode.ExtensionContext, uri: TargetUri, phases: string[], label: string): void {
    const run = prepare(context, uri);
    if (!run) return;
    runInOutputChannel(run.cliPath, ["debug", run.file, "-p", phases.join(",")], run.cwd, `${label}: ${run.name}`);
}

/** Show the bytecode disassembly of a file (vn debug -p bytecode). */
function runBytecode(context: vscode.ExtensionContext, uri: TargetUri): void {
    runWithDebugPhase(context, uri, ["bytecode"], "Bytecode");
}

/** Benchmark a Varn file (vn bench). */
function runBench(context: vscode.ExtensionContext, uri: TargetUri): void {
    const run = prepare(context, uri);
    if (run) runInOutputChannel(run.cliPath, ["bench", run.file], run.cwd, `Bench: ${run.name}`);
}

/** Prompt for debug phases and run the debug tool. */
async function runWithPhases(context: vscode.ExtensionContext, uri: TargetUri): Promise<void> {
    if (!resolveTargetFile(toUri(uri))) return;

    const selected = await vscode.window.showQuickPick(DEBUG_PHASES, {
        canPickMany: true,
        placeHolder: "Select debug phases to enable",
    });
    if (selected && selected.length > 0) runWithDebugPhase(context, uri, selected, "Debug");
}

async function openInViewer(uri: TargetUri, viewType: string): Promise<void> {
    const file = resolveTargetFile(toUri(uri));
    if (!file) return;
    const fileUri = toUri(uri) ?? vscode.Uri.file(file);
    await vscode.commands.executeCommand("vscode.openWith", fileUri, viewType, {
        viewColumn: vscode.ViewColumn.Beside,
        preview: true,
    });
}

/** Open the live synchronized Bytecode viewer beside the current editor. */
async function openBytecodeViewer(_context: vscode.ExtensionContext, uri: TargetUri): Promise<void> {
    await openInViewer(uri, "varn.bytecode");
}

/** Open the live synchronized SSA / HIR viewer beside the current editor. */
async function openSSAViewer(_context: vscode.ExtensionContext, uri: TargetUri): Promise<void> {
    await openInViewer(uri, "varn.ssa");
}

async function diffBytecode(_context: vscode.ExtensionContext, uri: TargetUri): Promise<void> {
    const file = resolveTargetFile(toUri(uri));
    if (!file) return;
    const fileUri = toUri(uri) ?? vscode.Uri.file(file);
    const name = path.basename(file);
    const virtualUri = vscode.Uri.parse(`varn-bytecode:${name}.varn-bc?${encodeURIComponent(fileUri.toString())}`);
    await vscode.commands.executeCommand("vscode.diff", fileUri, virtualUri, `Diff ${name} ↔ Bytecode`);
}

/**
 * Run the tests of a file (vn test). The CLI selects test files, not test
 * functions, so a test name only labels the output.
 */
function runTest(context: vscode.ExtensionContext, uri: TargetUri, testName?: string): void {
    const run = prepare(context, uri);
    if (!run) return;
    const label = testName ? `${testName} (whole file)` : run.name;
    runInOutputChannel(run.cliPath, ["test", run.file], run.cwd, `Test ${label}`);
}

/**
 * Benchmark a file (vn bench). The CLI benchmarks whole files, so a benchmark
 * name only labels the output.
 */
function runBenchmark(context: vscode.ExtensionContext, uri: TargetUri, benchName?: string): void {
    const run = prepare(context, uri);
    if (!run) return;
    const label = benchName ? `${benchName} (whole file)` : run.name;
    runInOutputChannel(run.cliPath, ["bench", run.file], run.cwd, `Benchmark ${label}`);
}

/** Toggle the build mode between debug and release. */
async function toggleBuildMode(): Promise<void> {
    const cfg = vscode.workspace.getConfiguration("Varn");
    const next = cfg.get<string>("buildMode", "release") === "release" ? "debug" : "release";
    await cfg.update("buildMode", next, vscode.ConfigurationTarget.Global);
    updateBuildModeStatusBar();
    void vscode.window.showInformationMessage(`Varn build mode switched to: ${next.toUpperCase()}`);
}

/** Open the graphical CFG and interactive debug inspector. */
function openVisualInspector(context: vscode.ExtensionContext, uri: TargetUri): void {
    const file = resolveTargetFile(toUri(uri));
    const fileUri = file ? vscode.Uri.file(file) : vscode.window.activeTextEditor?.document.uri;
    VarnVisualInspectorPanel.createOrShow(context.extensionUri, fileUri);
}

export {
    runVarnFile,
    runCheck,
    runBuild,
    runWithDebugPhase,
    runBytecode,
    runBench,
    runWithPhases,
    toggleBuildMode,
    openBytecodeViewer,
    openSSAViewer,
    diffBytecode,
    openVisualInspector,
    runTest,
    runBenchmark,
};
