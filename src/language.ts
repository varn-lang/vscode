import * as vscode from "vscode";

export type LspState = "starting" | "running" | "stopped" | "error";

interface DiagnosticCounts {
    errors: number;
    warnings: number;
}

interface VarnTerminalLink extends vscode.TerminalLink {
    file: string;
    line: number;
    col: number;
}

let langStatus: vscode.LanguageStatusItem | undefined;
let currentState: LspState = "starting";
let diagCounts: DiagnosticCounts = { errors: 0, warnings: 0 };

export function initLanguageFeatures(context: vscode.ExtensionContext): void {
    langStatus = vscode.languages.createLanguageStatusItem("varn.status", { language: "varn" });
    langStatus.command = { title: "Varn Actions", command: "varn.showActionsHub" };
    refreshLanguageStatus();
    context.subscriptions.push(langStatus);

    const deco = new VarnFileDecorationProvider();
    context.subscriptions.push(vscode.window.registerFileDecorationProvider(deco));
    context.subscriptions.push(
        vscode.languages.onDidChangeDiagnostics(() => {
            updateDiagCounts();
            deco.refresh();
            refreshLanguageStatus();
        }),
    );

    context.subscriptions.push(vscode.window.registerTerminalLinkProvider(new VarnTerminalLinkProvider()));

    context.subscriptions.push(
        vscode.languages.registerDocumentDropEditProvider({ language: "varn" }, new VarnDropProvider()),
    );
    context.subscriptions.push(
        vscode.languages.registerDocumentPasteEditProvider({ language: "varn" }, new VarnPasteProvider(), {
            pasteMimeTypes: ["text/plain"],
            providedPasteEditKinds: [VarnPasteProvider.kind],
        }),
    );

    context.subscriptions.push(
        vscode.languages.registerInlineCompletionItemProvider({ language: "varn" }, new VarnInlineProvider()),
    );

    updateDiagCounts();
}

export function setLanguageState(state: LspState): void {
    currentState = state;
    refreshLanguageStatus();
}

export function refreshLanguageStatus(): void {
    if (!langStatus) return;
    const mode = vscode.workspace.getConfiguration("Varn").get<string>("buildMode", "release");
    const dot =
        currentState === "running" ? "$(check)" : currentState === "starting" ? "$(loading~spin)" : "$(circle-slash)";
    langStatus.text = `${dot} Varn ${mode}`;
    const parts = [`LSP: ${currentState}`, `Build: ${mode}`];
    if (diagCounts.errors > 0 || diagCounts.warnings > 0) {
        parts.push(`Problems: ${diagCounts.errors}E ${diagCounts.warnings}W`);
    }
    langStatus.detail = parts.join(" · ");
    langStatus.severity =
        currentState === "error" || diagCounts.errors > 0
            ? vscode.LanguageStatusSeverity.Error
            : currentState !== "running"
              ? vscode.LanguageStatusSeverity.Warning
              : vscode.LanguageStatusSeverity.Information;
    langStatus.busy = currentState === "starting";
}

function updateDiagCounts(): void {
    let errors = 0;
    let warnings = 0;
    for (const doc of vscode.workspace.textDocuments) {
        if (doc.languageId !== "varn") continue;
        for (const diagnostic of vscode.languages.getDiagnostics(doc.uri)) {
            if (diagnostic.severity === vscode.DiagnosticSeverity.Error) errors++;
            else if (diagnostic.severity === vscode.DiagnosticSeverity.Warning) warnings++;
        }
    }
    diagCounts = { errors, warnings };
}

class VarnFileDecorationProvider implements vscode.FileDecorationProvider {
    private readonly emitter = new vscode.EventEmitter<undefined>();
    readonly onDidChangeFileDecorations = this.emitter.event;

    refresh(): void {
        this.emitter.fire(undefined);
    }

    provideFileDecoration(uri: vscode.Uri): vscode.FileDecoration | undefined {
        if (!uri.fsPath.endsWith(".vn")) return undefined;
        const diagnostics = vscode.languages.getDiagnostics(uri);
        const errors = diagnostics.filter((d) => d.severity === vscode.DiagnosticSeverity.Error).length;
        const warnings = diagnostics.filter((d) => d.severity === vscode.DiagnosticSeverity.Warning).length;
        if (errors > 0) {
            return {
                badge: errors > 9 ? "!" : String(errors),
                color: new vscode.ThemeColor("errorForeground"),
                tooltip: `${errors} error(s)`,
            };
        }
        if (warnings > 0) {
            return {
                badge: warnings > 9 ? "?" : String(warnings),
                color: new vscode.ThemeColor("editorWarning.foreground"),
                tooltip: `${warnings} warning(s)`,
            };
        }
        return undefined;
    }
}

class VarnTerminalLinkProvider implements vscode.TerminalLinkProvider<VarnTerminalLink> {
    provideTerminalLinks(context: vscode.TerminalLinkContext): VarnTerminalLink[] {
        const pattern = /([A-Za-z0-9_\/\\.\-]+\.vn):(\d+):(\d+)/g;
        const links: VarnTerminalLink[] = [];
        for (const match of context.line.matchAll(pattern)) {
            links.push({
                startIndex: match.index,
                length: match[0].length,
                tooltip: `Open ${match[0]} in Varn`,
                file: match[1],
                line: Number(match[2]),
                col: Number(match[3]),
            });
        }
        return links;
    }

    async handleTerminalLink(link: VarnTerminalLink): Promise<void> {
        try {
            const doc = await vscode.workspace.openTextDocument(vscode.Uri.file(link.file));
            const editor = await vscode.window.showTextDocument(doc);
            const pos = new vscode.Position(Math.max(0, link.line - 1), Math.max(0, link.col - 1));
            editor.selection = new vscode.Selection(pos, pos);
            editor.revealRange(new vscode.Range(pos, pos), vscode.TextEditorRevealType.InCenter);
        } catch {
            return;
        }
    }
}

class VarnDropProvider implements vscode.DocumentDropEditProvider {
    async provideDocumentDropEdits(
        document: vscode.TextDocument,
        _position: vscode.Position,
        dataTransfer: vscode.DataTransfer,
    ): Promise<vscode.DocumentDropEdit | undefined> {
        const uriEntry = dataTransfer.get("text/uri-list");
        if (!uriEntry) return undefined;
        const raw = await uriEntry.asString();
        const first = raw
            .split(/\r?\n/)
            .map((line) => line.trim())
            .filter(Boolean)[0];
        if (!first || !first.endsWith(".vn")) return undefined;
        let rel = first;
        try {
            rel = vscode.workspace.asRelativePath(vscode.Uri.parse(first));
        } catch {
            rel = first;
        }
        const name = (rel.split(/[\\/]/).pop() ?? rel).replace(/\.vn$/, "");
        const edit = new vscode.DocumentDropEdit("", `Import ${name}`);
        edit.additionalEdit = new vscode.WorkspaceEdit();
        edit.additionalEdit.insert(document.uri, new vscode.Position(0, 0), `import { ${name} } from "${rel}";\n`);
        return edit;
    }
}

class VarnPasteProvider implements vscode.DocumentPasteEditProvider {
    static readonly kind = vscode.DocumentDropOrPasteEditKind.Empty.append("varn", "import");

    async provideDocumentPasteEdits(
        document: vscode.TextDocument,
        _ranges: readonly vscode.Range[],
        dataTransfer: vscode.DataTransfer,
    ): Promise<vscode.DocumentPasteEdit[] | undefined> {
        const textEntry = dataTransfer.get("text/plain");
        if (!textEntry) return undefined;
        const pasted = await textEntry.asString();
        const match = pasted.match(/\b(import\s*\{[^}]*\}\s*from\s*["'][^"']+["'];?)/);
        if (!match) return undefined;
        const importLine = match[1].endsWith(";") ? match[1] : `${match[1]};`;
        const edit = new vscode.DocumentPasteEdit(pasted, "Paste with import hoisted", VarnPasteProvider.kind);
        edit.additionalEdit = new vscode.WorkspaceEdit();
        edit.additionalEdit.insert(document.uri, new vscode.Position(0, 0), `${importLine}\n`);
        return [edit];
    }
}

const POSTFIX = [
    { trigger: ".if", snippet: "if (${1:cond}) {\n\t$0\n}" },
    { trigger: ".match", snippet: "match ${1:x} {\n\t$0\n}" },
    { trigger: ".for", snippet: "for ${1:x} in ${2:xs} {\n\t$0\n}" },
    { trigger: ".try", snippet: "try {\n\t$0\n} catch (e) {\n}" },
];

class VarnInlineProvider implements vscode.InlineCompletionItemProvider {
    provideInlineCompletionItems(
        document: vscode.TextDocument,
        position: vscode.Position,
    ): vscode.InlineCompletionItem[] | undefined {
        const line = document.lineAt(position.line).text.slice(0, position.character);
        const hit = POSTFIX.find((entry) => line.endsWith(entry.trigger));
        if (!hit) return undefined;
        const range = new vscode.Range(position.translate(0, -hit.trigger.length), position);
        return [new vscode.InlineCompletionItem(new vscode.SnippetString(hit.snippet), range)];
    }
}
