import * as vscode from "vscode";
import { runVarnFile, runCheck, runBuild, runBytecode, runBench, runWithPhases, runWithDebugPhase } from "./execution.js";
import { runPkgInstall, runPkgUpdate, runPkgAdd, runPkgRemove } from "./packages.js";
import { runRepl, runDoctor, runCacheClean, runInitProject, runInstaller } from "./utilities.js";

/** @type {{ label: string, description: string, action: string }[]} */
const HUB_ITEMS = [
    { label: "$(play) Run File",             description: "Execute current .vn file",   action: "runFile" },
    { label: "$(terminal) Run in Terminal",  description: "Run in integrated terminal",  action: "runInTerminal" },
    { label: "$(checklist) Check File",      description: "Type-check current file",     action: "checkFile" },
    { label: "$(package) Build File",        description: "Compile current file",        action: "buildFile" },
    { label: "$(file-binary) Show Bytecode", description: "Disassemble to bytecode",     action: "showBytecode" },
    { label: "$(symbol-structure) Show AST", description: "Inspect abstract syntax tree", action: "showAst" },
    { label: "$(dashboard) Benchmark",       description: "Benchmark current file",      action: "benchFile" },
    { label: "$(debug-console) Debug Phases", description: "Run with custom debug phases", action: "debugPhases" },
    null,
    { label: "$(terminal) REPL",             description: "Start interactive Varn REPL", action: "repl" },
    { label: "$(pulse) Doctor",              description: "Check Varn installation",     action: "doctor" },
    { label: "$(clear-all) Clean Cache",     description: "Clear compiler cache",        action: "cacheClean" },
    { label: "$(new-folder) Init Project",   description: "Create new Varn project",     action: "initProject" },
    { label: "$(cloud-download) Install Runtime", description: "Download Varn runtime",  action: "installRuntime" },
    null,
    { label: "$(cloud-download) Pkg Install",      description: "Install dependencies",       action: "pkgInstall" },
    { label: "$(refresh) Pkg Update",              description: "Update dependencies",        action: "pkgUpdate" },
    { label: "$(add) Pkg Add",                     description: "Add a dependency",           action: "pkgAdd" },
    { label: "$(trash) Pkg Remove",                description: "Remove a dependency",        action: "pkgRemove" },
];

function execHubAction(actionId, ctx) {
    switch (actionId) {
        case "runFile":
            return runVarnFile(ctx, undefined, { terminal: false });
        case "runInTerminal":
            return runVarnFile(ctx, undefined, { terminal: true });
        case "checkFile":
            return runCheck(ctx, undefined);
        case "buildFile":
            return runBuild(ctx, undefined);
        case "showBytecode":
            return runBytecode(ctx, undefined);
        case "showAst":
            return runWithDebugPhase(ctx, undefined, ["ast"], "AST");
        case "benchFile":
            return runBench(ctx, undefined);
        case "debugPhases":
            return runWithPhases(ctx, undefined);
        case "repl":
            return runRepl(ctx);
        case "doctor":
            return runDoctor(ctx);
        case "cacheClean":
            return runCacheClean(ctx);
        case "initProject":
            return runInitProject(ctx);
        case "installRuntime":
            return runInstaller(ctx);
        case "pkgInstall":
            return runPkgInstall(ctx);
        case "pkgUpdate":
            return runPkgUpdate(ctx);
        case "pkgAdd":
            return runPkgAdd(ctx);
        case "pkgRemove":
            return runPkgRemove(ctx);
    }
}

export function showActionsHub(ctx) {
    const picks = HUB_ITEMS.map((item) => {
        if (!item) return { label: "", kind: vscode.QuickPickItemKind.Separator };
        return {
            label: item.label,
            description: item.description,
            action: item.action,
        };
    });

    vscode.window.showQuickPick(picks, {
        placeHolder: "Varn actions — select an operation",
        matchOnDescription: true,
    }).then((selected) => {
        if (selected && selected.action) {
            execHubAction(selected.action, ctx);
        }
    });
}
