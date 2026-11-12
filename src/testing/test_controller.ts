import * as vscode from "vscode";
import * as path from "node:path";
import { spawn } from "node:child_process";
import { BINARY_NOT_FOUND, resolveCliPath } from "../binary.js";
import { stripAnsi } from "../utils.js";
import { scanTests, type ScannedCase } from "./scan.js";

interface FileRun {
    code: number | null;
    output: string;
    elapsedMs: number;
    launchError?: string;
}

function descendants(item: vscode.TestItem): vscode.TestItem[] {
    const found: vscode.TestItem[] = [];
    item.children.forEach((child) => found.push(child, ...descendants(child)));
    return found;
}

class VarnTestController implements vscode.Disposable {
    private readonly ctrl: vscode.TestController;
    private readonly disposables: vscode.Disposable[];

    constructor(private readonly context: vscode.ExtensionContext) {
        this.ctrl = vscode.tests.createTestController("vnTestController", "Varn Tests & Benchmarks");

        this.ctrl.refreshHandler = async () => {
            await this.discoverAllWorkspaceTests();
        };

        this.ctrl.resolveHandler = async (item) => {
            if (!item) await this.discoverAllWorkspaceTests();
            else if (item.uri) await this.discoverDocumentTests(item.uri);
        };

        this.ctrl.createRunProfile(
            "Run Tests",
            vscode.TestRunProfileKind.Run,
            (request, token) => this.runHandler(request, token, false),
            true,
            undefined,
            true,
        );

        this.ctrl.createRunProfile(
            "Benchmark File",
            vscode.TestRunProfileKind.Run,
            (request, token) => this.runHandler(request, token, true),
            false,
            undefined,
            false,
        );

        this.disposables = [
            this.ctrl,
            vscode.workspace.onDidSaveTextDocument((doc) => {
                if (doc.fileName.endsWith(".vn")) void this.discoverDocumentTests(doc.uri);
            }),
            vscode.workspace.onDidOpenTextDocument((doc) => {
                if (doc.fileName.endsWith(".vn")) void this.discoverDocumentTests(doc.uri);
            }),
        ];

        const active = vscode.window.activeTextEditor;
        if (active?.document.fileName.endsWith(".vn")) void this.discoverDocumentTests(active.document.uri);
    }

    async discoverAllWorkspaceTests(): Promise<void> {
        const files = await vscode.workspace.findFiles("**/*.vn", "**/node_modules/**");
        for (const file of files) await this.discoverDocumentTests(file);
    }

    async discoverDocumentTests(uri: vscode.Uri): Promise<void> {
        try {
            const doc = await vscode.workspace.openTextDocument(uri);
            const scanned = scanTests(doc.getText());
            const fileId = uri.toString();

            if (scanned.suites.length === 0 && scanned.cases.length === 0) {
                this.ctrl.items.delete(fileId);
                return;
            }

            let fileItem = this.ctrl.items.get(fileId);
            if (!fileItem) {
                fileItem = this.ctrl.createTestItem(fileId, path.basename(uri.fsPath), uri);
                this.ctrl.items.add(fileItem);
            }

            const wanted = new Map<string, vscode.TestItem>();
            const seen = new Map<string, number>();
            const place = (parent: vscode.TestItem, scannedCase: ScannedCase, scope: string): vscode.TestItem => {
                const key = `${scope}::${scannedCase.title}`;
                const occurrence = seen.get(key) ?? 0;
                seen.set(key, occurrence + 1);
                const id = occurrence === 0 ? `${fileId}::${key}` : `${fileId}::${key}#${occurrence + 1}`;
                let item = parent.children.get(id);
                if (!item) {
                    item = this.ctrl.createTestItem(id, scannedCase.title, uri);
                    parent.children.add(item);
                }
                item.range = new vscode.Range(
                    scannedCase.line,
                    scannedCase.column,
                    scannedCase.line,
                    scannedCase.column + scannedCase.title.length,
                );
                wanted.set(id, item);
                return item;
            };

            for (const scannedCase of scanned.cases) place(fileItem, scannedCase, "test");
            for (const suite of scanned.suites) {
                const suiteItem = place(fileItem, suite, "suite");
                for (const scannedCase of suite.cases) place(suiteItem, scannedCase, `suite:${suite.title}`);
                this.prune(suiteItem, wanted);
            }
            this.prune(fileItem, wanted);
        } catch {
            return;
        }
    }

    private prune(parent: vscode.TestItem, wanted: Map<string, vscode.TestItem>): void {
        parent.children.forEach((child) => {
            if (!wanted.has(child.id)) parent.children.delete(child.id);
        });
    }

    async runHandler(
        request: vscode.TestRunRequest,
        token: vscode.CancellationToken,
        isBench: boolean,
    ): Promise<void> {
        const run = this.ctrl.createTestRun(request);
        const cliPath = resolveCliPath(this.context);

        if (!cliPath) {
            void vscode.window.showErrorMessage(BINARY_NOT_FOUND);
            run.end();
            return;
        }

        const roots: vscode.TestItem[] = [];
        if (request.include) request.include.forEach((item) => roots.push(item));
        else this.ctrl.items.forEach((item) => roots.push(item));

        const byFile = new Map<string, { uri: vscode.Uri; items: vscode.TestItem[] }>();
        for (const item of roots) {
            if (!item.uri || request.exclude?.includes(item)) continue;
            const key = item.uri.toString();
            const group = byFile.get(key) ?? { uri: item.uri, items: [] };
            group.items.push(item);
            byFile.set(key, group);
        }

        for (const { uri, items } of byFile.values()) {
            if (token.isCancellationRequested) break;
            const nodes = items.flatMap((item) => [item, ...descendants(item)]);
            nodes.forEach((node) => run.started(node));

            const result = await this.runFile(cliPath, uri, token, isBench);
            if (!result) {
                nodes.forEach((node) => run.skipped(node));
                continue;
            }
            this.report(run, nodes, items, result);
        }

        run.end();
    }

    private report(run: vscode.TestRun, nodes: vscode.TestItem[], roots: vscode.TestItem[], result: FileRun): void {
        if (result.launchError) {
            const message = new vscode.TestMessage(`Failed to launch: ${result.launchError}`);
            nodes.forEach((node) => run.errored(node, message, result.elapsedMs));
            return;
        }

        if (result.code === 0) {
            if (result.output) {
                roots.forEach((root) => run.appendOutput(`${result.output.replace(/\n/g, "\r\n")}\r\n`, undefined, root));
            }
            nodes.forEach((node) => run.passed(node, result.elapsedMs));
            return;
        }

        const text = result.output || `Process exited with code ${result.code}`;
        for (const node of nodes) {
            const message = new vscode.TestMessage(text);
            if (node.uri && node.range) message.location = new vscode.Location(node.uri, node.range);
            run.failed(node, message, result.elapsedMs);
        }
    }

    /** `vn test` and `vn bench` work on whole files, so every item of a file shares one process. */
    private runFile(
        cliPath: string,
        uri: vscode.Uri,
        token: vscode.CancellationToken,
        isBench: boolean,
    ): Promise<FileRun | undefined> {
        const filePath = uri.fsPath;
        const start = Date.now();

        return new Promise((resolve) => {
            const proc = spawn(cliPath, [isBench ? "bench" : "test", filePath], { cwd: path.dirname(filePath) });
            let stdout = "";
            let stderr = "";
            let settled = false;
            const finish = (value: FileRun | undefined): void => {
                if (settled) return;
                settled = true;
                cancellation.dispose();
                resolve(value);
            };
            const cancellation = token.onCancellationRequested(() => {
                proc.kill();
                finish(undefined);
            });

            proc.stdout.on("data", (data: Buffer) => {
                stdout += data.toString();
            });
            proc.stderr.on("data", (data: Buffer) => {
                stderr += data.toString();
            });
            proc.on("close", (code) => {
                finish({
                    code,
                    output: stripAnsi(`${stdout}\n${stderr}`).trim(),
                    elapsedMs: Date.now() - start,
                });
            });
            proc.on("error", (err) => {
                finish({ code: null, output: "", elapsedMs: Date.now() - start, launchError: err.message });
            });
        });
    }

    dispose(): void {
        for (const disposable of this.disposables) {
            try {
                disposable.dispose();
            } catch {
                continue;
            }
        }
        this.disposables.length = 0;
    }
}

export function registerTestController(context: vscode.ExtensionContext): VarnTestController {
    return new VarnTestController(context);
}
