import * as vscode from "vscode";
import { spawn } from "node:child_process";
import { resolveCliPath } from "../binary.js";
import { stripAnsi } from "../utils.js";
import path from "node:path";

import { getClient } from "../client.js";

class AstNodeItem extends vscode.TreeItem {
    constructor(label, line, children, kind) {
        const hasChildren = children && children.length > 0;
        super(
            label,
            hasChildren
                ? vscode.TreeItemCollapsibleState.Collapsed
                : vscode.TreeItemCollapsibleState.None
        );
        this.children = children || [];
        this.line = line;

        // Set native icons based on kind or label category
        const cleanLabel = label.toLowerCase();
        const nodeKind = (kind || "").toLowerCase();

        if (nodeKind === "function" || cleanLabel.includes("functiondecl") || cleanLabel.startsWith("fn ")) {
            this.iconPath = new vscode.ThemeIcon("symbol-function");
        } else if (nodeKind === "variable" || cleanLabel.includes("variabledecl") || cleanLabel.startsWith("var ") || cleanLabel.startsWith("let ") || cleanLabel.startsWith("const ")) {
            this.iconPath = new vscode.ThemeIcon("symbol-variable");
        } else if (nodeKind === "class" || cleanLabel.includes("classdecl")) {
            this.iconPath = new vscode.ThemeIcon("symbol-class");
        } else if (nodeKind === "interface" || cleanLabel.includes("interfacedecl")) {
            this.iconPath = new vscode.ThemeIcon("symbol-interface");
        } else if (nodeKind === "enum" || cleanLabel.includes("enumdecl")) {
            this.iconPath = new vscode.ThemeIcon("symbol-enum");
        } else if (nodeKind === "enum_member" || cleanLabel.includes("variant ")) {
            this.iconPath = new vscode.ThemeIcon("symbol-enum-member");
        } else if (nodeKind === "struct" || cleanLabel.includes("structdecl")) {
            this.iconPath = new vscode.ThemeIcon("symbol-struct");
        } else if (nodeKind === "method" || cleanLabel.includes("method ")) {
            this.iconPath = new vscode.ThemeIcon("symbol-method");
        } else if (nodeKind === "property" || cleanLabel.includes("prop ") || cleanLabel.includes("field ")) {
            this.iconPath = new vscode.ThemeIcon("symbol-property");
        } else if (nodeKind === "parameter" || cleanLabel.startsWith("param:")) {
            this.iconPath = new vscode.ThemeIcon("symbol-parameter");
        } else if (nodeKind === "constant" || cleanLabel.includes("literal")) {
            this.iconPath = new vscode.ThemeIcon("symbol-constant");
        } else if (nodeKind === "operator") {
            this.iconPath = new vscode.ThemeIcon("symbol-operator");
        } else if (nodeKind === "import") {
            this.iconPath = new vscode.ThemeIcon("symbol-module");
        } else if (nodeKind === "keyword" || cleanLabel.includes("stmt") || cleanLabel.includes("ifstmt") || cleanLabel.includes("whilestmt") || cleanLabel.includes("forstmt") || cleanLabel.includes("match")) {
            this.iconPath = new vscode.ThemeIcon("symbol-keyword");
        } else {
            this.iconPath = new vscode.ThemeIcon("symbol-field");
        }

        if (line !== undefined) {
            this.command = {
                title: "Select Editor Range",
                command: "varn.selectEditorRange",
                arguments: [line]
            };
        }
    }
}

function convertJsonNode(jsonNode) {
    if (!jsonNode) return null;
    const label = jsonNode.label || "Node";
    const line = typeof jsonNode.line === "number" ? jsonNode.line : undefined;
    const kind = jsonNode.kind || "statement";
    const rawChildren = Array.isArray(jsonNode.children) ? jsonNode.children : [];
    const children = rawChildren.map(convertJsonNode).filter(Boolean);

    const item = new AstNodeItem(label, line, children, kind);
    return item;
}

async function getAstFromLsp(uriStr) {
    const client = getClient();
    if (!client) return null;

    try {
        const res = await client.sendRequest("workspace/executeCommand", {
            command: "varn.syntaxTree",
            arguments: [uriStr]
        });
        if (Array.isArray(res)) {
            const rootNodes = res.map(convertJsonNode).filter(Boolean);
            for (const r of rootNodes) {
                r.collapsibleState = vscode.TreeItemCollapsibleState.Expanded;
            }
            return rootNodes;
        }
    } catch {
        return null;
    }
    return null;
}

function getAstForFileCli(context, filePath) {
    return new Promise((resolve, reject) => {
        const cliPath = resolveCliPath(context);
        if (!cliPath) {
            return reject(new Error("Varn CLI not found"));
        }

        const args = ["debug", filePath, "-p", "ast"];
        const proc = spawn(cliPath, args, { cwd: path.dirname(filePath) });
        let stdout = "";
        let stderr = "";

        proc.stdout.on("data", (data) => {
            stdout += data.toString();
        });

        proc.stderr.on("data", (data) => {
            stderr += data.toString();
        });

        proc.on("close", (code) => {
            if (code !== 0) {
                return reject(new Error(stderr || `CLI exited with code ${code}`));
            }
            resolve(stdout);
        });

        proc.on("error", (err) => {
            reject(err);
        });
    });
}

function parseAstCli(stdout) {
    const lines = stdout.split(/\r?\n/);
    const rootNodes = [];
    const stack = [];

    for (const rawLine of lines) {
        const lineText = stripAnsi(rawLine);
        if (!lineText.trim()) continue;
        if (lineText.includes("abstract syntax tree") || lineText.includes("top-level statements")) {
            continue;
        }

        const match = lineText.match(/^([│├└─\s]*)(.*)$/);
        if (!match) continue;

        const prefix = match[1];
        const content = match[2].trim();
        if (!content) continue;

        const depth = Math.floor(prefix.length / 4);
        if (depth === 0) continue;

        const lineMatch = content.match(/^(.*?)\s*\[L(\d+)\]$/);
        let line = undefined;
        let label = content;
        if (lineMatch) {
            label = lineMatch[1].trim();
            line = parseInt(lineMatch[2], 10) - 1;
        }

        const node = new AstNodeItem(label, line);

        while (stack.length > 0 && stack[stack.length - 1].depth >= depth) {
            stack.pop();
        }

        if (stack.length === 0) {
            node.collapsibleState = vscode.TreeItemCollapsibleState.Expanded;
            rootNodes.push(node);
        } else {
            const parent = stack[stack.length - 1].node;
            parent.children.push(node);
            parent.collapsibleState = vscode.TreeItemCollapsibleState.Collapsed;
        }

        stack.push({ node, depth });
    }

    return rootNodes;
}

class VarnAstProvider {
    constructor(context) {
        this.context = context;
        this._onDidChangeTreeData = new vscode.EventEmitter();
        this.onDidChangeTreeData = this._onDidChangeTreeData.event;
        this.rootNodes = [];
        this.errorItem = null;
        this.loading = false;
    }

    async refresh() {
        const editor = vscode.window.activeTextEditor;
        if (!editor || !editor.document.fileName.endsWith(".vn")) {
            this.rootNodes = [];
            this.errorItem = null;
            this.loading = false;
            this._onDidChangeTreeData.fire();
            return;
        }

        this.loading = true;
        this.errorItem = null;
        this._onDidChangeTreeData.fire();

        const uriStr = editor.document.uri.toString();
        const filePath = editor.document.fileName;

        // Try memory-fast LSP first
        const lspNodes = await getAstFromLsp(uriStr);
        if (lspNodes && lspNodes.length > 0) {
            this.rootNodes = lspNodes;
            this.loading = false;
            this._onDidChangeTreeData.fire();
            return;
        }

        // Fallback to CLI
        try {
            const stdout = await getAstForFileCli(this.context, filePath);
            this.rootNodes = parseAstCli(stdout);
            this.loading = false;
            this._onDidChangeTreeData.fire();
        } catch (err) {
            this.rootNodes = [];
            this.errorItem = new vscode.TreeItem(
                `Error parsing AST: ${err.message || err}`,
                vscode.TreeItemCollapsibleState.None
            );
            this.errorItem.iconPath = new vscode.ThemeIcon("error");
            this.loading = false;
            this._onDidChangeTreeData.fire();
        }
    }

    getTreeItem(element) {
        return element;
    }

    getChildren(element) {
        if (element) {
            return element.children;
        }
        if (this.errorItem) {
            return [this.errorItem];
        }
        if (this.loading) {
            const item = new vscode.TreeItem("Loading AST...", vscode.TreeItemCollapsibleState.None);
            item.iconPath = new vscode.ThemeIcon("sync~spin");
            return [item];
        }
        if (this.rootNodes.length === 0) {
            const editor = vscode.window.activeTextEditor;
            if (editor && editor.document.fileName.endsWith(".vn")) {
                const item = new vscode.TreeItem("No AST nodes found", vscode.TreeItemCollapsibleState.None);
                return [item];
            } else {
                return [new vscode.TreeItem("No active Varn file open", vscode.TreeItemCollapsibleState.None)];
            }
        }
        return this.rootNodes;
    }
}

export {
    VarnAstProvider
};

