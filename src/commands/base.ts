import * as vscode from "vscode";
import * as path from "node:path";
import { spawn } from "node:child_process";
import { resolveCliPath } from "../binary.js";
import { stripAnsi } from "../utils.js";

let runChannel: vscode.OutputChannel | undefined;

/** Resolve the active .vn file path from a URI or the active editor. */
function resolveTargetFile(uri: vscode.Uri | undefined): string | undefined {
    let fsPath = uri?.fsPath ?? vscode.window.activeTextEditor?.document.fileName;
    if (!fsPath?.endsWith(".vn")) {
        const vnEditor = vscode.window.visibleTextEditors.find((e) => e.document.fileName.endsWith(".vn"));
        if (vnEditor) fsPath = vnEditor.document.fileName;
    }
    if (!fsPath?.endsWith(".vn")) {
        void vscode.window.showWarningMessage("No Varn file selected. Open a .vn file first.");
        return undefined;
    }
    return fsPath;
}

/** Run a process and stream its output to the shared Varn Output channel. */
function runInOutputChannel(bin: string, args: string[], cwd: string, label: string): void {
    runChannel ??= vscode.window.createOutputChannel("Varn Output");
    const channel = runChannel;
    channel.clear();
    channel.show(true);
    channel.appendLine(`▶  ${label}`);
    channel.appendLine(`  command: ${path.basename(bin)} ${args.join(" ")}`);
    channel.appendLine("─".repeat(64));

    const proc = spawn(bin, args, { cwd });

    proc.stdout.on("data", (chunk: Buffer) => channel.append(stripAnsi(chunk.toString())));
    proc.stderr.on("data", (chunk: Buffer) => channel.append(stripAnsi(chunk.toString())));
    proc.on("error", (err) => {
        channel.appendLine(`\nError: ${err.message}`);
    });
    proc.on("close", (code) => {
        channel.appendLine("─".repeat(64));
        channel.appendLine(`Exited with code ${code}`);
    });
}

/** Format a command string suitable for execution in the VS Code terminal. */
function formatTerminalCommand(cliPath: string, args: string[]): string {
    const quotedArgs = args.map((arg) => `"${arg}"`).join(" ");

    if (process.platform !== "win32") {
        return `"${cliPath}" ${quotedArgs}`;
    }

    const shell = (vscode.env.shell || "").toLowerCase();
    const isPowerShell = shell.includes("powershell") || shell.includes("pwsh") || !shell;
    return isPowerShell ? `& "${cliPath}" ${quotedArgs}` : `"${cliPath}" ${quotedArgs}`;
}

export { resolveTargetFile, runInOutputChannel, resolveCliPath, formatTerminalCommand };
