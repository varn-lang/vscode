import * as vscode from "vscode";
import { getClient } from "../client.js";
import { errorMessage } from "../utils.js";

const SCHEME = "vn-std";
const KINDS = ["std", "core", "runtime"];
const ZERO_STAT = { ctime: 0, mtime: 0, size: 0 };

export class VnStdFileSystemProvider implements vscode.FileSystemProvider {
    #specs: string[] | null = null;
    #contents = new Map<string, Uint8Array>();
    #emitter = new vscode.EventEmitter<vscode.FileChangeEvent[]>();
    readonly onDidChangeFile = this.#emitter.event;

    watch(): vscode.Disposable {
        return new vscode.Disposable(() => {});
    }

    async #specifiers(): Promise<string[]> {
        if (this.#specs) return this.#specs;
        const client = getClient();
        if (!client) return [];
        try {
            const res: unknown = await client.sendRequest("workspace/executeCommand", {
                command: "vn.stdList",
                arguments: [],
            });
            this.#specs = Array.isArray(res) ? ([...res] as string[]).sort() : [];
        } catch {
            this.#specs = [];
        }
        return this.#specs;
    }

    #specifierOf(uri: vscode.Uri): string | null {
        const parts = uri.path.split("/").filter(Boolean);
        if (parts.length <= 1) return null;
        const [kind, file] = parts;
        if (!KINDS.includes(kind)) return null;
        return `${kind}:${file.replace(/\.vn$/, "")}`;
    }

    async stat(uri: vscode.Uri): Promise<vscode.FileStat> {
        const parts = uri.path.split("/").filter(Boolean);
        if (parts.length <= 1) return { type: vscode.FileType.Directory, ...ZERO_STAT };
        const text = await this.readFile(uri);
        return { type: vscode.FileType.File, ctime: 0, mtime: 0, size: text.length };
    }

    async readDirectory(uri: vscode.Uri): Promise<[string, vscode.FileType][]> {
        const parts = uri.path.split("/").filter(Boolean);
        const specs = await this.#specifiers();
        if (parts.length === 0) return KINDS.map((kind) => [kind, vscode.FileType.Directory]);
        const [kind] = parts;
        return specs
            .filter((spec) => spec.startsWith(`${kind}:`))
            .map((spec): [string, vscode.FileType] => [`${spec.slice(kind.length + 1)}.vn`, vscode.FileType.File]);
    }

    async readFile(uri: vscode.Uri): Promise<Uint8Array> {
        const spec = this.#specifierOf(uri);
        if (!spec) throw vscode.FileSystemError.FileNotFound(uri);
        const cached = this.#contents.get(spec);
        if (cached !== undefined) return cached;
        const client = getClient();
        if (!client) throw vscode.FileSystemError.Unavailable("Varn Language Server not running");
        let res: unknown;
        try {
            res = await client.sendRequest("workspace/executeCommand", {
                command: "vn.stdRead",
                arguments: [spec],
            });
        } catch {
            throw vscode.FileSystemError.Unavailable(`std module unavailable: ${spec}`);
        }
        const data = Buffer.from(String(res ?? ""), "utf8");
        this.#contents.set(spec, data);
        return data;
    }

    writeFile(): never {
        throw vscode.FileSystemError.NoPermissions("vn-std is readonly");
    }

    createDirectory(): never {
        throw vscode.FileSystemError.NoPermissions("vn-std is readonly");
    }

    delete(): never {
        throw vscode.FileSystemError.NoPermissions("vn-std is readonly");
    }

    rename(): never {
        throw vscode.FileSystemError.NoPermissions("vn-std is readonly");
    }

    refresh(): void {
        this.#specs = null;
        this.#contents.clear();
        this.#emitter.fire([{ type: vscode.FileChangeType.Changed, uri: vscode.Uri.parse(`${SCHEME}:/`) }]);
    }
}

const IMPORT_RE = /(?:import|export)[^"']*from\s*["']((?:std|core|runtime):[^"']+)["']/g;

export class VnStdLinkProvider implements vscode.DocumentLinkProvider {
    provideDocumentLinks(document: vscode.TextDocument): vscode.DocumentLink[] {
        const links: vscode.DocumentLink[] = [];
        for (const match of document.getText().matchAll(IMPORT_RE)) {
            const spec = match[1];
            const target = specifierToUri(spec);
            if (!target) continue;
            const start = document.positionAt(match.index + match[0].indexOf(spec));
            const link = new vscode.DocumentLink(new vscode.Range(start, start.translate(0, spec.length)), target);
            link.tooltip = `Open ${spec} (readonly stdlib)`;
            links.push(link);
        }
        return links;
    }
}

export function specifierToUri(spec: string): vscode.Uri | null {
    const idx = spec.indexOf(":");
    if (idx < 0) return null;
    const kind = spec.slice(0, idx);
    const name = spec.slice(idx + 1);
    if (!KINDS.includes(kind) || !name) return null;
    return vscode.Uri.parse(`${SCHEME}:/${kind}/${name}.vn`);
}

export async function openStdModule(): Promise<void> {
    const client = getClient();
    if (!client) {
        void vscode.window.showErrorMessage("Varn Language Server not running.");
        return;
    }
    let specs: string[];
    try {
        const res: unknown = await client.sendRequest("workspace/executeCommand", {
            command: "vn.stdList",
            arguments: [],
        });
        specs = Array.isArray(res) ? ([...res] as string[]).sort() : [];
    } catch (err) {
        void vscode.window.showErrorMessage(`Stdlib unavailable: ${errorMessage(err)}`);
        return;
    }
    if (specs.length === 0) {
        void vscode.window.showWarningMessage("Stdlib empty: provider missing or fingerprint mismatch.");
        return;
    }
    const pick = await vscode.window.showQuickPick(specs, { placeHolder: "Open stdlib module (readonly)" });
    if (!pick) return;
    const uri = specifierToUri(pick);
    if (uri) await vscode.window.showTextDocument(uri, { preview: true });
}

export function registerStdlibFeatures(_context: vscode.ExtensionContext, fsProvider: VnStdFileSystemProvider): vscode.Disposable {
    return vscode.Disposable.from(
        vscode.workspace.registerFileSystemProvider(SCHEME, fsProvider, { isCaseSensitive: true, isReadonly: true }),
        vscode.languages.registerDocumentLinkProvider({ language: "vn" }, new VnStdLinkProvider()),
    );
}
