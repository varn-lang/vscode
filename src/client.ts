import * as vscode from "vscode";
import {
    LanguageClient,
    TransportKind,
    type CloseAction,
    type ErrorAction,
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
    const varnCfg = vscode.workspace.getConfiguration("Varn");
    const clientOptions: LanguageClientOptions = {
        documentSelector: [
            { scheme: "file", language: "varn" },
            { scheme: "untitled", language: "varn" },
        ],
        synchronize: {
            fileEvents: vscode.workspace.createFileSystemWatcher("**/*.vn"),
            configurationSection: "Varn",
        },
        outputChannel,
        initializationOptions: {
            Varn: {
                inlayHints: { enabled: varnCfg.get("inlayHints.enabled", true) },
                codeLens: { enabled: varnCfg.get("codeLens.enabled", true) },
            },
        },
        errorHandler: {
            error: () => ({ action: 1 as ErrorAction }),
            closed: () => ({ action: 0 as CloseAction }),
        },
    };

    client = new LanguageClient("Varn", "Varn Language Server", serverOptions, clientOptions);
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
