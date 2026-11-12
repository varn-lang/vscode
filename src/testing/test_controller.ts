import * as vscode from "vscode";
import * as path from "node:path";
import { spawn } from "node:child_process";
import { resolveCliPath } from "../binary.js";
import { stripAnsi } from "../utils.js";

class VarnTestController implements vscode.Disposable {
    private readonly ctrl: vscode.TestController;
    private readonly disposables: vscode.Disposable[];

    constructor(private readonly context: vscode.ExtensionContext) {
        this.ctrl = vscode.tests.createTestController("varnTestController", "Varn Tests & Benchmarks");

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
            const fileId = uri.toString();
            let fileItem = this.ctrl.items.get(fileId);
            if (!fileItem) {
                fileItem = this.ctrl.createTestItem(fileId, path.basename(uri.fsPath), uri);
                this.ctrl.items.add(fileItem);
            }

            const currentChildIds = new Set<string>();
            const lines = doc.getText().split(/\r?\n/);
            let pendingTestDecorator = false;

            for (let lineIdx = 0; lineIdx < lines.length; lineIdx++) {
                const line = lines[lineIdx];
                if (/^\s*@test\b/.test(line)) {
                    pendingTestDecorator = true;
                    continue;
                }
                const match = line.match(/\bfn\s+([a-zA-Z0-9_]+)/);
                if (match) {
                    const fnName = match[1];
                    const col = line.indexOf(fnName);
                    const isTest = pendingTestDecorator || fnName.startsWith("test_");
                    pendingTestDecorator = false;
                    if (!isTest) continue;
                    const testId = `${fileId}::${fnName}`;
                    currentChildIds.add(testId);

                    let testItem = fileItem.children.get(testId);
                    if (!testItem) {
                        testItem = this.ctrl.createTestItem(testId, `▶ ${fnName}`, uri);
                        fileItem.children.add(testItem);
                    }
                    testItem.range = new vscode.Range(lineIdx, col, lineIdx, col + fnName.length);
                    continue;
                }
                if (line.trim() !== "" && !/^\s*@/.test(line)) pendingTestDecorator = false;
            }

            const parent = fileItem;
            parent.children.forEach((child) => {
                if (!currentChildIds.has(child.id)) parent.children.delete(child.id);
            });

            if (parent.children.size === 0) this.ctrl.items.delete(fileId);
        } catch {
            return;
        }
    }

    async runHandler(
        request: vscode.TestRunRequest,
        token: vscode.CancellationToken,
        isBench: boolean,
    ): Promise<void> {
        const run = this.ctrl.createTestRun(request);
        const cliPath = resolveCliPath(this.context);

        if (!cliPath) {
            void vscode.window.showErrorMessage("Varn binary not found.");
            run.end();
            return;
        }

        const queue: vscode.TestItem[] = [];
        if (request.include) request.include.forEach((item) => queue.push(item));
        else this.ctrl.items.forEach((item) => queue.push(item));

        while (queue.length > 0 && !token.isCancellationRequested) {
            const item = queue.shift();
            if (!item || request.exclude?.includes(item)) continue;
            if (item.children.size > 0 && !item.uri) continue;
            await this.runFile(item, item.uri, cliPath, run, token, isBench);
        }

        run.end();
    }

    async runFile(
        item: vscode.TestItem,
        uri: vscode.Uri | undefined,
        cliPath: string,
        run: vscode.TestRun,
        token: vscode.CancellationToken,
        isBench: boolean,
    ): Promise<void> {
        if (!uri || token.isCancellationRequested) {
            run.skipped(item);
            return;
        }
        run.started(item);
        const start = Date.now();
        const filePath = uri.fsPath;
        const args = [isBench ? "bench" : "test", filePath];

        await new Promise<void>((resolve) => {
            const proc = spawn(cliPath, args, { cwd: path.dirname(filePath) });
            let stdout = "";
            let stderr = "";

            proc.stdout.on("data", (data: Buffer) => {
                stdout += data.toString();
            });
            proc.stderr.on("data", (data: Buffer) => {
                stderr += data.toString();
            });

            proc.on("close", (code) => {
                const elapsed = Date.now() - start;
                const cleanOutput = stripAnsi(`${stdout}\n${stderr}`).trim();

                if (code === 0) {
                    if (cleanOutput) run.appendOutput(`${cleanOutput.replace(/\n/g, "\r\n")}\r\n`, undefined, item);
                    run.passed(item, elapsed);
                } else {
                    const message = new vscode.TestMessage(cleanOutput || `Process exited with code ${code}`);
                    if (item.range) message.location = new vscode.Location(uri, item.range);
                    run.failed(item, message, elapsed);
                }
                resolve();
            });

            proc.on("error", (err) => {
                run.errored(item, new vscode.TestMessage(`Failed to launch: ${err.message}`), Date.now() - start);
                resolve();
            });

            token.onCancellationRequested(() => {
                proc.kill();
                run.skipped(item);
                resolve();
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
