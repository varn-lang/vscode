import * as vscode from "vscode";
import { getClient } from "../client.js";

class VarnInspectEditor {
    constructor(context, command, title) {
        this._context = context;
        this._command = command;
        this._title = title;
        this._timers = new Map();
    }
    async openCustomDocument(uri) {
        return { uri };
    }
    async resolveCustomEditor(document, webviewPanel) {
        webviewPanel.webview.options = { enableScripts: true };
        const update = async () => {
            webviewPanel.webview.html = this.render("Loading…", "");
            const text = await this.fetch(document.uri);
            webviewPanel.webview.html = this.render(text, document.uri.toString());
        };
        const schedule = () => {
            const key = document.uri.toString();
            if (this._timers.has(key)) clearTimeout(this._timers.get(key));
            this._timers.set(key, setTimeout(update, 500));
        };
        const sub1 = vscode.workspace.onDidSaveTextDocument((d) => {
            if (d.uri.toString() === document.uri.toString()) schedule();
        });
        const sub2 = vscode.workspace.onDidChangeTextDocument((e) => {
            if (e.document.uri.toString() === document.uri.toString()) schedule();
        });
        webviewPanel.onDidDispose(() => { sub1.dispose(); sub2.dispose(); });
        webviewPanel.webview.onDidReceiveMessage(async (msg) => {
            if (msg.command === "refresh") update();
            if (msg.command === "copy") await vscode.env.clipboard.writeText(msg.text || "");
        });
        await update();
    }
    async fetch(uri) {
        const client = getClient();
        if (!client) return "// Varn Language Server not running.";
        try {
            const res = await client.sendRequest("workspace/executeCommand", { command: this._command, arguments: [uri.toString()] });
            return typeof res === "string" ? res : JSON.stringify(res, null, 2);
        } catch (err) {
            return `// Error: ${err?.message || err}`;
        }
    }
    render(text, source) {
        const nonce = String(Date.now().toString(36) + Math.random().toString(36).slice(2));
        const esc = String(text).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
        return `<!DOCTYPE html><html><head><meta charset="UTF-8"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; script-src 'nonce-${nonce}';"><style>body{font-family:var(--vscode-editor-font-family,monospace);font-size:12px;white-space:pre;padding:12px}button{position:sticky;top:0}</style></head><body><button id="copy">Copy</button><button id="refresh">Refresh</button><div>${esc}</div><div style="opacity:.6;margin-top:8px">${source} · ${this._title}</div><script nonce="${nonce}">const v=acquireVsCodeApi();let t=document.body.innerText;document.getElementById("copy").onclick=()=>v.postMessage({command:"copy",text:t});document.getElementById("refresh").onclick=()=>v.postMessage({command:"refresh"});<\/script></body></html>`;
    }
}

function registerInspectEditors(context) {
    const bc = new VarnInspectEditor(context, "varn.showBytecode", "Bytecode");
    const ssa = new VarnInspectEditor(context, "varn.showSSA", "SSA");
    return vscode.Disposable.from(
        vscode.window.registerCustomEditorProvider("varn.bytecode", bc, { webviewOptions: { retainContextWhenHidden: false }, supportsMultipleEditorsPerDocument: true }),
        vscode.window.registerCustomEditorProvider("varn.ssa", ssa, { webviewOptions: { retainContextWhenHidden: false }, supportsMultipleEditorsPerDocument: true })
    );
}

export { registerInspectEditors };
