"use strict";

const vscode = require("vscode");
const fs = require("fs");
const path = require("path");
const { State } = require("vscode-languageclient/node");

const { resolveCliPath, LSP_ARGS } = require("./binary");
const {
    initStatusBar,
    setLspStatus,
    setStatusProvider,
    disposeStatusBar,
    showActionsHub
} = require("./status");
const { createClient, stopClient, getClient } = require("./client");
const { VarnDebugAdapterFactory, VarnDebugConfigProvider } = require("./debug");

const { VarnStatusProvider } = require("./views/status_view");
const { VarnActionsProvider } = require("./views/actions_view");
const { VarnAstProvider } = require("./views/ast_view");

const {
    runVarnFile,
    runCheck,
    runBuild,
    runBytecode,
    runBench,
    runWithPhases,
    toggleBuildMode,
    openBytecodeViewer,
    openSSAViewer,
    openVisualInspector,
    runTest,
    runBenchmark
} = require("./commands/execution");

const {
    runPkgInstall,
    runPkgUpdate,
    runPkgAdd,
    runPkgRemove
} = require("./commands/packages");

const {
    runRepl,
    runDoctor,
    runCacheClean,
    runInitProject,
    runInstaller
} = require("./commands/utilities");

const { registerVirtualDocumentProviders } = require("./providers/virtual_documents");
const { registerTaskProvider } = require("./tasks");
const { registerTestController } = require("./testing/test_controller");

class ExtensionManager {
    constructor(context) {
        this._context = context;
        this._disposables = [];
        this._lspOutputChannel = null;
        this._watchers = [];
        this._reloadTimer = null;

        context.subscriptions.push({
            dispose: () => {
                for (const d of this._disposables) {
                    try { d.dispose(); } catch {}
                }
                this._disposables = [];
                this._stopWatchers();
            }
        });
    }

    _pushDisposable(...disposables) {
        for (const d of disposables) {
            this._disposables.push(d);
        }
    }

    async start() {
        this._startStatusBar();
        this._startLanguageServer();
        this._startDebugAdapter();
        this._startTreeViews();
        this._startCommands();
        this._startHotReload();

        const client = getClient();
        if (client) {
            await client.start().catch((err) => {
                setLspStatus("stopped");
                vscode.window.showErrorMessage(
                    `Varn Language Server failed to start: ${err?.message ?? err}`
                );
            });
        }
    }

    async stop() {
        this._reloadTimer = null;
        await stopClient();
        for (const d of this._disposables) {
            try { d.dispose(); } catch {}
        }
        this._disposables.length = 0;
        disposeStatusBar();
    }

    async restart() {
        await this.stop();
        await this.start();
    }

    // ── Status bar ─────────────────────────────────────────────────────

    _startStatusBar() {
        initStatusBar(this._context);
    }

    // ── Language Server ────────────────────────────────────────────────

    _startLanguageServer() {
        this._lspOutputChannel = vscode.window.createOutputChannel("Varn Language Server");
        this._pushDisposable(this._lspOutputChannel);

        const lspPath = resolveCliPath(this._context);
        if (!lspPath) {
            setLspStatus("error");
            vscode.window.showErrorMessage(
                "vn binary not found. " +
                "Build with `cargo build --release --bin vn` or set Varn.cli.path."
            );
            return;
        }
        this._lspPath = lspPath;

        const client = createClient(lspPath, this._lspOutputChannel, LSP_ARGS);
        client.onDidChangeState(({ newState }) => {
            if      (newState === State.Running)  setLspStatus("running");
            else if (newState === State.Starting) setLspStatus("starting");
            else                                  setLspStatus("stopped");
        });
    }

    // ── Debug adapter ──────────────────────────────────────────────────

    _startDebugAdapter() {
        this._pushDisposable(
            vscode.debug.registerDebugAdapterDescriptorFactory(
                "Varn", new VarnDebugAdapterFactory(this._context)
            ),
            vscode.debug.registerDebugConfigurationProvider(
                "Varn", new VarnDebugConfigProvider()
            )
        );
    }

    // ── Tree views ─────────────────────────────────────────────────────

    _startTreeViews() {
        const statusProvider = new VarnStatusProvider(this._context);
        setStatusProvider(statusProvider);
        const actionsProvider = new VarnActionsProvider(this._context);
        const astProvider = new VarnAstProvider(this._context);

        this._pushDisposable(
            vscode.window.registerTreeDataProvider("varn-status", statusProvider),
            vscode.window.registerTreeDataProvider("varn-actions", actionsProvider),
            vscode.window.registerTreeDataProvider("varn-ast", astProvider)
        );

        this._pushDisposable(
            vscode.window.onDidChangeActiveTextEditor(() => astProvider.refresh(), null, this._context.subscriptions),
            vscode.workspace.onDidSaveTextDocument((doc) => {
                if (doc.fileName.endsWith(".vn")) astProvider.refresh();
            }, null, this._context.subscriptions)
        );

        astProvider.refresh();
    }

    // ── Commands ───────────────────────────────────────────────────────

    _startCommands() {
        const ctx = this._context;

        // Register testing and virtual doc providers
        const virtualDocs = registerVirtualDocumentProviders();
        const taskProvider = registerTaskProvider(ctx);
        const testController = registerTestController(ctx);

        const registerCmd = (name, handler) => {
            const lowerName = name.startsWith("Varn.") ? `varn.${name.slice(5)}` : name;
            const upperName = name.startsWith("varn.") ? `Varn.${name.slice(5)}` : name;
            return [
                vscode.commands.registerCommand(lowerName, handler),
                vscode.commands.registerCommand(upperName, handler)
            ];
        };

        this._pushDisposable(
            virtualDocs,
            taskProvider,
            testController,

            ...registerCmd("varn.reloadExtension", async () => {
                await this.restart();
                vscode.window.showInformationMessage("Varn Extension reloaded");
            }),

            ...registerCmd("varn.showActionsHub", () => {
                showActionsHub(ctx);
            }),

            ...registerCmd("varn.restartServer", async () => {
                await stopClient();
                const lspPath = resolveCliPath(ctx);
                if (!lspPath) return;
                setLspStatus("starting");
                const ch = this._lspOutputChannel
                    || vscode.window.createOutputChannel("Varn Language Server");
                const client = createClient(lspPath, ch, LSP_ARGS);
                client.onDidChangeState(({ newState }) => {
                    if      (newState === State.Running)  setLspStatus("running");
                    else if (newState === State.Starting) setLspStatus("starting");
                    else                                  setLspStatus("stopped");
                });
                await client.start();
            }),

            ...registerCmd("varn.stopServer", async () => {
                await stopClient();
                setLspStatus("stopped");
            }),

            ...registerCmd("varn.showServerLog", () => {
                getClient()?.outputChannel.show();
            }),

            ...registerCmd("varn.runFile", (uri) => {
                runVarnFile(ctx, uri, { terminal: false });
            }),

            ...registerCmd("varn.runFileInTerminal", (uri) => {
                runVarnFile(ctx, uri, { terminal: true });
            }),

            ...registerCmd("varn.runMain", (uri) => {
                runVarnFile(ctx, uri, { terminal: false });
            }),

            ...registerCmd("varn.runTest", (uri, testName) => {
                runTest(ctx, uri, testName);
            }),

            ...registerCmd("varn.runBenchmark", (uri, benchName) => {
                runBenchmark(ctx, uri, benchName);
            }),

            ...registerCmd("varn.checkFile", (uri) => {
                runCheck(ctx, uri);
            }),

            ...registerCmd("varn.buildFile", (uri) => {
                runBuild(ctx, uri);
            }),

            ...registerCmd("varn.showBytecode", (uri) => {
                runBytecode(ctx, uri);
            }),

            ...registerCmd("varn.openBytecodeViewer", (uri) => {
                openBytecodeViewer(ctx, uri);
            }),

            ...registerCmd("varn.showSSA", (uri) => {
                const { runWithDebugPhase } = require("./commands/execution");
                runWithDebugPhase(ctx, uri, ["bytecode"], "SSA");
            }),

            ...registerCmd("varn.openSSAViewer", (uri) => {
                openSSAViewer(ctx, uri);
            }),

            ...registerCmd("varn.openVisualInspector", (uri) => {
                openVisualInspector(ctx, uri);
            }),

            ...registerCmd("varn.showAst", (uri) => {
                const { runWithDebugPhase } = require("./commands/execution");
                runWithDebugPhase(ctx, uri, ["ast"], "AST");
            }),

            ...registerCmd("varn.showTokens", (uri) => {
                const { runWithDebugPhase } = require("./commands/execution");
                runWithDebugPhase(ctx, uri, ["tokens"], "Tokens");
            }),

            ...registerCmd("varn.benchFile", (uri) => {
                runBench(ctx, uri);
            }),

            ...registerCmd("varn.runWithPhases", (uri) => {
                runWithPhases(ctx, uri);
            }),

            ...registerCmd("varn.pkgInstall", () => {
                runPkgInstall(ctx);
            }),

            ...registerCmd("varn.pkgUpdate", () => {
                runPkgUpdate(ctx);
            }),

            ...registerCmd("varn.pkgAdd", () => {
                runPkgAdd(ctx);
            }),

            ...registerCmd("varn.pkgRemove", () => {
                runPkgRemove(ctx);
            }),

            ...registerCmd("varn.runRepl", () => {
                runRepl(ctx);
            }),

            ...registerCmd("varn.doctor", () => {
                runDoctor(ctx);
            }),

            ...registerCmd("varn.cacheClean", () => {
                runCacheClean(ctx);
            }),

            ...registerCmd("varn.initProject", () => {
                runInitProject(ctx);
            }),

            ...registerCmd("varn.installRuntime", () => {
                runInstaller(ctx);
            }),

            ...registerCmd("varn.toggleBuildMode", () => {
                toggleBuildMode();
            }),

            ...registerCmd("varn.findReferences", async (uri, line, col) => {
                if (line !== undefined && col !== undefined) {
                    const pos = new vscode.Position(line, col);
                    const targetUri = typeof uri === "string" ? vscode.Uri.parse(uri) : uri;
                    await vscode.commands.executeCommand("editor.action.findReferences", targetUri, pos);
                }
            }),

            ...registerCmd("varn.selectEditorRange", (line) => {
                const editor = vscode.window.activeTextEditor;
                if (!editor) return;
                const range = editor.document.lineAt(line).range;
                editor.selection = new vscode.Selection(range.start, range.start);
                editor.revealRange(range, vscode.TextEditorRevealType.InCenterIfOutsideViewport);
            }),

            { dispose: () => stopClient() }
        );
    }

    // ── Hot Reload ─────────────────────────────────────────────────────

    _startHotReload() {
        this._stopWatchers();

        const config = vscode.workspace.getConfiguration("Varn");

        if (config.get("hotReload.enabled", true)) {
            const extPath = this._context.extensionPath;
            const srcPath = path.join(extPath, "src");

            const reloadFilter = (filename) => {
                if (!filename) return false;
                if (filename.endsWith(".js")) return true;
                return false;
            };

            try {
                const extWatcher = fs.watch(extPath, (eventType, filename) => {
                    if (reloadFilter(filename)) this._scheduleReload();
                });
                this._watchers.push(extWatcher);
            } catch {}

            try {
                const srcWatcher = fs.watch(srcPath, { recursive: true }, (eventType, filename) => {
                    if (reloadFilter(filename)) this._scheduleReload();
                });
                this._watchers.push(srcWatcher);
            } catch {}
        }

        // Rebuilding `vn` (e.g. via scripts/dev-build.ps1) replaces the exe
        // the server runs from; nothing used to notice, so every rebuild
        // needed a manual "Varn: Restart Language Server". Watching its
        // directory and matching on the exact filename catches that the same
        // way the .js watchers above catch a source edit — one mechanism,
        // one debounce, reused rather than duplicated.
        if (config.get("hotReload.watchBinary", true) && this._lspPath) {
            const binDir = path.dirname(this._lspPath);
            const binName = path.basename(this._lspPath);
            try {
                const binWatcher = fs.watch(binDir, (eventType, filename) => {
                    if (filename === binName) this._scheduleReload();
                });
                this._watchers.push(binWatcher);
            } catch {}
        }
    }

    _stopWatchers() {
        for (const w of this._watchers) {
            try { w.close(); } catch {}
        }
        this._watchers.length = 0;
    }

    _scheduleReload() {
        if (this._reloadTimer) {
            clearTimeout(this._reloadTimer);
        }
        this._reloadTimer = setTimeout(() => {
            this._reloadTimer = null;
            this.restart();
        }, 300);
    }
}

module.exports = { ExtensionManager };
