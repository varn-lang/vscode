"use strict";

const vscode = require("vscode");

/** @type {vscode.StatusBarItem | undefined} */
let lspStatusBar;
/** @type {vscode.StatusBarItem | undefined} */
let runStatusBar;
/** @type {vscode.StatusBarItem | undefined} */
let buildModeStatusBar;
/** @type {vscode.StatusBarItem | undefined} */
let actionsHubBar;

let currentLspState = "starting";
let statusProvider = null;

// ── QuickPick action hub ─────────────────────────────────────────────

/** @type {{ label: string, description: string, action: string }[]} */
const HUB_ITEMS = [
    { label: "$(play) Run File",             description: "Execute current .vn file",   action: "runFile" },
    { label: "$(terminal) Run in Terminal",  description: "Run in integrated terminal",  action: "runInTerminal" },
    { label: "$(checklist) Check File",      description: "Type-check current file",     action: "checkFile" },
    { label: "$(package) Build File",        description: "Compile current file",        action: "buildFile" },
    { label: "$(file-binary) Show Bytecode", description: "Disassemble to bytecode",     action: "showBytecode" },
    { label: "$(symbol-structure) Show AST", description: "Inspect abstract syntax tree", action: "showAst" },
    { label: "$(dashboard) Benchmark",       description: "Benchmark current file",      action: "benchFile" },
    { label: "$(debug-console) Debug Phases", description: "Run with custom debug phases", action: "debugPhases" },
    null,
    { label: "$(terminal) REPL",             description: "Start interactive Varn REPL", action: "repl" },
    { label: "$(pulse) Doctor",              description: "Check Varn installation",     action: "doctor" },
    { label: "$(clear-all) Clean Cache",     description: "Clear compiler cache",        action: "cacheClean" },
    { label: "$(new-folder) Init Project",   description: "Create new Varn project",     action: "initProject" },
    { label: "$(cloud-download) Install Runtime", description: "Download Varn runtime",  action: "installRuntime" },
    null,
    { label: "$(cloud-download) Pkg Install",      description: "Install dependencies",       action: "pkgInstall" },
    { label: "$(refresh) Pkg Update",              description: "Update dependencies",        action: "pkgUpdate" },
    { label: "$(add) Pkg Add",                     description: "Add a dependency",           action: "pkgAdd" },
    { label: "$(trash) Pkg Remove",                description: "Remove a dependency",        action: "pkgRemove" },
];

/**
 * Map action ID to import + call. Lazy-required to avoid circular deps
 * and keep the hub self-contained.
 * @param {string} actionId
 * @param {vscode.ExtensionContext} ctx
 */
function _execHubAction(actionId, ctx) {
    switch (actionId) {
        case "runFile":
            return require("./commands/execution").runVarnFile(ctx, undefined, { terminal: false });
        case "runInTerminal":
            return require("./commands/execution").runVarnFile(ctx, undefined, { terminal: true });
        case "checkFile":
            return require("./commands/execution").runCheck(ctx, undefined);
        case "buildFile":
            return require("./commands/execution").runBuild(ctx, undefined);
        case "showBytecode":
            return require("./commands/execution").runBytecode(ctx, undefined);
        case "showAst":
            return require("./commands/execution").runWithDebugPhase(ctx, undefined, ["ast"], "AST");
        case "benchFile":
            return require("./commands/execution").runBench(ctx, undefined);
        case "debugPhases":
            return require("./commands/execution").runWithPhases(ctx, undefined);
        case "repl":
            return require("./commands/utilities").runRepl(ctx);
        case "doctor":
            return require("./commands/utilities").runDoctor(ctx);
        case "cacheClean":
            return require("./commands/utilities").runCacheClean(ctx);
        case "initProject":
            return require("./commands/utilities").runInitProject(ctx);
        case "installRuntime":
            return require("./commands/utilities").runInstaller(ctx);
        case "pkgInstall":
            return require("./commands/packages").runPkgInstall(ctx);
        case "pkgUpdate":
            return require("./commands/packages").runPkgUpdate(ctx);
        case "pkgAdd":
            return require("./commands/packages").runPkgAdd(ctx);
        case "pkgRemove":
            return require("./commands/packages").runPkgRemove(ctx);
    }
}

function showActionsHub(ctx) {
    const picks = HUB_ITEMS.map((item) => {
        if (!item) return { label: "", kind: vscode.QuickPickItemKind.Separator };
        return {
            label: item.label,
            description: item.description,
            action: item.action,
        };
    });

    vscode.window.showQuickPick(picks, {
        placeHolder: "Varn actions — select an operation",
        matchOnDescription: true,
    }).then((selected) => {
        if (selected && selected.action) {
            _execHubAction(selected.action, ctx);
        }
    });
}

// ── Status bar items ─────────────────────────────────────────────────

function initStatusBar(context) {
    lspStatusBar = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 20);
    lspStatusBar.command = "Varn.restartServer";
    setLspStatus("starting");
    lspStatusBar.show();

    actionsHubBar = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 19);
    actionsHubBar.text = "$(symbol-menu) Actions";
    actionsHubBar.tooltip = "Varn quick actions";
    actionsHubBar.command = "Varn.showActionsHub";
    actionsHubBar.show();

    runStatusBar = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 18);
    runStatusBar.command = "Varn.runFile";
    runStatusBar.text = "$(play) Run";
    runStatusBar.tooltip = "Run current Varn file";
    runStatusBar.show();

    buildModeStatusBar = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 17);
    buildModeStatusBar.command = "Varn.toggleBuildMode";
    updateBuildModeStatusBar();
    buildModeStatusBar.show();

    context.subscriptions.push(lspStatusBar, actionsHubBar, runStatusBar, buildModeStatusBar);
}

/**
 * @param {"starting"|"running"|"stopped"|"error"} state
 */
function setLspStatus(state) {
    currentLspState = state;
    if (statusProvider) {
        statusProvider.refresh();
    }
    if (!lspStatusBar) return;
    switch (state) {
        case "starting":
            lspStatusBar.text    = "$(loading~spin) Varn";
            lspStatusBar.tooltip = "Varn Language Server — Starting";
            lspStatusBar.backgroundColor = undefined;
            break;
        case "running":
            lspStatusBar.text    = "$(check) Varn";
            lspStatusBar.tooltip = "Varn Language Server — Running  (click to restart)";
            lspStatusBar.backgroundColor = undefined;
            break;
        case "stopped":
            lspStatusBar.text    = "$(circle-slash) Varn";
            lspStatusBar.tooltip = "Varn Language Server — Stopped  (click to restart)";
            lspStatusBar.backgroundColor = new vscode.ThemeColor("statusBarItem.warningBackground");
            break;
        case "error":
            lspStatusBar.text    = "$(error) Varn";
            lspStatusBar.tooltip = "Varn Language Server — Binary not found";
            lspStatusBar.backgroundColor = new vscode.ThemeColor("statusBarItem.errorBackground");
            break;
    }
}

function updateBuildModeStatusBar() {
    if (statusProvider) {
        statusProvider.refresh();
    }
    if (!buildModeStatusBar) return;
    const mode = vscode.workspace.getConfiguration("Varn").get("buildMode", "debug");
    if (mode === "release") {
        buildModeStatusBar.text = "$(zap) Release";
        buildModeStatusBar.tooltip = "Build Mode: Release (click to toggle to Debug)";
    } else {
        buildModeStatusBar.text = "$(beaker) Debug";
        buildModeStatusBar.tooltip = "Build Mode: Debug (click to toggle to Release)";
    }
}

function getLspStatus() {
    return currentLspState;
}

function setStatusProvider(provider) {
    statusProvider = provider;
}

function disposeStatusBar() {
    if (lspStatusBar) {
        lspStatusBar.dispose();
        lspStatusBar = undefined;
    }
    if (runStatusBar) {
        runStatusBar.dispose();
        runStatusBar = undefined;
    }
    if (buildModeStatusBar) {
        buildModeStatusBar.dispose();
        buildModeStatusBar = undefined;
    }
    if (actionsHubBar) {
        actionsHubBar.dispose();
        actionsHubBar = undefined;
    }
    statusProvider = null;
}

module.exports = {
    initStatusBar,
    setLspStatus,
    updateBuildModeStatusBar,
    getLspStatus,
    setStatusProvider,
    disposeStatusBar,
    showActionsHub
};
