import * as vscode from "vscode";
import { resolveCliPath } from "./binary.js";

interface VarnTaskDefinition extends vscode.TaskDefinition {
    type: "vn";
    task: "build" | "check" | "test";
}

export class VarnTaskProvider implements vscode.TaskProvider {
    constructor(private readonly context: vscode.ExtensionContext) {}

    provideTasks(): vscode.Task[] {
        return this.getTasks();
    }

    resolveTask(task: vscode.Task): vscode.Task {
        return task;
    }

    getTasks(): vscode.Task[] {
        const cliPath = resolveCliPath(this.context);
        const rootFolder = vscode.workspace.workspaceFolders?.[0];
        if (!cliPath || !rootFolder) return [];

        const make = (
            task: VarnTaskDefinition["task"],
            name: string,
            group: vscode.TaskGroup,
        ): vscode.Task => {
            const definition: VarnTaskDefinition = { type: "vn", task };
            const built = new vscode.Task(
                definition,
                rootFolder,
                name,
                "Varn",
                new vscode.ProcessExecution(cliPath, [task]),
                "$vn",
            );
            built.group = group;
            return built;
        };

        return [
            make("build", "Build (Compile)", vscode.TaskGroup.Build),
            make("check", "Check (Typecheck)", vscode.TaskGroup.Build),
            make("test", "Run All Tests", vscode.TaskGroup.Test),
        ];
    }
}

export function registerTaskProvider(context: vscode.ExtensionContext): vscode.Disposable {
    return vscode.tasks.registerTaskProvider("vn", new VarnTaskProvider(context));
}
