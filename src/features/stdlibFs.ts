import * as vscode from "vscode";
import { getClient } from "../client.js";
import { errorMessage } from "../utils.js";

const SCHEME = "vn-std";
const KINDS = ["std", "core", "runtime"];
const ZERO_STAT = { ctime: 0, mtime: 0, size: 0 };

const READ_ONLY = "The Varn standard library is read-only.";

interface StdLocation {
    kind: string;
    path: string;
    file: boolean;
}

function locate(uri: vscode.Uri): StdLocation | null {
    const [kind, ...rest] = uri.path.split("/").filter(Boolean);
    if (!kind || !KINDS.includes(kind)) return null;
    const joined = rest.join("/");
    const file = joined.endsWith(".vn");
    return { kind, path: file ? joined.slice(0, -".vn".length) : joined, file };
}

/** Entries of a directory of the standard library, derived from the flat module list. */
export function childrenOf(specs: readonly string[], kind: string, directory: string): [string, vscode.FileType][] {
    const prefix = `${kind}:${directory ? `${directory}/` : ""}`;
    const entries = new Map<string, vscode.FileType>();
    for (const spec of specs) {
        if (!spec.startsWith(prefix)) continue;
        const rest = spec.slice(prefix.length);
        if (!rest) continue;
        const slash = rest.indexOf("/");
        if (slash >= 0) entries.set(rest.slice(0, slash), vscode.FileType.Directory);
        else entries.set(`${rest}.vn`, vscode.FileType.File);
    }
    return [...entries];
}

export function typeOf(
    specs: readonly string[],
    kind: string,
    relative: string,
    file: boolean,
): vscode.FileType | undefined {
    if (file) return specs.includes(`${kind}:${relative}`) ? vscode.FileType.File : undefined;
    return specs.some((spec) => spec.startsWith(`${kind}:${relative}/`)) ? vscode.FileType.Directory : undefined;
}

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
        if (!client) throw vscode.FileSystemError.Unavailable("Varn Language Server not running");
        let res: unknown;
        try {
            res = await client.sendRequest("workspace/executeCommand", { command: "vn.stdList", arguments: [] });
        } catch (err) {
            throw vscode.FileSystemError.Unavailable(`Stdlib unavailable: ${errorMessage(err)}`);
        }
        if (!Array.isArray(res) || res.length === 0) {
            throw vscode.FileSystemError.Unavailable(
                "The server found no standard library: check that vn can locate its std directory.",
            );
        }
        this.#specs = [...(res as string[])].sort();
        return this.#specs;
    }

    async stat(uri: vscode.Uri): Promise<vscode.FileStat> {
        const location = locate(uri);
        if (!location) {
            if (uri.path.split("/").filter(Boolean).length === 0) return { type: vscode.FileType.Directory, ...ZERO_STAT };
            throw vscode.FileSystemError.FileNotFound(uri);
        }
        if (location.path === "") return { type: vscode.FileType.Directory, ...ZERO_STAT };
        const type = typeOf(await this.#specifiers(), location.kind, location.path, location.file);
        if (type === undefined) throw vscode.FileSystemError.FileNotFound(uri);
        if (type === vscode.FileType.Directory) return { type, ...ZERO_STAT };
        const text = await this.readFile(uri);
        return { type, ctime: 0, mtime: 0, size: text.length };
    }

    async readDirectory(uri: vscode.Uri): Promise<[string, vscode.FileType][]> {
        const location = locate(uri);
        if (!location) {
            if (uri.path.split("/").filter(Boolean).length === 0) {
                return KINDS.map((kind) => [kind, vscode.FileType.Directory]);
            }
            throw vscode.FileSystemError.FileNotFound(uri);
        }
        const specs = await this.#specifiers();
        if (location.path !== "" && typeOf(specs, location.kind, location.path, location.file) !== vscode.FileType.Directory) {
            throw vscode.FileSystemError.FileNotFound(uri);
        }
        return childrenOf(specs, location.kind, location.path);
    }

    async readFile(uri: vscode.Uri): Promise<Uint8Array> {
        const location = locate(uri);
        if (!location || !location.file) throw vscode.FileSystemError.FileNotFound(uri);
        const spec = `${location.kind}:${location.path}`;
        const cached = this.#contents.get(spec);
        if (cached !== undefined) return cached;
        const client = getClient();
        if (!client) throw vscode.FileSystemError.Unavailable("Varn Language Server not running");
        let res: unknown;
        try {
            res = await client.sendRequest("workspace/executeCommand", { command: "vn.stdRead", arguments: [spec] });
        } catch {
            throw vscode.FileSystemError.Unavailable(`std module unavailable: ${spec}`);
        }
        if (typeof res !== "string") throw vscode.FileSystemError.FileNotFound(uri);
        const data = Buffer.from(res, "utf8");
        this.#contents.set(spec, data);
        return data;
    }

    writeFile(): never {
        throw vscode.FileSystemError.NoPermissions(READ_ONLY);
    }

    createDirectory(): never {
        throw vscode.FileSystemError.NoPermissions(READ_ONLY);
    }

    delete(): never {
        throw vscode.FileSystemError.NoPermissions(READ_ONLY);
    }

    rename(): never {
        throw vscode.FileSystemError.NoPermissions(READ_ONLY);
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
