import * as vscode from "vscode";
import { getClient } from "../client.js";

const SCHEME = "varn-std";

export class VarnStdFileSystemProvider {
    #specs = null;
    #contents = new Map();
    #emitter = new vscode.EventEmitter();
    onDidChangeFile = this.#emitter.event;

    watch() {
        return { dispose() {} };
    }

    async #specifiers() {
        if (this.#specs) return this.#specs;
        const client = getClient();
        if (!client) return [];
        try {
            const res = await client.sendRequest("workspace/executeCommand", { command: "varn.stdList", arguments: [] });
            this.#specs = Array.isArray(res) ? [...res].sort() : [];
        } catch {
            this.#specs = [];
        }
        return this.#specs;
    }

    #specifierOf(uri) {
        const parts = uri.path.split("/").filter(Boolean);
        if (parts.length === 0) return null;
        if (parts.length === 1) return null;
        const [kind, file] = parts;
        if (!["std", "core", "runtime"].includes(kind)) return null;
        return `${kind}:${file.replace(/\.vn$/, "")}`;
    }

    async stat(uri) {
        const parts = uri.path.split("/").filter(Boolean);
        if (parts.length <= 1) return { type: vscode.FileType.Directory, ctime: 0, mtime: 0, size: 0 };
        const text = await this.readFile(uri);
        return { type: vscode.FileType.File, ctime: 0, mtime: 0, size: text.length };
    }

    async readDirectory(uri) {
        const parts = uri.path.split("/").filter(Boolean);
        const specs = await this.#specifiers();
        if (parts.length === 0) return [["std", vscode.FileType.Directory], ["core", vscode.FileType.Directory], ["runtime", vscode.FileType.Directory]];
        const [kind] = parts;
        return specs.filter((s) => s.startsWith(`${kind}:`)).map((s) => [`${s.slice(kind.length + 1)}.vn`, vscode.FileType.File]);
    }

    async readFile(uri) {
        const spec = this.#specifierOf(uri);
        if (!spec) throw vscode.FileSystemError.FileNotFound(uri);
        const cached = this.#contents.get(spec);
        if (cached !== undefined) return cached;
        const client = getClient();
        if (!client) throw vscode.FileSystemError.Unavailable("Varn Language Server not running");
        let res;
        try {
            res = await client.sendRequest("workspace/executeCommand", { command: "varn.stdRead", arguments: [spec] });
        } catch (err) {
            throw vscode.FileSystemError.Unavailable(`std module unavailable: ${spec}`);
        }
        const data = Buffer.from(String(res ?? ""), "utf8");
        this.#contents.set(spec, data);
        return data;
    }

    async writeFile() {
        throw vscode.FileSystemError.NoPermissions("varn-std is readonly");
    }

    async createDirectory() {
        throw vscode.FileSystemError.NoPermissions("varn-std is readonly");
    }

    async delete() {
        throw vscode.FileSystemError.NoPermissions("varn-std is readonly");
    }

    async rename() {
        throw vscode.FileSystemError.NoPermissions("varn-std is readonly");
    }

    refresh() {
        this.#specs = null;
        this.#contents.clear();
        this.#emitter.fire([{ type: vscode.FileChangeType.Changed, uri: vscode.Uri.parse(`${SCHEME}:/`) }]);
    }
}

const IMPORT_RE = /(?:import|export)[^"']*from\s*["']((?:std|core|runtime):[^"']+)["']/g;

export class VarnStdLinkProvider {
    provideDocumentLinks(document) {
        const links = [];
        const text = document.getText();
        let m;
        IMPORT_RE.lastIndex = 0;
        while ((m = IMPORT_RE.exec(text)) !== null) {
            const spec = m[1];
            const start = document.positionAt(m.index + m[0].indexOf(spec));
            const end = start.translate(0, spec.length);
            const target = specifierToUri(spec);
            if (target) links.push({ range: { start, end }, target, tooltip: `Open ${spec} (readonly stdlib)` });
        }
        return links;
    }
}

export function specifierToUri(spec) {
    const idx = spec.indexOf(":");
    if (idx < 0) return null;
    const kind = spec.slice(0, idx);
    const name = spec.slice(idx + 1);
    if (!["std", "core", "runtime"].includes(kind) || !name) return null;
    return vscode.Uri.parse(`${SCHEME}:/${kind}/${name}.vn`);
}

export async function openStdModule() {
    const client = getClient();
    if (!client) {
        vscode.window.showErrorMessage("Varn Language Server not running.");
        return;
    }
    let specs = [];
    try {
        const res = await client.sendRequest("workspace/executeCommand", { command: "varn.stdList", arguments: [] });
        specs = Array.isArray(res) ? [...res].sort() : [];
    } catch (err) {
        vscode.window.showErrorMessage(`Stdlib unavailable: ${err?.message ?? err}`);
        return;
    }
    if (specs.length === 0) {
        vscode.window.showWarningMessage("Stdlib empty: provider missing or fingerprint mismatch.");
        return;
    }
    const pick = await vscode.window.showQuickPick(specs, { placeHolder: "Open stdlib module (readonly)" });
    if (!pick) return;
    const uri = specifierToUri(pick);
    if (uri) await vscode.window.showTextDocument(uri, { preview: true });
}

export function registerStdlibFeatures(context, fsProvider) {
    return vscode.Disposable.from(
        vscode.workspace.registerFileSystemProvider(SCHEME, fsProvider, { isCaseSensitive: true, isReadonly: true }),
        vscode.languages.registerDocumentLinkProvider({ language: "varn" }, new VarnStdLinkProvider()),
    );
}
