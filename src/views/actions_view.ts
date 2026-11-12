import * as vscode from "vscode";
import { resolveCliPath } from "../binary.js";

class ActionCategoryItem extends vscode.TreeItem {
    constructor(
        label: string,
        collapsibleState: vscode.TreeItemCollapsibleState,
        readonly actions: readonly ActionDefinition[],
    ) {
        super(label, collapsibleState);
        this.contextValue = "category";
    }
}

class ActionTreeItem extends vscode.TreeItem {
    constructor({ label, icon, command }: ActionDefinition) {
        super(label, vscode.TreeItemCollapsibleState.None);
        this.iconPath = new vscode.ThemeIcon(icon);
        this.command = { title: label, command };
        this.contextValue = "action";
    }
}

interface ActionDefinition {
    label: string;
    icon: string;
    command: string;
}

const FILE_OPERATIONS: ActionDefinition[] = [
    { label: "Run File", icon: "play", command: "vn.runFile" },
    { label: "Run File in Terminal", icon: "terminal", command: "vn.runFileInTerminal" },
    { label: "Check File (Typecheck)", icon: "checklist", command: "vn.checkFile" },
    { label: "Build File (Compile)", icon: "package", command: "vn.buildFile" },
    { label: "Show Bytecode", icon: "file-binary", command: "vn.showBytecode" },
    { label: "Show AST", icon: "symbol-structure", command: "vn.showAst" },
    { label: "Benchmark File", icon: "dashboard", command: "vn.benchFile" },
];

const DEPENDENCY_MANAGEMENT: ActionDefinition[] = [
    { label: "Add Dependency", icon: "add", command: "vn.pkgAdd" },
    { label: "Remove Dependency", icon: "trash", command: "vn.pkgRemove" },
    { label: "Install Dependencies", icon: "cloud-download", command: "vn.pkgInstall" },
    { label: "Update Dependencies", icon: "refresh", command: "vn.pkgUpdate" },
];

const UTILITIES: ActionDefinition[] = [
    { label: "Start Interactive REPL", icon: "terminal", command: "vn.runRepl" },
    { label: "Doctor (Check Setup)", icon: "pulse", command: "vn.doctor" },
    { label: "Init Project", icon: "new-folder", command: "vn.initProject" },
    { label: "Clean Cache", icon: "clear-all", command: "vn.cacheClean" },
    { label: "Install Runtime", icon: "cloud-download", command: "vn.installRuntime" },
];

type ActionNode = ActionCategoryItem | ActionTreeItem;

export class VnActionsProvider implements vscode.TreeDataProvider<ActionNode> {
    private readonly changed = new vscode.EventEmitter<void>();
    readonly onDidChangeTreeData = this.changed.event;

    constructor(private readonly context: vscode.ExtensionContext) {}

    refresh(): void {
        this.changed.fire();
    }

    getTreeItem(element: ActionNode): vscode.TreeItem {
        return element;
    }

    getChildren(element?: ActionNode): ActionNode[] {
        if (!element) {
            if (!resolveCliPath(this.context)) return [];
            return [
                new ActionCategoryItem("File Operations", vscode.TreeItemCollapsibleState.Expanded, FILE_OPERATIONS),
                new ActionCategoryItem(
                    "Dependency Management",
                    vscode.TreeItemCollapsibleState.Collapsed,
                    DEPENDENCY_MANAGEMENT,
                ),
                new ActionCategoryItem("Utilities", vscode.TreeItemCollapsibleState.Collapsed, UTILITIES),
            ];
        }
        if (element instanceof ActionCategoryItem) {
            return element.actions.map((action) => new ActionTreeItem(action));
        }
        return [];
    }
}
