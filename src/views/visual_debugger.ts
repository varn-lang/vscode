import * as vscode from "vscode";
import * as fs from "node:fs";
import { randomBytes } from "node:crypto";
import { getClient } from "../client.js";

type InspectorMessage = { command: "goToLine"; line?: number } | { command: "refresh" };

export class VnVisualInspectorPanel {
    static currentPanel: VnVisualInspectorPanel | undefined;
    static readonly viewType = "vnVisualInspector";

    private documentUri: vscode.Uri | undefined;
    private readonly disposables: vscode.Disposable[] = [];
    private refreshTimer: ReturnType<typeof setTimeout> | undefined;

    static createOrShow(extensionUri: vscode.Uri, documentUri?: vscode.Uri): void {
        const column = vscode.window.activeTextEditor ? vscode.ViewColumn.Beside : vscode.ViewColumn.One;

        const current = VnVisualInspectorPanel.currentPanel;
        if (current) {
            current.panel.reveal(column);
            if (documentUri) {
                current.documentUri = documentUri;
                current.scheduleRefresh();
            }
            return;
        }

        const panel = vscode.window.createWebviewPanel(
            VnVisualInspectorPanel.viewType,
            "Varn Visual CFG & Debug Inspector",
            column,
            { enableScripts: true, retainContextWhenHidden: false, localResourceRoots: [extensionUri] },
        );

        VnVisualInspectorPanel.currentPanel = new VnVisualInspectorPanel(panel, extensionUri, documentUri);
    }

    constructor(
        private readonly panel: vscode.WebviewPanel,
        private readonly extensionUri: vscode.Uri,
        documentUri?: vscode.Uri,
    ) {
        this.documentUri = documentUri ?? vscode.window.activeTextEditor?.document.uri;

        this.panel.webview.html = this.getHtmlForWebview();
        setTimeout(() => void this.refresh(), 300);

        this.panel.onDidDispose(() => this.dispose(), null, this.disposables);

        this.panel.webview.onDidReceiveMessage(
            async (message: InspectorMessage) => {
                switch (message.command) {
                    case "goToLine":
                        if (message.line && this.documentUri) await this.revealLine(this.documentUri, message.line);
                        return;
                    case "refresh":
                        void this.refresh();
                        return;
                }
            },
            null,
            this.disposables,
        );

        vscode.workspace.onDidSaveTextDocument(
            (doc) => {
                if (this.documentUri && doc.uri.toString() === this.documentUri.toString()) this.scheduleRefresh();
            },
            null,
            this.disposables,
        );

        vscode.workspace.onDidChangeTextDocument(
            (event) => {
                if (this.documentUri && event.document.uri.toString() === this.documentUri.toString()) {
                    this.scheduleRefresh();
                }
            },
            null,
            this.disposables,
        );
    }

    private async revealLine(uri: vscode.Uri, oneBasedLine: number): Promise<void> {
        try {
            const doc = await vscode.workspace.openTextDocument(uri);
            const editor = await vscode.window.showTextDocument(doc, {
                viewColumn: vscode.ViewColumn.One,
                preserveFocus: true,
            });
            const pos = new vscode.Position(Math.max(0, oneBasedLine - 1), 0);
            editor.selection = new vscode.Selection(pos, pos);
            editor.revealRange(new vscode.Range(pos, pos), vscode.TextEditorRevealType.InCenter);
        } catch (err) {
            console.error("Failed to jump to line:", err);
        }
    }

    scheduleRefresh(): void {
        if (this.refreshTimer) clearTimeout(this.refreshTimer);
        this.refreshTimer = setTimeout(() => void this.refresh(), 500);
    }

    async refresh(): Promise<void> {
        if (!this.documentUri) return;
        const client = getClient();
        if (!client) return;

        try {
            const data: unknown = await client.sendRequest("workspace/executeCommand", {
                command: "vn.getCFG",
                arguments: [this.documentUri.toString()],
            });
            if (data) void this.panel.webview.postMessage({ type: "updateData", data });
        } catch (err) {
            console.error("Error refreshing CFG data:", err);
        }
    }

    dispose(): void {
        VnVisualInspectorPanel.currentPanel = undefined;
        if (this.refreshTimer) clearTimeout(this.refreshTimer);
        this.panel.dispose();
        while (this.disposables.length) this.disposables.pop()?.dispose();
    }

    private getHtmlForWebview(): string {
        const webview = this.panel.webview;
        const media = (name: string): vscode.Uri => vscode.Uri.joinPath(this.extensionUri, "media", "inspector", name);
        const template = fs.readFileSync(media("index.html").fsPath, "utf8");
        const nonce = randomBytes(16).toString("base64");
        return template
            .replaceAll("{{nonce}}", nonce)
            .replaceAll("{{cspSource}}", webview.cspSource)
            .replace("{{styleUri}}", webview.asWebviewUri(media("inspector.css")).toString())
            .replace("{{scriptUri}}", webview.asWebviewUri(media("inspector.js")).toString());
    }
}

export function registerVisualInspectorSerializer(extensionUri: vscode.Uri): vscode.Disposable {
    try {
        return vscode.window.registerWebviewPanelSerializer(VnVisualInspectorPanel.viewType, {
            async deserializeWebviewPanel(panel: vscode.WebviewPanel): Promise<void> {
                VnVisualInspectorPanel.currentPanel = new VnVisualInspectorPanel(
                    panel,
                    extensionUri,
                    vscode.window.activeTextEditor?.document.uri,
                );
            },
        });
    } catch {
        return new vscode.Disposable(() => {});
    }
}
