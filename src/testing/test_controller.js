"use strict";

const vscode = require("vscode");
const path = require("path");
const { spawn } = require("child_process");
const { resolveCliPath } = require("../binary");
const { stripAnsi } = require("../utils");

class VarnTestController {
    /** @param {vscode.ExtensionContext} context */
    constructor(context) {
        this.context = context;
        this.ctrl = vscode.tests.createTestController("varnTestController", "Varn Tests & Benchmarks");

        this.ctrl.refreshHandler = async () => {
            await this.discoverAllWorkspaceTests();
        };

        this.ctrl.resolveHandler = async (item) => {
            if (!item) {
                await this.discoverAllWorkspaceTests();
            } else if (item.uri) {
                await this.discoverDocumentTests(item.uri);
            }
        };

        this.ctrl.createRunProfile(
            "Run Tests",
            vscode.TestRunProfileKind.Run,
            (req, tok) => this.runHandler(req, tok, false),
            true
        );

        this.ctrl.createRunProfile(
            "Benchmark",
            vscode.TestRunProfileKind.Run,
            (req, tok) => this.runHandler(req, tok, true),
            false
        );

        context.subscriptions.push(
            this.ctrl,
            vscode.workspace.onDidSaveTextDocument((doc) => {
                if (doc.fileName.endsWith(".vn")) {
                    this.discoverDocumentTests(doc.uri);
                }
            }),
            vscode.workspace.onDidOpenTextDocument((doc) => {
                if (doc.fileName.endsWith(".vn")) {
                    this.discoverDocumentTests(doc.uri);
                }
            })
        );

        // Initial scan of active editor
        if (vscode.window.activeTextEditor && vscode.window.activeTextEditor.document.fileName.endsWith(".vn")) {
            this.discoverDocumentTests(vscode.window.activeTextEditor.document.uri);
        }
    }

    async discoverAllWorkspaceTests() {
        const files = await vscode.workspace.findFiles("**/*.vn", "**/node_modules/**");
        for (const file of files) {
            await this.discoverDocumentTests(file);
        }
    }

    async discoverDocumentTests(uri) {
        try {
            const doc = await vscode.workspace.openTextDocument(uri);
            const text = doc.getText();

            const fileId = uri.toString();
            let fileItem = this.ctrl.items.get(fileId);
            if (!fileItem) {
                fileItem = this.ctrl.createTestItem(fileId, path.basename(uri.fsPath), uri);
                this.ctrl.items.add(fileItem);
            }

            const currentChildIds = new Set();
            const lines = text.split(/\r?\n/);

            for (let lineIdx = 0; lineIdx < lines.length; lineIdx++) {
                const line = lines[lineIdx];
                // Match function declarations: fn test_* or fn bench_* or test_*()
                const match = line.match(/\bfn\s+(test_[a-zA-Z0-9_]+|bench_[a-zA-Z0-9_]+)/);
                if (match) {
                    const fnName = match[1];
                    const col = line.indexOf(fnName);
                    const isBench = fnName.startsWith("bench_");
                    const testId = `${fileId}::${fnName}`;
                    currentChildIds.add(testId);

                    let testItem = fileItem.children.get(testId);
                    if (!testItem) {
                        const label = isBench ? `⏱ ${fnName}` : `▶ ${fnName}`;
                        testItem = this.ctrl.createTestItem(testId, label, uri);
                        fileItem.children.add(testItem);
                    }
                    testItem.range = new vscode.Range(lineIdx, col, lineIdx, col + fnName.length);
                }
            }

            // Remove test items that no longer exist
            fileItem.children.forEach((child) => {
                if (!currentChildIds.has(child.id)) {
                    fileItem.children.delete(child.id);
                }
            });

            if (fileItem.children.size === 0) {
                this.ctrl.items.delete(fileId);
            }
        } catch {}
    }

    async runHandler(request, token, isBench) {
        const run = this.ctrl.createTestRun(request);
        const cliPath = resolveCliPath(this.context);

        if (!cliPath) {
            vscode.window.showErrorMessage("Varn binary not found.");
            run.end();
            return;
        }

        const queue = [];
        if (request.include) {
            request.include.forEach((item) => queue.push(item));
        } else {
            this.ctrl.items.forEach((item) => queue.push(item));
        }

        while (queue.length > 0 && !token.isCancellationRequested) {
            const item = queue.shift();
            if (request.exclude?.includes(item)) continue;

            if (item.children.size > 0) {
                item.children.forEach((child) => queue.push(child));
                continue;
            }

            // Execute single test
            run.started(item);
            const start = Date.now();

            const uri = item.uri;
            if (!uri) {
                run.skipped(item);
                continue;
            }

            const fnName = item.id.split("::")[1] || "";
            const filePath = uri.fsPath;
            const subCmd = isBench ? "bench" : "test";
            const args = [subCmd, filePath];
            if (fnName) {
                args.push("--filter", fnName);
            }

            await new Promise((resolve) => {
                const proc = spawn(cliPath, args, { cwd: path.dirname(filePath) });
                let stdout = "";
                let stderr = "";

                proc.stdout.on("data", (d) => { stdout += d.toString(); });
                proc.stderr.on("data", (d) => { stderr += d.toString(); });

                proc.on("close", (code) => {
                    const elapsed = Date.now() - start;
                    const cleanOutput = stripAnsi(stdout + "\n" + stderr).trim();

                    if (code === 0) {
                        if (cleanOutput) {
                            run.appendOutput(cleanOutput.replace(/\n/g, "\r\n") + "\r\n", undefined, item);
                        }
                        run.passed(item, elapsed);
                    } else {
                        const msg = new vscode.TestMessage(cleanOutput || `Process exited with code ${code}`);
                        if (item.range) {
                            msg.location = new vscode.Location(item.uri, item.range);
                        }
                        run.failed(item, msg, elapsed);
                    }
                    resolve();
                });

                proc.on("error", (err) => {
                    const msg = new vscode.TestMessage(`Failed to launch: ${err.message}`);
                    run.errored(item, msg, Date.now() - start);
                    resolve();
                });

                token.onCancellationRequested(() => {
                    proc.kill();
                    run.skipped(item);
                    resolve();
                });
            });
        }

        run.end();
    }
}

function registerTestController(context) {
    return new VarnTestController(context);
}

module.exports = {
    registerTestController
};
