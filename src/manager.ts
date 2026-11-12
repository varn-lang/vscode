import * as vscode from "vscode";
import * as fs from "node:fs";
import * as path from "node:path";
import { State, type LanguageClient } from "vscode-languageclient/node";

import { BINARY_NOT_FOUND, resolveCliPath, resolveServerPath, LSP_ARGS } from "./binary.js";
import { initStatusBar, setLspStatus, setStatusProvider, disposeStatusBar } from "./status.js";
import { showActionsHub } from "./commands/hub.js";
import { createClient, stopClient, getClient } from "./client.js";
import { initLanguageFeatures, setLanguageState, refreshLanguageStatus } from "./language.js";
import { errorMessage } from "./utils.js";
import { VnDebugAdapterFactory, VnDebugConfigProvider } from "./debug.js";

import { VnStatusProvider } from "./views/status_view.js";
import { VnActionsProvider } from "./views/actions_view.js";
import { VnAstProvider } from "./views/ast_view.js";

import {
    runVnFile,
    runCheck,
    runBuild,
    runBytecode,
    runBench,
    runWithPhases,
    runWithDebugPhase,
    toggleBuildMode,
    openBytecodeViewer,
    openSSAViewer,
    diffBytecode,
    openVisualInspector,
    runTest,
    runBenchmark,
} from "./commands/execution.js";

import { runPkgInstall, runPkgUpdate, runPkgAdd, runPkgRemove } from "./commands/packages.js";
import { runRepl, runDoctor, runCacheClean, runInitProject, runInstaller } from "./commands/utilities.js";

import { registerVirtualDocumentProviders } from "./providers/virtual_documents.js";
import { registerTaskProvider } from "./tasks.js";
import { registerTestController } from "./testing/test_controller.js";
import { registerVisualInspectorSerializer } from "./views/visual_debugger.js";
import { registerInspectEditors } from "./editors/inspect.js";
import { VnStdFileSystemProvider, registerStdlibFeatures, openStdModule } from "./features/stdlibFs.js";

type CommandTarget = vscode.Uri | string | undefined;

export class ExtensionManager {
    private disposables: vscode.Disposable[] = [];
    private lspOutputChannel: vscode.OutputChannel | null = null;
    private lspPath: string | undefined;
    private watchers: fs.FSWatcher[] = [];
    private reloadTimer: ReturnType<typeof setTimeout> | null = null;

    constructor(private readonly context: vscode.ExtensionContext) {
        context.subscriptions.push({
            dispose: () => {
                for (const disposable of this.disposables) {
                    try {
                        disposable.dispose();
                    } catch {
                        continue;
                    }
                }
                this.disposables = [];
                this.stopWatchers();
            },
        });
        context.subscriptions.push(vscode.workspace.onDidGrantWorkspaceTrust(() => void this.restart()));
    }

    private pushDisposable(...disposables: vscode.Disposable[]): void {
        this.disposables.push(...disposables);
    }

    async start(): Promise<void> {
        this.startStatusBar();
        this.startLanguageServer();
        this.startDebugAdapter();
        this.startTreeViews();
        this.startCommands();
        this.startHotReload();
        this.startLanguageFeatures();

        const client = getClient();
        if (client) {
            await client.start().catch((err: unknown) => {
                setLspStatus("stopped");
                void vscode.window.showErrorMessage(`Varn Language Server failed to start: ${errorMessage(err)}`);
            });
        }
    }

    async stop(): Promise<void> {
        if (this.reloadTimer) {
            clearTimeout(this.reloadTimer);
            this.reloadTimer = null;
        }
        this.stopWatchers();
        await stopClient();
        for (const disposable of this.disposables) {
            try {
                disposable.dispose();
            } catch {
                continue;
            }
        }
        this.disposables.length = 0;
        disposeStatusBar();
    }

    async restart(): Promise<void> {
        await this.stop();
        await this.start();
    }

    private startStatusBar(): void {
        initStatusBar(this.context);
    }

    private startLanguageFeatures(): void {
        try {
            initLanguageFeatures(this.context);
            this.pushDisposable(
                vscode.workspace.onDidChangeConfiguration((event) => {
                    if (event.affectsConfiguration("vn")) refreshLanguageStatus();
                }),
            );
        } catch {
            return;
        }
    }

    private trackClientState(client: LanguageClient): void {
        client.onDidChangeState(({ newState }) => {
            if (newState === State.Running) {
                setLspStatus("running");
                setLanguageState("running");
            } else if (newState === State.Starting) {
                setLspStatus("starting");
                setLanguageState("starting");
            } else {
                setLspStatus("stopped");
                setLanguageState("stopped");
            }
        });
    }

    private startLanguageServer(): void {
        this.lspOutputChannel = vscode.window.createOutputChannel("Varn Language Server");
        this.pushDisposable(this.lspOutputChannel);

        const lspPath = resolveCliPath(this.context);
        if (!lspPath) {
            setLspStatus("error");
            void vscode.window.showErrorMessage(BINARY_NOT_FOUND);
            return;
        }
        this.lspPath = lspPath;

        this.trackClientState(createClient(resolveServerPath(lspPath), this.lspOutputChannel, LSP_ARGS));
    }

    private startDebugAdapter(): void {
        this.pushDisposable(
            vscode.debug.registerDebugAdapterDescriptorFactory("vn", new VnDebugAdapterFactory(this.context)),
            vscode.debug.registerDebugConfigurationProvider("vn", new VnDebugConfigProvider()),
        );
    }

    private startTreeViews(): void {
        const statusProvider = new VnStatusProvider(this.context);
        setStatusProvider(statusProvider);
        const actionsProvider = new VnActionsProvider(this.context);
        const astProvider = new VnAstProvider(this.context);
        const astView = vscode.window.createTreeView("vn-ast", {
            treeDataProvider: astProvider,
            showCollapseAll: true,
        });
        astProvider.attach(astView);

        this.pushDisposable(
            vscode.window.registerTreeDataProvider("vn-status", statusProvider),
            vscode.window.registerTreeDataProvider("vn-actions", actionsProvider),
            astView,
        );

        this.pushDisposable(
            vscode.window.onDidChangeActiveTextEditor(() => void astProvider.refresh(), null, this.context.subscriptions),
            vscode.workspace.onDidSaveTextDocument(
                (doc) => {
                    if (doc.fileName.endsWith(".vn")) void astProvider.refresh();
                },
                null,
                this.context.subscriptions,
            ),
        );

        void astProvider.refresh();
    }

    private startCommands(): void {
        const ctx = this.context;

        const virtualDocs = registerVirtualDocumentProviders();
        const taskProvider = registerTaskProvider(ctx);
        const testController = registerTestController(ctx);
        const visualSerializer = registerVisualInspectorSerializer(ctx.extensionUri);
        const inspectEditors = registerInspectEditors(ctx);
        const stdFs = new VnStdFileSystemProvider();
        const stdlibFeatures = registerStdlibFeatures(ctx, stdFs);

        const registerCmd = <Args extends unknown[]>(
            name: string,
            handler: (...args: Args) => unknown,
        ): vscode.Disposable => vscode.commands.registerCommand(name, handler);

        this.pushDisposable(
            virtualDocs,
            taskProvider,
            testController,
            visualSerializer,
            inspectEditors,
            stdlibFeatures,

            registerCmd("vn.openStdModule", () => openStdModule()),

            registerCmd("vn.reloadExtension", async () => {
                await this.restart();
                void vscode.window.showInformationMessage("Varn Extension reloaded");
            }),

            registerCmd("vn.showActionsHub", () => showActionsHub(ctx)),

            registerCmd("vn.restartServer", async () => {
                await stopClient();
                const lspPath = resolveCliPath(ctx);
                if (!lspPath) {
                    void vscode.window.showErrorMessage(BINARY_NOT_FOUND);
                    return;
                }
                setLspStatus("starting");
                const channel = this.lspOutputChannel ?? vscode.window.createOutputChannel("Varn Language Server");
                const client = createClient(resolveServerPath(lspPath), channel, LSP_ARGS);
                this.trackClientState(client);
                try {
                    await client.start();
                } catch (err) {
                    setLspStatus("stopped");
                    void vscode.window.showErrorMessage(`Varn Language Server failed to start: ${errorMessage(err)}`);
                }
            }),

            registerCmd("vn.stopServer", async () => {
                await stopClient();
                setLspStatus("stopped");
            }),

            registerCmd("vn.showServerLog", () => {
                getClient()?.outputChannel.show();
            }),

            registerCmd("vn.runFile", (uri?: CommandTarget) => runVnFile(ctx, uri, { terminal: false })),
            registerCmd("vn.runFileInTerminal", (uri?: CommandTarget) => runVnFile(ctx, uri, { terminal: true })),
            registerCmd("vn.runMain", (uri?: CommandTarget) => runVnFile(ctx, uri, { terminal: false })),
            registerCmd("vn.runTest", (uri?: CommandTarget, testName?: string) => runTest(ctx, uri, testName)),
            registerCmd("vn.runBenchmark", (uri?: CommandTarget, benchName?: string) =>
                runBenchmark(ctx, uri, benchName),
            ),
            registerCmd("vn.checkFile", (uri?: CommandTarget) => runCheck(ctx, uri)),
            registerCmd("vn.buildFile", (uri?: CommandTarget) => runBuild(ctx, uri)),
            registerCmd("vn.showBytecode", (uri?: CommandTarget) => runBytecode(ctx, uri)),
            registerCmd("vn.openBytecodeViewer", (uri?: CommandTarget) => openBytecodeViewer(ctx, uri)),
            registerCmd("vn.showSSA", (uri?: CommandTarget) => runWithDebugPhase(ctx, uri, ["bytecode"], "SSA")),
            registerCmd("vn.openSSAViewer", (uri?: CommandTarget) => openSSAViewer(ctx, uri)),
            registerCmd("vn.diffBytecode", (uri?: CommandTarget) => diffBytecode(ctx, uri)),
            registerCmd("vn.openVisualInspector", (uri?: CommandTarget) => openVisualInspector(ctx, uri)),
            registerCmd("vn.showAst", (uri?: CommandTarget) => runWithDebugPhase(ctx, uri, ["ast"], "AST")),
            registerCmd("vn.showTokens", (uri?: CommandTarget) => runWithDebugPhase(ctx, uri, ["tokens"], "Tokens")),
            registerCmd("vn.benchFile", (uri?: CommandTarget) => runBench(ctx, uri)),
            registerCmd("vn.runWithPhases", (uri?: CommandTarget) => runWithPhases(ctx, uri)),

            registerCmd("vn.pkgInstall", () => runPkgInstall(ctx)),
            registerCmd("vn.pkgUpdate", () => runPkgUpdate(ctx)),
            registerCmd("vn.pkgAdd", () => runPkgAdd(ctx)),
            registerCmd("vn.pkgRemove", () => runPkgRemove(ctx)),
            registerCmd("vn.runRepl", () => runRepl(ctx)),
            registerCmd("vn.doctor", () => runDoctor(ctx)),
            registerCmd("vn.cacheClean", () => runCacheClean(ctx)),
            registerCmd("vn.initProject", () => runInitProject(ctx)),
            registerCmd("vn.installRuntime", () => runInstaller(ctx)),
            registerCmd("vn.toggleBuildMode", () => toggleBuildMode()),

            registerCmd("vn.findReferences", async (uri?: CommandTarget, line?: number, col?: number) => {
                if (line === undefined || col === undefined || !uri) return;
                const targetUri = typeof uri === "string" ? vscode.Uri.parse(uri) : uri;
                await vscode.commands.executeCommand(
                    "editor.action.findReferences",
                    targetUri,
                    new vscode.Position(line, col),
                );
            }),

            registerCmd("vn.selectEditorRange", (line: number) => {
                const editor = vscode.window.activeTextEditor;
                if (!editor) return;
                const range = editor.document.lineAt(line).range;
                editor.selection = new vscode.Selection(range.start, range.start);
                editor.revealRange(range, vscode.TextEditorRevealType.InCenterIfOutsideViewport);
            }),

            new vscode.Disposable(() => void stopClient()),
        );
    }

    private startHotReload(): void {
        this.stopWatchers();

        const config = vscode.workspace.getConfiguration("vn");

        if (config.get("hotReload.watchBinary", true) && this.lspPath) {
            const binDir = path.dirname(this.lspPath);
            const binName = path.basename(this.lspPath);
            try {
                this.watchers.push(
                    fs.watch(binDir, (_event, filename) => {
                        if (filename === binName) this.scheduleReload();
                    }),
                );
            } catch {
                // the binary folder may not be watchable
            }
        }
    }

    private stopWatchers(): void {
        for (const watcher of this.watchers) {
            try {
                watcher.close();
            } catch {
                continue;
            }
        }
        this.watchers.length = 0;
    }

    private scheduleReload(): void {
        if (this.reloadTimer) clearTimeout(this.reloadTimer);
        this.reloadTimer = setTimeout(() => {
            this.reloadTimer = null;
            void this.restart();
        }, 800);
    }
}
