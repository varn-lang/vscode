import * as vscode from "vscode";
import * as path from "node:path";
import { spawn } from "node:child_process";
import { resolveCliPath } from "../binary.js";
import { errorMessage, stripAnsi } from "../utils.js";
import { getClient } from "../client.js";

interface AstJsonNode {
    label?: string;
    line?: number;
    kind?: string;
    children?: unknown;
}

interface IconRule {
    icon: string;
    kinds: string[];
    labelIncludes?: string[];
    labelStartsWith?: string[];
}

const ICON_RULES: IconRule[] = [
    { icon: "symbol-function", kinds: ["function"], labelIncludes: ["functiondecl"], labelStartsWith: ["fn "] },
    {
        icon: "symbol-variable",
        kinds: ["variable"],
        labelIncludes: ["variabledecl"],
        labelStartsWith: ["var ", "let ", "const "],
    },
    { icon: "symbol-class", kinds: ["class"], labelIncludes: ["classdecl"] },
    { icon: "symbol-interface", kinds: ["interface"], labelIncludes: ["interfacedecl"] },
    { icon: "symbol-enum", kinds: ["enum"], labelIncludes: ["enumdecl"] },
    { icon: "symbol-enum-member", kinds: ["enum_member"], labelIncludes: ["variant "] },
    { icon: "symbol-struct", kinds: ["struct"], labelIncludes: ["structdecl"] },
    { icon: "symbol-method", kinds: ["method"], labelIncludes: ["method "] },
    { icon: "symbol-property", kinds: ["property"], labelIncludes: ["prop ", "field "] },
    { icon: "symbol-parameter", kinds: ["parameter"], labelStartsWith: ["param:"] },
    { icon: "symbol-constant", kinds: ["constant"], labelIncludes: ["literal"] },
    { icon: "symbol-operator", kinds: ["operator"] },
    { icon: "symbol-module", kinds: ["import"] },
    {
        icon: "symbol-keyword",
        kinds: ["keyword"],
        labelIncludes: ["stmt", "ifstmt", "whilestmt", "forstmt", "match"],
    },
];

function iconFor(label: string, kind: string | undefined): vscode.ThemeIcon {
    const cleanLabel = label.toLowerCase();
    const nodeKind = (kind ?? "").toLowerCase();
    const rule = ICON_RULES.find(
        (candidate) =>
            candidate.kinds.includes(nodeKind) ||
            candidate.labelIncludes?.some((part) => cleanLabel.includes(part)) ||
            candidate.labelStartsWith?.some((prefix) => cleanLabel.startsWith(prefix)),
    );
    return new vscode.ThemeIcon(rule?.icon ?? "symbol-field");
}

class AstNodeItem extends vscode.TreeItem {
    readonly children: AstNodeItem[];

    constructor(label: string, line?: number, children: AstNodeItem[] = [], kind?: string) {
        super(
            label,
            children.length > 0 ? vscode.TreeItemCollapsibleState.Collapsed : vscode.TreeItemCollapsibleState.None,
        );
        this.children = children;
        this.iconPath = iconFor(label, kind);

        if (line !== undefined) {
            this.command = {
                title: "Select Editor Range",
                command: "vn.selectEditorRange",
                arguments: [line],
            };
        }
    }
}

function convertJsonNode(jsonNode: AstJsonNode | null | undefined): AstNodeItem | null {
    if (!jsonNode) return null;
    const label = jsonNode.label || "Node";
    const line = typeof jsonNode.line === "number" ? jsonNode.line : undefined;
    const kind = jsonNode.kind || "statement";
    const rawChildren = Array.isArray(jsonNode.children) ? (jsonNode.children as AstJsonNode[]) : [];
    const children = rawChildren.map(convertJsonNode).filter((child): child is AstNodeItem => child !== null);
    return new AstNodeItem(label, line, children, kind);
}

async function getAstFromLsp(uri: string): Promise<AstNodeItem[] | null> {
    const client = getClient();
    if (!client) return null;

    try {
        const res: unknown = await client.sendRequest("workspace/executeCommand", {
            command: "vn.syntaxTree",
            arguments: [uri],
        });
        if (!Array.isArray(res)) return null;
        const rootNodes = (res as AstJsonNode[])
            .map(convertJsonNode)
            .filter((node): node is AstNodeItem => node !== null);
        for (const root of rootNodes) root.collapsibleState = vscode.TreeItemCollapsibleState.Expanded;
        return rootNodes;
    } catch {
        return null;
    }
}

function getAstForFileCli(context: vscode.ExtensionContext, filePath: string): Promise<string> {
    return new Promise((resolve, reject) => {
        const cliPath = resolveCliPath(context);
        if (!cliPath) {
            reject(new Error("Varn CLI not found"));
            return;
        }

        const proc = spawn(cliPath, ["debug", filePath, "-p", "ast"], { cwd: path.dirname(filePath) });
        let stdout = "";
        let stderr = "";

        proc.stdout.on("data", (data: Buffer) => {
            stdout += data.toString();
        });
        proc.stderr.on("data", (data: Buffer) => {
            stderr += data.toString();
        });
        proc.on("close", (code) => {
            if (code !== 0) {
                reject(new Error(stderr || `CLI exited with code ${code}`));
                return;
            }
            resolve(stdout);
        });
        proc.on("error", reject);
    });
}

function parseAstCli(stdout: string): AstNodeItem[] {
    const rootNodes: AstNodeItem[] = [];
    const stack: { node: AstNodeItem; depth: number }[] = [];

    for (const rawLine of stdout.split(/\r?\n/)) {
        const lineText = stripAnsi(rawLine);
        if (!lineText.trim()) continue;
        if (lineText.includes("abstract syntax tree") || lineText.includes("top-level statements")) continue;

        const match = lineText.match(/^([│├└─\s]*)(.*)$/);
        if (!match) continue;

        const content = match[2].trim();
        if (!content) continue;

        const depth = Math.floor(match[1].length / 4);
        if (depth === 0) continue;

        const lineMatch = content.match(/^(.*?)\s*\[L(\d+)\]$/);
        const label = lineMatch ? lineMatch[1].trim() : content;
        const line = lineMatch ? parseInt(lineMatch[2], 10) - 1 : undefined;

        const node = new AstNodeItem(label, line);

        while (stack.length > 0 && stack[stack.length - 1].depth >= depth) stack.pop();

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

const AST_VIEW_ID = "vn-ast";

export class VarnAstProvider implements vscode.TreeDataProvider<AstNodeItem> {
    private readonly changed = new vscode.EventEmitter<void>();
    readonly onDidChangeTreeData = this.changed.event;
    private rootNodes: AstNodeItem[] = [];
    private view: vscode.TreeView<AstNodeItem> | undefined;
    private generation = 0;

    constructor(private readonly context: vscode.ExtensionContext) {}

    attach(view: vscode.TreeView<AstNodeItem>): void {
        this.view = view;
    }

    async refresh(): Promise<void> {
        const ticket = ++this.generation;
        const editor = vscode.window.activeTextEditor;
        if (!editor?.document.fileName.endsWith(".vn")) {
            this.show([], "Open a Varn file to see its syntax tree.");
            return;
        }

        const { document } = editor;
        await vscode.window.withProgress({ location: { viewId: AST_VIEW_ID } }, async () => {
            const lspNodes = await getAstFromLsp(document.uri.toString());
            if (ticket !== this.generation) return;
            if (lspNodes && lspNodes.length > 0) {
                this.show(lspNodes);
                return;
            }

            try {
                const nodes = parseAstCli(await getAstForFileCli(this.context, document.fileName));
                if (ticket === this.generation) {
                    this.show(nodes, nodes.length === 0 ? "No AST nodes found." : undefined);
                }
            } catch (err) {
                if (ticket === this.generation) this.show([], `Error parsing AST: ${errorMessage(err)}`);
            }
        });
    }

    private show(nodes: AstNodeItem[], message?: string): void {
        this.rootNodes = nodes;
        if (this.view) this.view.message = message;
        this.changed.fire();
    }

    getTreeItem(element: AstNodeItem): vscode.TreeItem {
        return element;
    }

    getChildren(element?: AstNodeItem): AstNodeItem[] {
        return element ? element.children : this.rootNodes;
    }
}
