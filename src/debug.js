import * as vscode from "vscode";
import { resolveCliPath, resolveServerPath } from "./binary.js";

export class VarnDebugAdapterFactory {
    /** @param {vscode.ExtensionContext} context */
    constructor(context) { this._context = context; }

    /** @param {vscode.DebugSession} session */
    createDebugAdapterDescriptor(_session) {
        const cliPath = resolveCliPath(this._context);
        if (!cliPath) {
            vscode.window.showErrorMessage(
                "Varn binary not found. " +
                "Build with `cargo build --release --bin vn` or set Varn.cli.path."
            );
            return undefined;
        }
        return new vscode.DebugAdapterExecutable(resolveServerPath(cliPath), ["dap"]);
    }
}

export class VarnDebugConfigProvider {
    provideDebugConfigurations() {
        return [
            {
                type:        "Varn",
                request:     "launch",
                name:        "Debug Varn File",
                program:     "${file}",
                stopOnEntry: false,
            },
        ];
    }

    resolveDebugConfiguration(_folder, config) {
        if (!config.type && !config.request && !config.name) {
            const editor = vscode.window.activeTextEditor;
            if (editor && editor.document.languageId === "varn") {
                return {
                    type:        "Varn",
                    request:     "launch",
                    name:        "Debug Varn File",
                    program:     editor.document.fileName,
                    stopOnEntry: false,
                };
            }
            return null;
        }

        if (!config.program) {
            vscode.window.showErrorMessage(
                "Varn debug: 'program' is required in the launch configuration."
            );
            return null;
        }

        if (Array.isArray(config.args) && config.args.length > 0) {
            vscode.window.showWarningMessage(
                "Varn debug: 'args' is not supported by the debug adapter yet and will be ignored."
            );
        }

        return {
            type:        "Varn",
            request:     "launch",
            name:        config.name ?? "Debug Varn File",
            program:     config.program,
            stopOnEntry: config.stopOnEntry ?? false,
        };
    }
}
