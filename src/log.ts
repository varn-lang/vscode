import * as vscode from "vscode";

let channel: vscode.LogOutputChannel | undefined;

/** The extension's own log: levels, timestamps and the standard "Set Log Level" picker. */
export function log(): vscode.LogOutputChannel {
    channel ??= vscode.window.createOutputChannel("Varn", { log: true });
    return channel;
}
