import * as vscode from "vscode";
import * as os from "node:os";
import * as path from "node:path";
import * as fs from "node:fs";
import { BIN_EXT } from "./constants.js";
import { varnHomeBinPath, findOnPath } from "./utils.js";

type BuildMode = "release" | "debug";

function targetCandidates(root: string, binName: string, mode: BuildMode): string[] {
    const preferred = path.join(root, "target", mode, binName);
    const fallback = path.join(root, "target", mode === "release" ? "debug" : "release", binName);
    return [preferred, fallback];
}

export function getBinaryCandidates(context: vscode.ExtensionContext, binName: string): string[] {
    const mode = vscode.workspace.getConfiguration("vn").get<BuildMode>("buildMode", "release");
    const candidates: string[] = [];

    const homeBin = varnHomeBinPath(binName);
    if (homeBin) candidates.push(homeBin);

    if (vscode.workspace.isTrusted) {
        for (const folder of vscode.workspace.workspaceFolders ?? []) {
            candidates.push(...targetCandidates(folder.uri.fsPath, binName, mode));
        }
    }

    const siblingRoot = path.resolve(context.extensionPath, "..", "varn-lang");
    candidates.push(...targetCandidates(siblingRoot, binName, mode));

    return candidates;
}

export function resolveCliPath(context: vscode.ExtensionContext): string | undefined {
    const override = vscode.workspace.getConfiguration("vn").get<string>("cli.path");
    if (override) {
        if (fs.existsSync(override)) return override;
        void vscode.window.showWarningMessage(
            `vn.cli.path not found: ${override}. Falling back to auto-detect.`,
        );
    }

    const binName = `vn${BIN_EXT}`;
    const found = getBinaryCandidates(context, binName).find((candidate) => fs.existsSync(candidate));
    return found ?? findOnPath(binName);
}

export function resolveServerPath(cliPath: string): string {
    try {
        const tag = fs.statSync(cliPath).mtimeMs.toString(36).replace(".", "");
        const dir = path.join(os.tmpdir(), "vn-dev-server");
        const dest = path.join(dir, `vn-${tag}${BIN_EXT}`);
        if (!fs.existsSync(dest)) {
            fs.mkdirSync(dir, { recursive: true });
            fs.copyFileSync(cliPath, dest);
            pruneDevCopies(dir, dest);
        }
        return dest;
    } catch {
        return cliPath;
    }
}

function pruneDevCopies(dir: string, keep: string): void {
    let entries: string[];
    try {
        entries = fs.readdirSync(dir);
    } catch {
        return;
    }
    const copies = entries
        .filter((name) => name.startsWith("vn-") && name.endsWith(BIN_EXT))
        .map((name) => path.join(dir, name))
        .filter((file) => file !== keep)
        .sort()
        .reverse();
    for (const extra of copies.slice(1)) {
        try {
            fs.unlinkSync(extra);
        } catch {
            continue;
        }
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
