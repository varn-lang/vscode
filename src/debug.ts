import * as vscode from "vscode";
import { BINARY_NOT_FOUND, resolveCliPath, resolveServerPath } from "./binary.js";

export class VnDebugAdapterFactory implements vscode.DebugAdapterDescriptorFactory {
    constructor(private readonly context: vscode.ExtensionContext) {}

    createDebugAdapterDescriptor(): vscode.DebugAdapterDescriptor | undefined {
        const cliPath = resolveCliPath(this.context);
        if (!cliPath) {
            void vscode.window.showErrorMessage(BINARY_NOT_FOUND);
            return undefined;
        }
        return new vscode.DebugAdapterExecutable(resolveServerPath(cliPath), ["dap"]);
    }
}

function launchConfiguration(program: string, name: string, stopOnEntry: boolean): vscode.DebugConfiguration {
    return { type: "vn", request: "launch", name, program, stopOnEntry };
}

export class VnDebugConfigProvider implements vscode.DebugConfigurationProvider {
    provideDebugConfigurations(): vscode.DebugConfiguration[] {
        return [launchConfiguration("${file}", "Debug Varn File", false)];
    }

    resolveDebugConfiguration(
        _folder: vscode.WorkspaceFolder | undefined,
        config: vscode.DebugConfiguration,
    ): vscode.DebugConfiguration | null {
        if (!config.type && !config.request && !config.name) {
            const editor = vscode.window.activeTextEditor;
            if (editor?.document.languageId === "vn") {
                return launchConfiguration(editor.document.fileName, "Debug Varn File", false);
            }
            return null;
        }

        if (!config.program) {
            void vscode.window.showErrorMessage("Varn debug: 'program' is required in the launch configuration.");
            return null;
        }

        if (Array.isArray(config.args) && config.args.length > 0) {
            void vscode.window.showWarningMessage(
                "Varn debug: 'args' is not supported by the debug adapter yet and will be ignored.",
            );
        }

        return launchConfiguration(config.program, config.name ?? "Debug Varn File", config.stopOnEntry ?? false);
    }
}
