import * as vscode from "vscode";
import { LanguageClient, TransportKind } from "vscode-languageclient/node";

/** @type {LanguageClient | undefined} */
let client;

/**
 * Create (but do not start) an LSP client.
 */
export function createClient(binaryPath, outputChannel, args = []) {
    const serverOptions = {
        command:   binaryPath,
        args:      args,
        transport: TransportKind.stdio,
    };
    const varnCfg = vscode.workspace.getConfiguration("Varn");
    const clientOptions = {
        documentSelector: [
            { scheme: "file", language: "varn" },
            { scheme: "untitled", language: "varn" },
        ],
        synchronize: {
            fileEvents: vscode.workspace.createFileSystemWatcher("**/*.vn"),
            configurationSection: "Varn",
        },
        outputChannel: outputChannel,
        initializationOptions: {
            Varn: {
                inlayHints: { enabled: varnCfg.get("inlayHints.enabled", true) },
                codeLens: { enabled: varnCfg.get("codeLens.enabled", true) },
            },
        },
        errorHandler: {
            error: () => ({ action: 1 }),
            closed: () => ({ action: 0 }),
        },
    };

    client = new LanguageClient("Varn", "Varn Language Server", serverOptions, clientOptions);

    try {
        const feature = client.getFeature("workspace/executeCommand");
        if (feature) {
            const registerSingle = feature.register.bind(feature);
            feature.register = (data) => {
                const commands = data?.registerOptions?.commands ?? [];
                for (const command of commands) {
                    try {
                        registerSingle({
                            id: `${data.id}:${command}`,
                            registerOptions: { ...data.registerOptions, commands: [command] },
                        });
                    } catch {}
                }
            };
        }
    } catch {}
    return client;
}

export async function stopClient() {
    if (client) {
        await client.stop().catch(() => {});
        await client.dispose().catch(() => {});
        client = undefined;
    }
}

export function getClient() {
    return client;
}
