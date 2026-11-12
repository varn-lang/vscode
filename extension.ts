import type { Event, ExtensionContext } from "vscode";
import { ExtensionManager } from "./src/manager.js";
import { VnVisualInspectorPanel } from "./src/views/visual_debugger.js";

/** What other code, including the integration tests, may observe of the extension. */
export interface VnExtensionApi {
    inspector: {
        /** Fires with the number of functions drawn each time the inspector webview renders data. */
        onDidRender: Event<number>;
    };
}

let manager: ExtensionManager | undefined;

export async function activate(context: ExtensionContext): Promise<VnExtensionApi> {
    manager = new ExtensionManager(context);
    await manager.start();
    return { inspector: { onDidRender: VnVisualInspectorPanel.onDidRender } };
}

export async function deactivate(): Promise<void> {
    if (manager) {
        await manager.stop();
        manager = undefined;
    }
}
