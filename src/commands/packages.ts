import * as vscode from "vscode";
import { runInOutputChannel, resolveCliPath } from "./base.js";
import { BINARY_NOT_FOUND } from "../binary.js";

function getWorkspaceDir(context: vscode.ExtensionContext): string {
    return vscode.workspace.workspaceFolders?.[0]?.uri.fsPath ?? context.extensionPath;
}

function requireCli(context: vscode.ExtensionContext): string | undefined {
    const cliPath = resolveCliPath(context);
    if (!cliPath) void vscode.window.showErrorMessage(BINARY_NOT_FOUND);
    return cliPath;
}

/** Install project dependencies (vn pkg install). */
function runPkgInstall(context: vscode.ExtensionContext): void {
    const cliPath = requireCli(context);
    if (!cliPath) return;
    runInOutputChannel(cliPath, ["pkg", "install"], getWorkspaceDir(context), "Pkg: Install Dependencies");
}

/** Update project dependencies (vn pkg update). */
function runPkgUpdate(context: vscode.ExtensionContext): void {
    const cliPath = requireCli(context);
    if (!cliPath) return;
    runInOutputChannel(cliPath, ["pkg", "update"], getWorkspaceDir(context), "Pkg: Update Dependencies");
}

/** Add a dependency to the project (vn pkg add <alias> <origin>). */
async function runPkgAdd(context: vscode.ExtensionContext): Promise<void> {
    const cliPath = requireCli(context);
    if (!cliPath) return;

    const alias = await vscode.window.showInputBox({
        prompt: "Enter the dependency alias (e.g., math)",
        placeHolder: "alias",
    });
    if (!alias) return;

    const origin = await vscode.window.showInputBox({
        prompt: "Enter the dependency origin (Git URL or local path)",
        placeHolder: "https://github.com/username/repo or /path/to/folder",
    });
    if (!origin) return;

    runInOutputChannel(cliPath, ["pkg", "add", alias, origin], getWorkspaceDir(context), `Pkg: Add ${alias}`);
}

/** Remove a dependency from the project (vn pkg remove <alias>). */
async function runPkgRemove(context: vscode.ExtensionContext): Promise<void> {
    const cliPath = requireCli(context);
    if (!cliPath) return;

    const alias = await vscode.window.showInputBox({
        prompt: "Enter the dependency alias to remove",
        placeHolder: "alias",
    });
    if (!alias) return;

    runInOutputChannel(cliPath, ["pkg", "remove", alias], getWorkspaceDir(context), `Pkg: Remove ${alias}`);
}

export { runPkgInstall, runPkgUpdate, runPkgAdd, runPkgRemove };
