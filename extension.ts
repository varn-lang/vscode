import type { ExtensionContext } from "vscode";
import { ExtensionManager } from "./src/manager.js";

let manager: ExtensionManager | undefined;

export async function activate(context: ExtensionContext): Promise<void> {
    manager = new ExtensionManager(context);
    await manager.start();
}

export async function deactivate(): Promise<void> {
    if (manager) {
        await manager.stop();
        manager = undefined;
    }
}
