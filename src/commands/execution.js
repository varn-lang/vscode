"use strict";

const vscode = require("vscode");
const path = require("path");
const { resolveTargetFile, runInOutputChannel, resolveCliPath, formatTerminalCommand } = require("./base");
const { updateBuildModeStatusBar } = require("../status");

/**
 * Run a Varn file (via vn run).
 * @param {vscode.ExtensionContext} context
 * @param {vscode.Uri | undefined} uri
 * @param {{ terminal: boolean, verbose?: boolean }} opts
 */
function runVarnFile(context, uri, opts) {
    const file = resolveTargetFile(uri);
    if (!file) return;

    const cliPath = resolveCliPath(context);
    if (!cliPath) {
        vscode.window.showErrorMessage(
            "Varn binary not found. Build with `cargo build --release --bin vn` or set Varn.cli.path."
        );
        return;
    }

    const cfg = vscode.workspace.getConfiguration("Varn");
    const verbose = opts.verbose ?? cfg.get("run.verbose") ?? false;

    const args = ["run", file];
    if (verbose) {
        args.push("--verbose");
    }

    if (opts.terminal) {
        const t = vscode.window.createTerminal({
            name: `Varn Run: ${path.basename(file)}`,
            cwd: path.dirname(file),
        });
        t.show(true);
        t.sendText(formatTerminalCommand(cliPath, args));
    } else {
        runInOutputChannel(cliPath, args, path.dirname(file), `Run: ${path.basename(file)}`);
    }
}

/**
 * Check types in a Varn file (via vn check).
 * @param {vscode.ExtensionContext} context
 * @param {vscode.Uri | undefined} uri
 */
function runCheck(context, uri) {
    const file = resolveTargetFile(uri);
    if (!file) return;

    const cliPath = resolveCliPath(context);
    if (!cliPath) {
        vscode.window.showErrorMessage("Varn binary not found.");
        return;
    }

    runInOutputChannel(cliPath, ["check", file], path.dirname(file), `Check: ${path.basename(file)}`);
}

/**
 * Compile/Build a Varn file (via vn build).
 * @param {vscode.ExtensionContext} context
 * @param {vscode.Uri | undefined} uri
 */
function runBuild(context, uri) {
    const file = resolveTargetFile(uri);
    if (!file) return;

    const cliPath = resolveCliPath(context);
    if (!cliPath) {
        vscode.window.showErrorMessage("Varn binary not found.");
        return;
    }

    runInOutputChannel(cliPath, ["build", file], path.dirname(file), `Build: ${path.basename(file)}`);
}

/**
 * Inspect specific debug phase(s) (via vn debug -p <phases>).
 * @param {vscode.ExtensionContext} context
 * @param {vscode.Uri | undefined} uri
 * @param {string[]} phases
 * @param {string} label
 */
function runWithDebugPhase(context, uri, phases, label) {
    const file = resolveTargetFile(uri);
    if (!file) return;

    const cliPath = resolveCliPath(context);
    if (!cliPath) {
        vscode.window.showErrorMessage("Varn binary not found.");
        return;
    }

    const args = ["debug", file, "-p", phases.join(",")];
    runInOutputChannel(cliPath, args, path.dirname(file), `${label}: ${path.basename(file)}`);
}

/**
 * Show bytecode disassembly of a file (via vn debug -p bytecode).
 * @param {vscode.ExtensionContext} context
 * @param {vscode.Uri | undefined} uri
 */
function runBytecode(context, uri) {
    runWithDebugPhase(context, uri, ["bytecode"], "Bytecode");
}

/**
 * Benchmark a Varn file (via vn bench).
 * @param {vscode.ExtensionContext} context
 * @param {vscode.Uri | undefined} uri
 */
function runBench(context, uri) {
    const file = resolveTargetFile(uri);
    if (!file) return;

    const cliPath = resolveCliPath(context);
    if (!cliPath) {
        vscode.window.showErrorMessage("Varn binary not found.");
        return;
    }

    runInOutputChannel(cliPath, ["bench", file], path.dirname(file), `Bench: ${path.basename(file)}`);
}

/**
 * Prompt user for debug phases and run debug tool.
 * @param {vscode.ExtensionContext} context
 * @param {vscode.Uri | undefined} uri
 */
async function runWithPhases(context, uri) {
    const file = resolveTargetFile(uri);
    if (!file) return;

    const phases = [
        "tokens", "ast", "bytecode", "symbols", "binds", 
        "modules", "types", "expr", "errors", "trace", 
        "calls", "consts", "scope", "graph"
    ];

    const selected = await vscode.window.showQuickPick(phases, {
        canPickMany: true,
        placeHolder: "Select debug phases to enable"
    });

    if (selected && selected.length > 0) {
        runWithDebugPhase(context, uri, selected, "Debug");
    }
}

/**
 * Open live synchronized Bytecode Viewer beside current editor.
 * @param {vscode.ExtensionContext} _context
 * @param {vscode.Uri | string | undefined} uri
 */
async function openBytecodeViewer(_context, uri) {
    const file = resolveTargetFile(uri);
    if (!file) return;

    const fileUri = typeof uri === "string" ? uri : (uri ? uri.toString() : vscode.Uri.file(file).toString());
    const virtualUri = vscode.Uri.parse(`varn-bytecode:${path.basename(file)}.varn-bc?${encodeURIComponent(fileUri)}`);
    const doc = await vscode.workspace.openTextDocument(virtualUri);
    await vscode.window.showTextDocument(doc, {
        viewColumn: vscode.ViewColumn.Beside,
        preview: true,
        preserveFocus: true
    });
}

/**
 * Open live synchronized SSA / HIR Viewer beside current editor.
 * @param {vscode.ExtensionContext} _context
 * @param {vscode.Uri | string | undefined} uri
 */
async function openSSAViewer(_context, uri) {
    const file = resolveTargetFile(uri);
    if (!file) return;

    const fileUri = typeof uri === "string" ? uri : (uri ? uri.toString() : vscode.Uri.file(file).toString());
    const virtualUri = vscode.Uri.parse(`varn-ssa:${path.basename(file)}.varn-ssa?${encodeURIComponent(fileUri)}`);
    const doc = await vscode.workspace.openTextDocument(virtualUri);
    await vscode.window.showTextDocument(doc, {
        viewColumn: vscode.ViewColumn.Beside,
        preview: true,
        preserveFocus: true
    });
}

/**
 * Run a specific test function (via vn test or vn run).
 * @param {vscode.ExtensionContext} context
 * @param {vscode.Uri | string | undefined} uri
 * @param {string} [testName]
 */
function runTest(context, uri, testName) {
    const file = resolveTargetFile(uri);
    if (!file) return;

    const cliPath = resolveCliPath(context);
    if (!cliPath) {
        vscode.window.showErrorMessage("Varn binary not found.");
        return;
    }

    const args = ["test", file];
    if (testName) {
        args.push("--filter", testName);
    }

    runInOutputChannel(cliPath, args, path.dirname(file), `Test ${testName || path.basename(file)}`);
}

/**
 * Run benchmark on a file or specific bench function.
 * @param {vscode.ExtensionContext} context
 * @param {vscode.Uri | string | undefined} uri
 * @param {string} [benchName]
 */
function runBenchmark(context, uri, benchName) {
    const file = resolveTargetFile(uri);
    if (!file) return;

    const cliPath = resolveCliPath(context);
    if (!cliPath) {
        vscode.window.showErrorMessage("Varn binary not found.");
        return;
    }

    const args = ["bench", file];
    if (benchName) {
        args.push("--filter", benchName);
    }

    runInOutputChannel(cliPath, args, path.dirname(file), `Benchmark ${benchName || path.basename(file)}`);
}

/**
 * Toggle build mode between debug and release.
 */
async function toggleBuildMode() {
    const cfg = vscode.workspace.getConfiguration("Varn");
    const current = cfg.get("buildMode", "debug");
    const next = current === "release" ? "debug" : "release";
    await cfg.update("buildMode", next, vscode.ConfigurationTarget.Global);
    updateBuildModeStatusBar();
    vscode.window.showInformationMessage(`Varn build mode switched to: ${next.toUpperCase()}`);
}

/**
 * Open Graphical CFG & Interactive Debug Inspector.
 * @param {vscode.ExtensionContext} context
 * @param {vscode.Uri | string | undefined} uri
 */
function openVisualInspector(context, uri) {
    const { VarnVisualInspectorPanel } = require("../views/visual_debugger");
    const file = resolveTargetFile(uri);
    const fileUri = file ? vscode.Uri.file(file) : vscode.window.activeTextEditor?.document.uri;
    VarnVisualInspectorPanel.createOrShow(context.extensionUri, fileUri);
}

module.exports = {
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
    openVisualInspector,
    runTest,
    runBenchmark
};

