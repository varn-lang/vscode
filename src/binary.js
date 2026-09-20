"use strict";

const vscode = require("vscode");
const path = require("path");
const fs = require("fs");
const { BIN_EXT } = require("./constants");
const { varnHomeBinPath, findOnPath } = require("./utils");

/**
 * Generate a list of candidate paths for a binary.
 * @param {vscode.ExtensionContext} context
 * @param {string} binName
 * @returns {string[]}
 */
function getBinaryCandidates(context, binName) {
    const candidates = [];
    const mode = vscode.workspace.getConfiguration("Varn").get("buildMode", "debug");

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
function resolveCliPath(context) {
    const override = vscode.workspace.getConfiguration("Varn").get("cli.path");
    if (override && fs.existsSync(override)) return override;

    const binName = `vn${BIN_EXT}`;
    const found = getBinaryCandidates(context, binName).find((p) => fs.existsSync(p));
    if (found) return found;

    return findOnPath(binName);
}

/**
 * Arguments that turn the Varn CLI into a language server on stdio.
 *
 * The server ships inside `vn` rather than as its own binary: the stdlib
 * bundle is fingerprint-locked to the compiler that built it, so two
 * binaries could disagree about which std is valid. One binary makes that
 * impossible.
 */
const LSP_ARGS = ["lsp"];

module.exports = {
    resolveCliPath,
    LSP_ARGS,
};
