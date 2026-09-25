"use strict";

const vscode = require("vscode");
const { getClient } = require("../client");

class VarnVirtualDocumentProvider {
    constructor() {
        this._onDidChange = new vscode.EventEmitter();
        this.onDidChange = this._onDidChange.event;
    }

    refresh(uri) {
        if (uri) {
            this._onDidChange.fire(uri);
        }
    }

    refreshAll() {
        for (const doc of vscode.workspace.textDocuments) {
            if (doc.uri.scheme === "varn-bytecode" || doc.uri.scheme === "varn-ssa") {
                this._onDidChange.fire(doc.uri);
            }
        }
    }

    async provideTextDocumentContent(uri) {
        const client = getClient();
        if (!client) {
            return "// Varn Language Server is not running.";
        }

        const sourceUriStr = uri.query || uri.path;
        if (!sourceUriStr) {
            return "// No source file specified.";
        }

        const isSSA = uri.scheme === "varn-ssa";
        const command = isSSA ? "varn.showSSA" : "varn.showBytecode";

        try {
            const res = await client.sendRequest("workspace/executeCommand", {
                command,
                arguments: [sourceUriStr]
            });
            return typeof res === "string" ? res : (JSON.stringify(res, null, 2) || "// No output available.");
        } catch (err) {
            return `// Error generating ${isSSA ? "SSA" : "Bytecode"}:\n// ${err?.message || err}`;
        }
    }
}

function registerVirtualDocumentProviders() {
    const provider = new VarnVirtualDocumentProvider();

    return vscode.Disposable.from(
        vscode.workspace.registerTextDocumentContentProvider("varn-bytecode", provider),
        vscode.workspace.registerTextDocumentContentProvider("varn-ssa", provider),
        vscode.workspace.onDidSaveTextDocument((doc) => {
            if (doc.fileName.endsWith(".vn")) {
                provider.refreshAll();
            }
        }),
        vscode.workspace.onDidChangeTextDocument((e) => {
            if (e.document.fileName.endsWith(".vn")) {
                provider.refreshAll();
            }
        })
    );
}

module.exports = {
    VarnVirtualDocumentProvider,
    registerVirtualDocumentProviders
};
