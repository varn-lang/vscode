import * as vscode from "vscode";
import { setLanguageState, refreshLanguageStatus } from "./language.js";

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

export function initStatusBar(context) {
    lspStatusBar = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 20);
    lspStatusBar.command = "Varn.restartServer";
    setLspStatus("starting");
    lspStatusBar.show();

    context.subscriptions.push(lspStatusBar);
}

/**
 * @param {"starting"|"running"|"stopped"|"error"} state
 */
export function setLspStatus(state) {
    currentLspState = state;
    if (statusProvider) {
        statusProvider.refresh();
    }
    try {
        setLanguageState(state);
    } catch {}
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

export function updateBuildModeStatusBar() {
    if (statusProvider) {
        statusProvider.refresh();
    }
    try {
        refreshLanguageStatus();
    } catch {}
    if (!buildModeStatusBar) return;
    const mode = vscode.workspace.getConfiguration("Varn").get("buildMode", "release");
    if (mode === "release") {
        buildModeStatusBar.text = "$(zap) Release";
        buildModeStatusBar.tooltip = "Build Mode: Release (click to toggle to Debug)";
    } else {
        buildModeStatusBar.text = "$(beaker) Debug";
        buildModeStatusBar.tooltip = "Build Mode: Debug (click to toggle to Release)";
    }
}

export function getLspStatus() {
    return currentLspState;
}

export function setStatusProvider(provider) {
    statusProvider = provider;
}

export function disposeStatusBar() {
    if (lspStatusBar) {
        lspStatusBar.dispose();
        lspStatusBar = undefined;
    }
    runStatusBar = undefined;
    buildModeStatusBar = undefined;
    actionsHubBar = undefined;
    statusProvider = null;
}
