import * as vscode from "vscode";
import * as os from "node:os";
import * as path from "node:path";
import * as fs from "node:fs";
import { BIN_EXT } from "./constants.js";
import { varnHomeBinPath, findOnPath } from "./utils.js";

/**
 * Generate a list of candidate paths for a binary.
 * @param {vscode.ExtensionContext} context
 * @param {string} binName
 * @returns {string[]}
 */
export function getBinaryCandidates(context, binName) {
    const candidates = [];
    const mode = vscode.workspace.getConfiguration("Varn").get("buildMode", "release");

    // 1. VARN_HOME
    const homeBin = varnHomeBinPath(binName);
    if (homeBin) candidates.push(homeBin);

    // 2. Workspace folders (check target/release and target/debug)
    if (vscode.workspace.workspaceFolders) {
        for (const folder of vscode.workspace.workspaceFolders) {
            const root = folder.uri.fsPath;
            if (mode === "release") {
                candidates.push(path.join(root, "target", "release", binName));
                candidates.push(path.join(root, "target", "debug",   binName));
            } else {
                candidates.push(path.join(root, "target", "debug",   binName));
                candidates.push(path.join(root, "target", "release", binName));
            }
        }
    }

    // 3. Sibling varn-lang (for development)
    const extRoot = path.resolve(context.extensionPath, "..", "varn-lang");
    if (mode === "release") {
        candidates.push(path.join(extRoot, "target", "release", binName));
        candidates.push(path.join(extRoot, "target", "debug",   binName));
    } else {
        candidates.push(path.join(extRoot, "target", "debug",   binName));
        candidates.push(path.join(extRoot, "target", "release", binName));
    }

    return candidates;
}

/**
 * Resolve the Varn binary.
 * @param {vscode.ExtensionContext} context
 * @returns {string | undefined}
 */
export function resolveCliPath(context) {
    const override = vscode.workspace.getConfiguration("Varn").get("cli.path");
    if (override) {
        if (fs.existsSync(override)) return override;
        vscode.window.showWarningMessage(`Varn.cli.path not found: ${override}. Falling back to auto-detect.`);
    }

    const binName = `vn${BIN_EXT}`;
    const found = getBinaryCandidates(context, binName).find((p) => fs.existsSync(p));
    if (found) return found;

    return findOnPath(binName);
}

export function resolveServerPath(cliPath) {
    try {
        const tag = fs.statSync(cliPath).mtimeMs.toString(36).replace(".", "");
        const dir = path.join(os.tmpdir(), "varn-dev-server");
        const dest = path.join(dir, `vn-${tag}${BIN_EXT}`);
        if (!fs.existsSync(dest)) {
            fs.mkdirSync(dir, { recursive: true });
            fs.copyFileSync(cliPath, dest);
            pruneDevCopies(dir, dest);
        }
        return dest;
    } catch {}
    return cliPath;
}

function pruneDevCopies(dir, keep) {
    let entries;
    try {
        entries = fs.readdirSync(dir);
    } catch {
        return;
    }
    const copies = entries
        .filter((n) => n.startsWith("vn-") && n.endsWith(BIN_EXT))
        .map((n) => path.join(dir, n))
        .filter((p) => p !== keep)
        .sort()
        .reverse();
    for (const extra of copies.slice(1)) {
        try {
            fs.unlinkSync(extra);
        } catch {}
    }
}

/**
 * Arguments that turn the Varn CLI into a language server on stdio.
 *
 * The server ships inside `vn` rather than as its own binary: the stdlib
 * bundle is fingerprint-locked to the compiler that built it, so two
 * binaries could disagree about which std is valid. One binary makes that
 * impossible.
 */
export const LSP_ARGS = ["lsp"];
