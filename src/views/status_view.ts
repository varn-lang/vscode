import * as vscode from "vscode";
import { getLspStatus } from "../status.js";
import { resolveCliPath } from "../binary.js";
import type { LspState } from "../language.js";

class StatusTreeItem extends vscode.TreeItem {
    constructor(label: string, description: string, iconName: string, command?: vscode.Command) {
        super(label, vscode.TreeItemCollapsibleState.None);
        this.description = description;
        this.iconPath = new vscode.ThemeIcon(iconName);
        if (command) this.command = command;
    }
}

const LSP_PRESENTATION: Record<LspState, { description: string; icon: string }> = {
    running: { description: "Running", icon: "check" },
    starting: { description: "Starting...", icon: "sync~spin" },
    error: { description: "Error (LSP not found)", icon: "error" },
    stopped: { description: "Stopped", icon: "circle-slash" },
};

export class VnStatusProvider implements vscode.TreeDataProvider<StatusTreeItem> {
    private readonly changed = new vscode.EventEmitter<void>();
    readonly onDidChangeTreeData = this.changed.event;

    constructor(private readonly context: vscode.ExtensionContext) {}

    refresh(): void {
        this.changed.fire();
    }

    getTreeItem(element: StatusTreeItem): vscode.TreeItem {
        return element;
    }

    getChildren(): StatusTreeItem[] {
        const lsp = LSP_PRESENTATION[getLspStatus()];
        const mode = vscode.workspace.getConfiguration("vn").get<string>("buildMode", "release");
        const isRelease = mode === "release";
        const cliPath = resolveCliPath(this.context);

        return [
            new StatusTreeItem("LSP Server", lsp.description, lsp.icon, {
                title: "Restart LSP Server",
                command: "vn.restartServer",
            }),
            new StatusTreeItem("Build Mode", isRelease ? "Release" : "Debug", isRelease ? "zap" : "beaker", {
                title: "Toggle Build Mode",
                command: "vn.toggleBuildMode",
            }),
            new StatusTreeItem("Binary path", cliPath ?? "Not found", "terminal"),
        ];
    }
}
