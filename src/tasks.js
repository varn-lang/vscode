"use strict";

const vscode = require("vscode");
const { resolveCliPath } = require("./binary");

class VarnTaskProvider {
    /** @param {vscode.ExtensionContext} context */
    constructor(context) {
        this.context = context;
    }

    provideTasks() {
        return this.getTasks();
    }

    resolveTask(task) {
        return task;
    }

    getTasks() {
        const cliPath = resolveCliPath(this.context);
        if (!cliPath || !vscode.workspace.workspaceFolders) {
            return [];
        }

        const tasks = [];
        const rootFolder = vscode.workspace.workspaceFolders[0];

        // 1. Build Task
        const buildTask = new vscode.Task(
            { type: "varn", task: "build" },
            rootFolder,
            "Build (Compile)",
            "Varn",
            new vscode.ProcessExecution(cliPath, ["build"]),
            "$varn"
        );
        buildTask.group = vscode.TaskGroup.Build;
        tasks.push(buildTask);

        // 2. Check Task
        const checkTask = new vscode.Task(
            { type: "varn", task: "check" },
            rootFolder,
            "Check (Typecheck)",
            "Varn",
            new vscode.ProcessExecution(cliPath, ["check"]),
            "$varn"
        );
        checkTask.group = vscode.TaskGroup.Clean;
        tasks.push(checkTask);

        // 3. Test Task
        const testTask = new vscode.Task(
            { type: "varn", task: "test" },
            rootFolder,
            "Run All Tests",
            "Varn",
            new vscode.ProcessExecution(cliPath, ["test"]),
            "$varn"
        );
        testTask.group = vscode.TaskGroup.Test;
        tasks.push(testTask);

        return tasks;
    }
}

function registerTaskProvider(context) {
    const provider = new VarnTaskProvider(context);
    return vscode.tasks.registerTaskProvider("varn", provider);
}

module.exports = {
    registerTaskProvider
};
