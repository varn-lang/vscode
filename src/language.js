import * as vscode from "vscode";

let langStatus = null;
let currentState = "starting";
let diagCounts = { errors: 0, warnings: 0 };

function initLanguageFeatures(context) {
    langStatus = vscode.languages.createLanguageStatusItem("varn.status", { language: "varn" });
    langStatus.command = { title: "Varn Actions", command: "Varn.showActionsHub" };
    refreshLanguageStatus();
    context.subscriptions.push(langStatus);

    const deco = new VarnFileDecorationProvider();
    context.subscriptions.push(vscode.window.registerFileDecorationProvider(deco));
    context.subscriptions.push(vscode.languages.onDidChangeDiagnostics(() => {
        updateDiagCounts();
        deco.refresh();
        refreshLanguageStatus();
    }));

    context.subscriptions.push(vscode.window.registerTerminalLinkProvider(new VarnTerminalLinkProvider()));

    context.subscriptions.push(vscode.languages.registerDocumentDropEditProvider({ language: "varn" }, new VarnDropProvider()));
    context.subscriptions.push(vscode.languages.registerDocumentPasteEditProvider({ language: "varn" }, new VarnPasteProvider(), { pasteMimeTypes: ["text/plain"] }));

    context.subscriptions.push(vscode.languages.registerInlineCompletionItemProvider({ language: "varn" }, new VarnInlineProvider()));

    updateDiagCounts();
}

function setLanguageState(state) {
    currentState = state;
    refreshLanguageStatus();
}

function refreshLanguageStatus() {
    if (!langStatus) return;
    const mode = vscode.workspace.getConfiguration("Varn").get("buildMode", "release");
    const dot = currentState === "running" ? "$(check)" : currentState === "starting" ? "$(loading~spin)" : "$(circle-slash)";
    langStatus.text = `${dot} Varn ${mode}`;
    const parts = [];
    parts.push(`LSP: ${currentState}`);
    parts.push(`Build: ${mode}`);
    if (diagCounts.errors > 0 || diagCounts.warnings > 0) parts.push(`Problems: ${diagCounts.errors}E ${diagCounts.warnings}W`);
    langStatus.detail = parts.join(" · ");
    langStatus.severity = currentState === "error" || diagCounts.errors > 0
        ? vscode.LanguageStatusSeverity.Error
        : currentState !== "running"
            ? vscode.LanguageStatusSeverity.Warning
            : vscode.LanguageStatusSeverity.Information;
    langStatus.busy = currentState === "starting";
}

function updateDiagCounts() {
    let e = 0;
    let w = 0;
    for (const uri of vscode.workspace.textDocuments.filter((d) => d.languageId === "varn").map((d) => d.uri)) {
        const diags = vscode.languages.getDiagnostics(uri);
        for (const d of diags) {
            if (d.severity === vscode.DiagnosticSeverity.Error) e++;
            else if (d.severity === vscode.DiagnosticSeverity.Warning) w++;
        }
    }
    diagCounts = { errors: e, warnings: w };
}

class VarnFileDecorationProvider {
    constructor() {
        this._emitter = new vscode.EventEmitter();
        this.onDidChangeFileDecorations = this._emitter.event;
    }
    refresh() { this._emitter.fire(); }
    provideFileDecoration(uri) {
        if (!uri.fsPath.endsWith(".vn")) return undefined;
        const diags = vscode.languages.getDiagnostics(uri);
        let badge = undefined;
        let color = undefined;
        let tooltip = undefined;
        const errs = diags.filter((d) => d.severity === vscode.DiagnosticSeverity.Error).length;
        const warns = diags.filter((d) => d.severity === vscode.DiagnosticSeverity.Warning).length;
        if (errs > 0) {
            badge = String(errs > 9 ? "!" : errs);
            color = new vscode.ThemeColor("errorForeground");
            tooltip = `${errs} error(s)`;
        } else if (warns > 0) {
            badge = String(warns > 9 ? "?" : warns);
            color = new vscode.ThemeColor("editorWarning.foreground");
            tooltip = `${warns} warning(s)`;
        } else return undefined;
        return { badge, color, tooltip };
    }
}

class VarnTerminalLinkProvider {
    provideTerminalLinks(context) {
        const re = /([A-Za-z0-9_\/\\.\-]+\.vn):(\d+):(\d+)/g;
        const links = [];
        let m;
        while ((m = re.exec(context.line)) !== null) {
            links.push({
                startIndex: m.index,
                length: m[0].length,
                tooltip: `Open ${m[0]} in Varn`,
                file: m[1],
                line: Number(m[2]),
                col: Number(m[3]),
            });
        }
        return links;
    }
    async handleTerminalLink(link) {
        const uri = vscode.Uri.file(link.file);
        try {
            const doc = await vscode.workspace.openTextDocument(uri);
            const editor = await vscode.window.showTextDocument(doc);
            const pos = new vscode.Position(Math.max(0, link.line - 1), Math.max(0, link.col - 1));
            editor.selection = new vscode.Selection(pos, pos);
            editor.revealRange(new vscode.Range(pos, pos), vscode.TextEditorRevealType.InCenter);
        } catch {}
    }
}

class VarnDropProvider {
    async provideDocumentDropEdits(document, position, dataTransfer) {
        const uriEntry = dataTransfer.get("text/uri-list");
        if (!uriEntry) return undefined;
        const raw = await uriEntry.asString();
        const first = raw.split(/\r?\n/).map((s) => s.trim()).filter(Boolean)[0];
        if (!first || !first.endsWith(".vn")) return undefined;
        let rel = first;
        try {
            const fromUri = vscode.Uri.parse(first);
            rel = vscode.workspace.asRelativePath(fromUri);
        } catch {}
        const name = rel.split(/[\\/]/).pop().replace(/\.vn$/, "");
        const edit = new vscode.WorkspaceEdit();
        edit.insert(document.uri, new vscode.Position(0, 0), `import { ${name} } from "${rel}";\n`);
        return { insertText: "", additionalEdit: edit, label: `Import ${name}` };
    }
}

class VarnPasteProvider {
    async provideDocumentPasteEdits(document, ranges, dataTransfer) {
        const textEntry = dataTransfer.get("text/plain");
        if (!textEntry) return undefined;
        const pasted = await textEntry.asString();
        const m = pasted.match(/\b(import\s*\{[^}]*\}\s*from\s*["'][^"']+["'];?)/);
        if (!m) return undefined;
        const edit = new vscode.WorkspaceEdit();
        edit.insert(document.uri, new vscode.Position(0, 0), `${m[1].endsWith(";") ? m[1] : m[1] + ";"}\n`);
        return { insertText: pasted, additionalEdit: edit, label: "Paste with import hoisted" };
    }
}

const POSTFIX = [
    { trigger: ".if", label: ".if → if", snippet: "if (${1:cond}) {\n\t$0\n}" },
    { trigger: ".match", label: ".match → match", snippet: "match ${1:x} {\n\t$0\n}" },
    { trigger: ".for", label: ".for → for", snippet: "for ${1:x} in ${2:xs} {\n\t$0\n}" },
    { trigger: ".try", label: ".try → try", snippet: "try {\n\t$0\n} catch (e) {\n}" },
];

class VarnInlineProvider {
    provideInlineCompletionItems(document, position) {
        const line = document.lineAt(position.line).text.slice(0, position.character);
        const hit = POSTFIX.find((p) => line.endsWith(p.trigger));
        if (!hit) return undefined;
        const item = new vscode.InlineCompletionItem(
            new vscode.SnippetString(hit.snippet),
            new vscode.Range(position.translate(0, -hit.trigger.length), position)
        );
        return [item];
    }
}

export {
    initLanguageFeatures,
    setLanguageState,
    refreshLanguageStatus,
};
