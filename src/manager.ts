import * as vscode from "vscode";
import * as fs from "node:fs";
import * as path from "node:path";
import { State, type LanguageClient } from "vscode-languageclient/node";

import { resolveCliPath, resolveServerPath, LSP_ARGS } from "./binary.js";
import { initStatusBar, setLspStatus, setStatusProvider, disposeStatusBar } from "./status.js";
import { showActionsHub } from "./commands/hub.js";
import { createClient, stopClient, getClient } from "./client.js";
import { initLanguageFeatures, setLanguageState, refreshLanguageStatus } from "./language.js";
import { errorMessage } from "./utils.js";
import { VarnDebugAdapterFactory, VarnDebugConfigProvider } from "./debug.js";

import { VarnStatusProvider } from "./views/status_view.js";
import { VarnActionsProvider } from "./views/actions_view.js";
import { VarnAstProvider } from "./views/ast_view.js";

import {
    runVarnFile,
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
import { VarnStdFileSystemProvider, registerStdlibFeatures, openStdModule } from "./features/stdlibFs.js";

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
                    if (event.affectsConfiguration("Varn")) refreshLanguageStatus();
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
            void vscode.window.showErrorMessage(
                "vn binary not found. Build with `cargo build --release --bin vn` or set Varn.cli.path.",
            );
            return;
        }
        this.lspPath = lspPath;

        this.trackClientState(createClient(resolveServerPath(lspPath), this.lspOutputChannel, LSP_ARGS));
    }

    private startDebugAdapter(): void {
        this.pushDisposable(
            vscode.debug.registerDebugAdapterDescriptorFactory("Varn", new VarnDebugAdapterFactory(this.context)),
            vscode.debug.registerDebugConfigurationProvider("Varn", new VarnDebugConfigProvider()),
        );
    }

    private startTreeViews(): void {
        const statusProvider = new VarnStatusProvider(this.context);
        setStatusProvider(statusProvider);
        const actionsProvider = new VarnActionsProvider(this.context);
        const astProvider = new VarnAstProvider(this.context);

        this.pushDisposable(
            vscode.window.registerTreeDataProvider("varn-status", statusProvider),
            vscode.window.registerTreeDataProvider("varn-actions", actionsProvider),
            vscode.window.registerTreeDataProvider("varn-ast", astProvider),
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
        const stdFs = new VarnStdFileSystemProvider();
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

            registerCmd("varn.openStdModule", () => openStdModule()),

            registerCmd("varn.reloadExtension", async () => {
                await this.restart();
                void vscode.window.showInformationMessage("Varn Extension reloaded");
            }),

            registerCmd("varn.showActionsHub", () => showActionsHub(ctx)),

            registerCmd("varn.restartServer", async () => {
                await stopClient();
                const lspPath = resolveCliPath(ctx);
                if (!lspPath) {
                    void vscode.window.showErrorMessage("vn binary not found. Set Varn.cli.path.");
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

            registerCmd("varn.stopServer", async () => {
                await stopClient();
                setLspStatus("stopped");
            }),

            registerCmd("varn.showServerLog", () => {
                getClient()?.outputChannel.show();
            }),

            registerCmd("varn.runFile", (uri?: CommandTarget) => runVarnFile(ctx, uri, { terminal: false })),
            registerCmd("varn.runFileInTerminal", (uri?: CommandTarget) => runVarnFile(ctx, uri, { terminal: true })),
            registerCmd("varn.runMain", (uri?: CommandTarget) => runVarnFile(ctx, uri, { terminal: false })),
            registerCmd("varn.runTest", (uri?: CommandTarget, testName?: string) => runTest(ctx, uri, testName)),
            registerCmd("varn.runBenchmark", (uri?: CommandTarget, benchName?: string) =>
                runBenchmark(ctx, uri, benchName),
            ),
            registerCmd("varn.checkFile", (uri?: CommandTarget) => runCheck(ctx, uri)),
            registerCmd("varn.buildFile", (uri?: CommandTarget) => runBuild(ctx, uri)),
            registerCmd("varn.showBytecode", (uri?: CommandTarget) => runBytecode(ctx, uri)),
            registerCmd("varn.openBytecodeViewer", (uri?: CommandTarget) => openBytecodeViewer(ctx, uri)),
            registerCmd("varn.showSSA", (uri?: CommandTarget) => runWithDebugPhase(ctx, uri, ["bytecode"], "SSA")),
            registerCmd("varn.openSSAViewer", (uri?: CommandTarget) => openSSAViewer(ctx, uri)),
            registerCmd("varn.diffBytecode", (uri?: CommandTarget) => diffBytecode(ctx, uri)),
            registerCmd("varn.openVisualInspector", (uri?: CommandTarget) => openVisualInspector(ctx, uri)),
            registerCmd("varn.showAst", (uri?: CommandTarget) => runWithDebugPhase(ctx, uri, ["ast"], "AST")),
            registerCmd("varn.showTokens", (uri?: CommandTarget) => runWithDebugPhase(ctx, uri, ["tokens"], "Tokens")),
            registerCmd("varn.benchFile", (uri?: CommandTarget) => runBench(ctx, uri)),
            registerCmd("varn.runWithPhases", (uri?: CommandTarget) => runWithPhases(ctx, uri)),

            registerCmd("varn.pkgInstall", () => runPkgInstall(ctx)),
            registerCmd("varn.pkgUpdate", () => runPkgUpdate(ctx)),
            registerCmd("varn.pkgAdd", () => runPkgAdd(ctx)),
            registerCmd("varn.pkgRemove", () => runPkgRemove(ctx)),
            registerCmd("varn.runRepl", () => runRepl(ctx)),
            registerCmd("varn.doctor", () => runDoctor(ctx)),
            registerCmd("varn.cacheClean", () => runCacheClean(ctx)),
            registerCmd("varn.initProject", () => runInitProject(ctx)),
            registerCmd("varn.installRuntime", () => runInstaller(ctx)),
            registerCmd("varn.toggleBuildMode", () => toggleBuildMode()),

            registerCmd("varn.findReferences", async (uri?: CommandTarget, line?: number, col?: number) => {
                if (line === undefined || col === undefined || !uri) return;
                const targetUri = typeof uri === "string" ? vscode.Uri.parse(uri) : uri;
                await vscode.commands.executeCommand(
                    "editor.action.findReferences",
                    targetUri,
                    new vscode.Position(line, col),
                );
            }),

            registerCmd("varn.selectEditorRange", (line: number) => {
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

        const config = vscode.workspace.getConfiguration("Varn");

        if (config.get("hotReload.enabled", true)) {
            const extPath = this.context.extensionPath;
            const srcPath = path.join(extPath, "src");
            const isScript = (filename: string | null): boolean => !!filename && filename.endsWith(".js");

            try {
                this.watchers.push(
                    fs.watch(extPath, (_event, filename) => {
                        if (isScript(filename)) this.scheduleReload();
                    }),
                );
            } catch {
                // the extension folder may not be watchable
            }

            try {
                this.watchers.push(
                    fs.watch(srcPath, { recursive: true }, (_event, filename) => {
                        if (isScript(filename)) this.scheduleReload();
                    }),
                );
            } catch {
                // the source folder does not exist in a packaged extension
            }
        }

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
