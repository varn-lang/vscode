import * as vscode from "vscode";
import { getClient } from "../client.js";
import { errorMessage } from "../utils.js";

type InspectMessage = { command: "refresh" } | { command: "copy"; text?: string };

class VnInspectEditor implements vscode.CustomReadonlyEditorProvider {
    private readonly timers = new Map<string, ReturnType<typeof setTimeout>>();

    constructor(
        private readonly command: string,
        private readonly title: string,
    ) {}

    openCustomDocument(uri: vscode.Uri): vscode.CustomDocument {
        return { uri, dispose() {} };
    }

    async resolveCustomEditor(document: vscode.CustomDocument, webviewPanel: vscode.WebviewPanel): Promise<void> {
        webviewPanel.webview.options = { enableScripts: true };
        const key = document.uri.toString();

        const update = async (): Promise<void> => {
            webviewPanel.webview.html = this.render("Loading…", "");
            const text = await this.fetch(document.uri);
            webviewPanel.webview.html = this.render(text, key);
        };
        const schedule = (): void => {
            const existing = this.timers.get(key);
            if (existing) clearTimeout(existing);
            this.timers.set(key, setTimeout(() => void update(), 500));
        };

        const onSave = vscode.workspace.onDidSaveTextDocument((doc) => {
            if (doc.uri.toString() === key) schedule();
        });
        const onChange = vscode.workspace.onDidChangeTextDocument((event) => {
            if (event.document.uri.toString() === key) schedule();
        });
        webviewPanel.onDidDispose(() => {
            onSave.dispose();
            onChange.dispose();
        });
        webviewPanel.webview.onDidReceiveMessage(async (message: InspectMessage) => {
            if (message.command === "refresh") await update();
            if (message.command === "copy") await vscode.env.clipboard.writeText(message.text ?? "");
        });
        await update();
    }

    private async fetch(uri: vscode.Uri): Promise<string> {
        const client = getClient();
        if (!client) return "// Varn Language Server not running.";
        try {
            const res: unknown = await client.sendRequest("workspace/executeCommand", {
                command: this.command,
                arguments: [uri.toString()],
            });
            return typeof res === "string" ? res : JSON.stringify(res, null, 2);
        } catch (err) {
            return `// Error: ${errorMessage(err)}`;
        }
    }

    private render(text: string, source: string): string {
        const nonce = Date.now().toString(36) + Math.random().toString(36).slice(2);
        const escaped = text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
        return `<!DOCTYPE html><html><head><meta charset="UTF-8"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; script-src 'nonce-${nonce}';"><style>body{font-family:var(--vscode-editor-font-family,monospace);font-size:12px;white-space:pre;padding:12px}button{position:sticky;top:0}</style></head><body><button id="copy">Copy</button><button id="refresh">Refresh</button><div>${escaped}</div><div style="opacity:.6;margin-top:8px">${source} · ${this.title}</div><script nonce="${nonce}">const v=acquireVsCodeApi();let t=document.body.innerText;document.getElementById("copy").onclick=()=>v.postMessage({command:"copy",text:t});document.getElementById("refresh").onclick=()=>v.postMessage({command:"refresh"});<\/script></body></html>`;
    }
}

export function registerInspectEditors(_context: vscode.ExtensionContext): vscode.Disposable {
    const options = { webviewOptions: { retainContextWhenHidden: false }, supportsMultipleEditorsPerDocument: true };
    return vscode.Disposable.from(
        vscode.window.registerCustomEditorProvider("vn.bytecode", new VnInspectEditor("vn.showBytecode", "Bytecode"), options),
        vscode.window.registerCustomEditorProvider("vn.ssa", new VnInspectEditor("vn.showSSA", "SSA"), options),
    );
}
