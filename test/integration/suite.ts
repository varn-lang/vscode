import * as assert from "node:assert/strict";
import * as path from "node:path";
import * as vscode from "vscode";

const EXTENSION_ID = "Varn.vn-language";
const SERVER_TIMEOUT_MS = 90_000;

interface Case {
    name: string;
    run: () => Promise<void>;
}

const cases: Case[] = [];
function test(name: string, run: () => Promise<void>): void {
    cases.push({ name, run });
}

function workspaceFile(name: string): vscode.Uri {
    const folder = vscode.workspace.workspaceFolders?.[0];
    assert.ok(folder, "the test workspace folder is open");
    return vscode.Uri.file(path.join(folder.uri.fsPath, name));
}

async function until<T>(description: string, probe: () => Promise<T | undefined> | T | undefined, timeoutMs = SERVER_TIMEOUT_MS): Promise<T> {
    const deadline = Date.now() + timeoutMs;
    for (;;) {
        const value = await probe();
        if (value !== undefined) return value;
        if (Date.now() > deadline) assert.fail(`timed out after ${timeoutMs} ms waiting for ${description}`);
        await new Promise((resolve) => setTimeout(resolve, 250));
    }
}

async function activate(): Promise<vscode.Extension<unknown>> {
    const extension = vscode.extensions.getExtension(EXTENSION_ID);
    assert.ok(extension, `${EXTENSION_ID} is installed in the host`);
    const document = await vscode.workspace.openTextDocument(workspaceFile("hello.vn"));
    await vscode.window.showTextDocument(document);
    await extension.activate();
    return extension;
}

test("the extension activates when a .vn file is open", async () => {
    const extension = await activate();
    assert.equal(extension.isActive, true);
});

test(".vn files use the vn language id", async () => {
    const document = await vscode.workspace.openTextDocument(workspaceFile("hello.vn"));
    assert.equal(document.languageId, "vn");
});

test("every command in the manifest is registered once activated", async () => {
    const extension = await activate();
    const declared = (extension.packageJSON.contributes.commands as { command: string }[]).map((c) => c.command);
    const registered = new Set(await vscode.commands.getCommands(true));
    const missing = declared.filter((id) => !registered.has(id));
    assert.deepEqual(missing, [], `declared but not registered: ${missing.join(", ")}`);
});

test("settings have the vn section with the manifest defaults", async () => {
    await activate();
    const config = vscode.workspace.getConfiguration("vn");
    assert.equal(config.get("buildMode"), "release");
    assert.equal(config.get("codeLens.enabled"), true);
});

test("the language server answers a hover with a vn code block", async () => {
    await activate();
    const uri = workspaceFile("hello.vn");
    const hovers = await until("a hover from the language server", async () => {
        const result = await vscode.commands.executeCommand<vscode.Hover[]>(
            "vscode.executeHoverProvider",
            uri,
            new vscode.Position(0, 10),
        );
        return result && result.length > 0 ? result : undefined;
    });
    const text = hovers
        .flatMap((hover) => hover.contents)
        .map((content) => (typeof content === "string" ? content : content.value))
        .join("\n");
    assert.match(text, /```vn\n/, `hover should tag its code block as vn, got: ${text}`);
    assert.match(text, /greet/);
});

test("diagnostics from the server carry the vn source", async () => {
    await activate();
    const uri = workspaceFile("broken.vn");
    const document = await vscode.workspace.openTextDocument(uri);
    await vscode.window.showTextDocument(document);
    const diagnostics = await until("diagnostics for broken.vn", () => {
        const found = vscode.languages.getDiagnostics(uri);
        return found.length > 0 ? found : undefined;
    });
    assert.ok(
        diagnostics.some((d) => d.severity === vscode.DiagnosticSeverity.Error),
        "the type error is reported as an error",
    );
    assert.ok(
        diagnostics.every((d) => d.source === "vn"),
        `every diagnostic has source vn, got ${diagnostics.map((d) => d.source).join(", ")}`,
    );
});

test("the bytecode virtual document renders", async () => {
    await activate();
    const source = workspaceFile("hello.vn");
    const virtual = vscode.Uri.parse(`vn-bytecode:hello.vn.vn-bc?${encodeURIComponent(source.toString())}`);
    const text = await until("bytecode text", async () => {
        const document = await vscode.workspace.openTextDocument(virtual);
        const content = document.getText();
        return content.startsWith("//") ? undefined : content;
    });
    assert.ok(text.length > 20, "bytecode is not empty");
});

test("the stdlib is browsable through the vn-std file system", async () => {
    await activate();
    const fs = vscode.workspace.fs;
    const entries = await until("the std listing", async () => {
        try {
            return await fs.readDirectory(vscode.Uri.parse("vn-std:/std"));
        } catch {
            return undefined;
        }
    });

    const roots = await fs.readDirectory(vscode.Uri.parse("vn-std:/"));
    assert.deepEqual(roots.map(([name]) => name).sort(), ["core", "runtime", "std"]);

    const names = new Map(entries);
    assert.equal(names.get("cli"), vscode.FileType.Directory, "std:cli/* modules appear as the cli directory");
    assert.equal(names.get("cli.vn"), vscode.FileType.File, "std:cli appears as cli.vn");
    assert.ok(![...names.keys()].some((name) => name.includes("/")), "no entry name contains a slash");

    const nested = await fs.readDirectory(vscode.Uri.parse("vn-std:/std/cli"));
    assert.ok(nested.some(([name]) => name === "args.vn"), "std:cli/args is cli/args.vn");

    const stat = await fs.stat(vscode.Uri.parse("vn-std:/std/cli/args.vn"));
    assert.equal(stat.type, vscode.FileType.File);
    const bytes = await fs.readFile(vscode.Uri.parse("vn-std:/std/cli/args.vn"));
    assert.ok(bytes.length > 0, "the nested module is readable");

    await assert.rejects(Promise.resolve(fs.readFile(vscode.Uri.parse("vn-std:/std/does-not-exist.vn"))));
});

test("the task provider offers build, check and test", async () => {
    await activate();
    const tasks = await vscode.tasks.fetchTasks({ type: "vn" });
    assert.deepEqual(tasks.map((task) => task.definition.task).sort(), ["build", "check", "test"]);
});

test("the sidebar views open without error", async () => {
    await activate();
    for (const id of ["vn-status", "vn-actions", "vn-ast"]) {
        await vscode.commands.executeCommand(`${id}.focus`);
    }
});

test("the Get Started walkthrough opens", async () => {
    await activate();
    await vscode.commands.executeCommand("vn.openWalkthrough");
});

test("every command the server puts in a code lens is registered", async () => {
    await activate();
    const uri = workspaceFile("hello.vn");
    const lenses = await until("code lenses from the server", async () => {
        const result = await vscode.commands.executeCommand<vscode.CodeLens[]>("vscode.executeCodeLensProvider", uri);
        return result && result.length > 0 ? result : undefined;
    });
    const used = new Set(lenses.flatMap((lens) => (lens.command ? [lens.command.command] : [])));
    assert.ok(used.size > 0, "the lenses carry commands");
    const registered = new Set(await vscode.commands.getCommands(true));
    const missing = [...used].filter((id) => !registered.has(id));
    assert.deepEqual(missing, [], `lens commands the extension does not register: ${missing.join(", ")}`);
});

test("a vn debug session starts and stops", async () => {
    await activate();
    const folder = vscode.workspace.workspaceFolders?.[0];
    assert.ok(folder);
    const started = new Promise<vscode.DebugSession>((resolve) => {
        const subscription = vscode.debug.onDidStartDebugSession((session) => {
            subscription.dispose();
            resolve(session);
        });
    });
    const accepted = await vscode.debug.startDebugging(folder, {
        type: "vn",
        request: "launch",
        name: "Debug hello.vn",
        program: workspaceFile("hello.vn").fsPath,
        stopOnEntry: true,
    });
    assert.equal(accepted, true, "VS Code accepted the vn launch configuration");
    const session = await started;
    assert.equal(session.type, "vn");
    await vscode.debug.stopDebugging(session);
});

export async function run(): Promise<void> {
    let failed = 0;
    for (const { name, run: body } of cases) {
        const started = Date.now();
        try {
            await body();
            console.log(`  ok    ${name} (${Date.now() - started} ms)`);
        } catch (error) {
            failed++;
            console.log(`  FAIL  ${name}`);
            console.log(`        ${error instanceof Error ? error.message : String(error)}`);
        }
    }
    console.log(`\n${cases.length - failed} passed, ${failed} failed`);
    if (failed > 0) throw new Error(`${failed} integration test(s) failed`);
}
