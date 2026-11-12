import * as vscode from "vscode";
import { setLanguageState, refreshLanguageStatus, type LspState } from "./language.js";

interface Refreshable {
    refresh(): void;
}

let lspStatusBar: vscode.StatusBarItem | undefined;

let currentLspState: LspState = "starting";
let statusProvider: Refreshable | null = null;

export function initStatusBar(context: vscode.ExtensionContext): void {
    lspStatusBar = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 20);
    lspStatusBar.command = "Varn.restartServer";
    setLspStatus("starting");
    lspStatusBar.show();

    context.subscriptions.push(lspStatusBar);
}

export function setLspStatus(state: LspState): void {
    currentLspState = state;
    statusProvider?.refresh();
    try {
        setLanguageState(state);
    } catch {
        // the language status item is created after the status bar
    }
    if (!lspStatusBar) return;
    switch (state) {
        case "starting":
            lspStatusBar.text = "$(loading~spin) Varn";
            lspStatusBar.tooltip = "Varn Language Server — Starting";
            lspStatusBar.backgroundColor = undefined;
            break;
        case "running":
            lspStatusBar.text = "$(check) Varn";
            lspStatusBar.tooltip = "Varn Language Server — Running  (click to restart)";
            lspStatusBar.backgroundColor = undefined;
            break;
        case "stopped":
            lspStatusBar.text = "$(circle-slash) Varn";
            lspStatusBar.tooltip = "Varn Language Server — Stopped  (click to restart)";
            lspStatusBar.backgroundColor = new vscode.ThemeColor("statusBarItem.warningBackground");
            break;
        case "error":
            lspStatusBar.text = "$(error) Varn";
            lspStatusBar.tooltip = "Varn Language Server — Binary not found";
            lspStatusBar.backgroundColor = new vscode.ThemeColor("statusBarItem.errorBackground");
            break;
    }
}

export function updateBuildModeStatusBar(): void {
    statusProvider?.refresh();
    try {
        refreshLanguageStatus();
    } catch {
        // the language status item is created after the status bar
    }
}

export function getLspStatus(): LspState {
    return currentLspState;
}

export function setStatusProvider(provider: Refreshable): void {
    statusProvider = provider;
}

export function disposeStatusBar(): void {
    lspStatusBar?.dispose();
    lspStatusBar = undefined;
    statusProvider = null;
}
