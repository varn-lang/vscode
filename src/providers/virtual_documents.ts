import * as vscode from "vscode";
import { getClient } from "../client.js";
import { errorMessage } from "../utils.js";

const VIRTUAL_SCHEMES = ["vn-bytecode", "vn-ssa"];

export class VarnVirtualDocumentProvider implements vscode.TextDocumentContentProvider {
    private readonly changed = new vscode.EventEmitter<vscode.Uri>();
    readonly onDidChange = this.changed.event;
    private readonly pending = new Map<string, ReturnType<typeof setTimeout>>();

    refresh(uri: vscode.Uri | undefined): void {
        if (uri) this.changed.fire(uri);
    }

    refreshAll(): void {
        for (const doc of vscode.workspace.textDocuments) {
            if (!VIRTUAL_SCHEMES.includes(doc.uri.scheme)) continue;
            const key = doc.uri.toString();
            if (this.pending.has(key)) continue;
            const timer = setTimeout(() => {
                this.pending.delete(key);
                this.changed.fire(doc.uri);
            }, 300);
            this.pending.set(key, timer);
        }
    }

    async provideTextDocumentContent(uri: vscode.Uri): Promise<string> {
        const client = getClient();
        if (!client) return "// Varn Language Server is not running.";

        const sourceUri = uri.query || uri.path;
        if (!sourceUri) return "// No source file specified.";

        const isSSA = uri.scheme === "vn-ssa";
        const command = isSSA ? "vn.showSSA" : "vn.showBytecode";

        try {
            const res: unknown = await client.sendRequest("workspace/executeCommand", {
                command,
                arguments: [sourceUri],
            });
            return typeof res === "string" ? res : JSON.stringify(res, null, 2) || "// No output available.";
        } catch (err) {
            return `// Error generating ${isSSA ? "SSA" : "Bytecode"}:\n// ${errorMessage(err)}`;
        }
    }
}

export function registerVirtualDocumentProviders(): vscode.Disposable {
    const provider = new VarnVirtualDocumentProvider();
    let saveTimer: ReturnType<typeof setTimeout> | undefined;

    return vscode.Disposable.from(
        vscode.workspace.registerTextDocumentContentProvider("vn-bytecode", provider),
        vscode.workspace.registerTextDocumentContentProvider("vn-ssa", provider),
        vscode.workspace.onDidSaveTextDocument((doc) => {
            if (doc.fileName.endsWith(".vn")) provider.refreshAll();
        }),
        vscode.workspace.onDidChangeTextDocument((event) => {
            if (!event.document.fileName.endsWith(".vn")) return;
            if (saveTimer) clearTimeout(saveTimer);
            saveTimer = setTimeout(() => provider.refreshAll(), 500);
        }),
    );
}
