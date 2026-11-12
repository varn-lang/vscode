import * as vscode from "vscode";
import * as path from "node:path";
import * as fs from "node:fs";
import { BIN_EXT } from "./constants.js";
import { vnHomeBinPath, findOnPath } from "./utils.js";

type BuildMode = "release" | "debug";

export const BINARY_NOT_FOUND =
    "The `vn` binary was not found. Build it with `cargo build --release --bin vn` or set vn.cli.path.";

function targetCandidates(root: string, binName: string, mode: BuildMode): string[] {
    const preferred = path.join(root, "target", mode, binName);
    const fallback = path.join(root, "target", mode === "release" ? "debug" : "release", binName);
    return [preferred, fallback];
}

export function getBinaryCandidates(context: vscode.ExtensionContext, binName: string): string[] {
    const mode = vscode.workspace.getConfiguration("vn").get<BuildMode>("buildMode", "release");
    const candidates: string[] = [];

    const homeBin = vnHomeBinPath(binName);
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

const SHADOW_DIR = ".vn-shadow";

/**
 * Windows locks a running executable, which blocks `cargo build` from replacing
 * `vn.exe` while the language server runs. The server therefore runs from a copy.
 * The copy lives beside the original, as vn-shadow does, because the standard
 * library of a development checkout is found by walking up from the executable.
 */
export function resolveServerPath(cliPath: string): string {
    if (process.platform !== "win32") return cliPath;
    try {
        const { size, mtimeMs } = fs.statSync(cliPath);
        const key = `${size.toString(16)}-${Math.round(mtimeMs).toString(16)}`;
        const root = path.join(path.dirname(cliPath), SHADOW_DIR);
        const image = path.join(root, key, path.basename(cliPath));
        if (!fs.existsSync(image)) {
            fs.mkdirSync(path.dirname(image), { recursive: true });
            fs.copyFileSync(cliPath, image);
            pruneShadowCopies(root, key);
        }
        return image;
    } catch {
        return cliPath;
    }
}

function pruneShadowCopies(root: string, keep: string): void {
    let slots: string[];
    try {
        slots = fs.readdirSync(root);
    } catch {
        return;
    }
    for (const slot of slots) {
        if (slot === keep) continue;
        try {
            fs.rmSync(path.join(root, slot), { recursive: true, force: true });
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
