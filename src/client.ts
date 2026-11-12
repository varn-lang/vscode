import * as vscode from "vscode";
import {
    CloseAction,
    ErrorAction,
    LanguageClient,
    TransportKind,
    type LanguageClientOptions,
    type ServerOptions,
} from "vscode-languageclient/node";

let client: LanguageClient | undefined;

/** Create (but do not start) an LSP client. */
export function createClient(
    binaryPath: string,
    outputChannel: vscode.OutputChannel,
    args: string[] = [],
): LanguageClient {
    const serverOptions: ServerOptions = {
        command: binaryPath,
        args,
        transport: TransportKind.stdio,
    };
    const vnCfg = vscode.workspace.getConfiguration("vn");
    const clientOptions: LanguageClientOptions = {
        documentSelector: [
            { scheme: "file", language: "vn" },
            { scheme: "untitled", language: "vn" },
        ],
        synchronize: {
            fileEvents: vscode.workspace.createFileSystemWatcher("**/*.vn"),
            configurationSection: "vn",
        },
        outputChannel,
        initializationOptions: {
            vn: {
                inlayHints: { enabled: vnCfg.get("inlayHints.enabled", true) },
                codeLens: { enabled: vnCfg.get("codeLens.enabled", true) },
            },
        },
        errorHandler: {
            error: () => ({ action: ErrorAction.Continue }),
            closed: () => ({ action: CloseAction.DoNotRestart, handled: true }),
        },
    };

    client = new LanguageClient("vn", "Varn Language Server", serverOptions, clientOptions);
    registerCommandsIndividually(client);
    return client;
}

/**
 * The server announces its commands in a single registration; register them one
 * by one so a command another extension already owns does not reject the rest.
 */
function registerCommandsIndividually(languageClient: LanguageClient): void {
    try {
        const feature = languageClient.getFeature("workspace/executeCommand");
        if (!feature) return;
        const registerAll = feature.register.bind(feature);
        feature.register = (data) => {
            for (const command of data.registerOptions?.commands ?? []) {
                try {
                    registerAll({
                        id: `${data.id}:${command}`,
                        registerOptions: { ...data.registerOptions, commands: [command] },
                    });
                } catch {
                    continue;
                }
            }
        };
    } catch {
        return;
    }
}

export async function stopClient(): Promise<void> {
    if (!client) return;
    await client.stop().catch(() => {});
    await client.dispose().catch(() => {});
    client = undefined;
}

export function getClient(): LanguageClient | undefined {
    return client;
}
