import * as vscode from "vscode";
import { ExtensionManager } from "./src/manager.js";

/** @type {ExtensionManager | undefined} */
let manager;

export async function activate(context) {
    manager = new ExtensionManager(context);
    await manager.start();
}

export async function deactivate() {
    if (manager) {
        await manager.stop();
        manager = undefined;
    }
}
