import * as vscode from "vscode";
import * as path from "node:path";
import * as fs from "node:fs";
import { runInOutputChannel, resolveCliPath, formatTerminalCommand } from "./base.js";

function getWorkspaceDir(context: vscode.ExtensionContext): string {
    return vscode.workspace.workspaceFolders?.[0]?.uri.fsPath ?? context.extensionPath;
}

function requireCli(context: vscode.ExtensionContext): string | undefined {
    const cliPath = resolveCliPath(context);
    if (!cliPath) void vscode.window.showErrorMessage("Varn binary not found.");
    return cliPath;
}

/** Start the interactive REPL in a VS Code terminal (vn repl). */
function runRepl(context: vscode.ExtensionContext): void {
    const cliPath = requireCli(context);
    if (!cliPath) return;

    const terminal = vscode.window.createTerminal({ name: "Varn REPL", cwd: getWorkspaceDir(context) });
    terminal.show(true);
    terminal.sendText(formatTerminalCommand(cliPath, ["repl"]));
}

/** Run diagnostic checks (vn doctor). */
function runDoctor(context: vscode.ExtensionContext): void {
    const cliPath = requireCli(context);
    if (!cliPath) return;
    runInOutputChannel(cliPath, ["doctor"], getWorkspaceDir(context), "Varn Doctor");
}

/** Clean the compiler build cache (vn cache clean). */
function runCacheClean(context: vscode.ExtensionContext): void {
    const cliPath = requireCli(context);
    if (!cliPath) return;
    runInOutputChannel(cliPath, ["cache", "clean"], getWorkspaceDir(context), "Cache: Clean Cache");
}

/** Initialize a new Varn project (vn init [dir] [--name name]). */
async function runInitProject(context: vscode.ExtensionContext): Promise<void> {
    const cliPath = requireCli(context);
    if (!cliPath) return;

    const dir = await vscode.window.showInputBox({
        prompt: "Directory for the new project (leave empty for current workspace root)",
        placeHolder: "my-project",
    });

    const name = await vscode.window.showInputBox({
        prompt: "Project name (optional, leave empty to use directory name)",
        placeHolder: "my-project",
    });

    const args = ["init"];
    if (dir?.trim()) args.push(dir.trim());
    if (name?.trim()) args.push("--name", name.trim());

    runInOutputChannel(cliPath, args, getWorkspaceDir(context), "Init: New Project");
}

/** Run the installer script to download the latest Varn runtime. */
function runInstaller(context: vscode.ExtensionContext): void {
    const root = path.resolve(context.extensionPath, "..");
    const isWin = process.platform === "win32";
    const script = path.join(root, "scripts", isWin ? "install.ps1" : "install.sh");

    if (!fs.existsSync(script)) {
        void vscode.window.showErrorMessage(`Varn installer script not found: ${script}`);
        return;
    }

    const terminal = vscode.window.createTerminal({ name: "Varn Install Runtime", cwd: root });
    terminal.show(true);
    terminal.sendText(
        isWin ? `powershell -ExecutionPolicy Bypass -File "${script}"` : `chmod +x "${script}" && "${script}"`,
    );
}

export { runRepl, runDoctor, runCacheClean, runInitProject, runInstaller };
