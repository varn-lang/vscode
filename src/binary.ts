import * as vscode from "vscode";
import * as path from "node:path";
import * as fs from "node:fs";
import { BIN_EXT } from "./constants.js";
import { vnHomeBinPath, findOnPath } from "./utils.js";
import { log } from "./log.js";

type BuildMode = "release" | "debug";

export const BINARY_NOT_FOUND =
    "The `vn` binary was not found. Build it with `cargo build --release --bin vn` or set vn.cli.path.";

export const INSTALL_GUIDE = "https://github.com/varn-lang/varn/blob/main/docs/INSTALL.md";

export async function reportMissingBinary(): Promise<void> {
    const guide = "Open Install Guide";
    const setting = "Set vn.cli.path";
    const choice = await vscode.window.showErrorMessage(BINARY_NOT_FOUND, guide, setting);
    if (choice === guide) await vscode.env.openExternal(vscode.Uri.parse(INSTALL_GUIDE));
    else if (choice === setting) await vscode.commands.executeCommand("workbench.action.openSettings", "vn.cli.path");
}

function targetCandidates(root: string, binName: string, mode: BuildMode): string[] {
    const other = mode === "release" ? "debug" : "release";
    return [mode, other, "quick"].map((profile) => path.join(root, "target", profile, binName));
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

    const siblingRoots = new Set<string>([path.resolve(context.extensionPath, "..", "varn-lang")]);
    if (vscode.workspace.isTrusted) {
        for (const folder of vscode.workspace.workspaceFolders ?? []) {
            siblingRoots.add(path.resolve(folder.uri.fsPath, "..", "varn-lang"));
        }
    }
    for (const root of siblingRoots) candidates.push(...targetCandidates(root, binName, mode));

    return candidates;
}

export function resolveCliPath(context: vscode.ExtensionContext): string | undefined {
    const override = vscode.workspace.getConfiguration("vn").get<string>("cli.path");
    if (override) {
        if (fs.existsSync(override)) return override;
        log().warn(`vn.cli.path does not exist: ${override}`);
        void vscode.window.showWarningMessage(
            `vn.cli.path not found: ${override}. Falling back to auto-detect.`,
        );
    }

    const fromEnvironment = process.env.VN_CLI_PATH;
    if (fromEnvironment && fs.existsSync(fromEnvironment)) return fromEnvironment;

    const binName = `vn${BIN_EXT}`;
    const candidates = getBinaryCandidates(context, binName).filter((candidate) => fs.existsSync(candidate));
    const newestBuild = newestBuildOutput(candidates);
    return newestBuild ?? candidates[0] ?? findOnPath(binName);
}

function newestBuildOutput(candidates: string[]): string | undefined {
    const builds = candidates.filter((candidate) => candidate.split(path.sep).includes("target"));
    let newest: { path: string; modified: number } | undefined;
    for (const candidate of builds) {
        const modified = fs.statSync(candidate).mtimeMs;
        if (!newest || modified > newest.modified) newest = { path: candidate, modified };
    }
    return newest?.path;
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
