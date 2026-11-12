const path = require("node:path");
const fs = require("node:fs");
const os = require("node:os");
const { Rpc } = require("./lib/lsp-client.cjs");
const cases = require("../test/completion/cases.cjs");

const args = process.argv.slice(2);
const dump = args.includes("--dump");
const only = args.includes("--only") ? args[args.indexOf("--only") + 1] : undefined;
const vn = process.env.VN_CLI_PATH;
if (!vn || !fs.existsSync(vn)) {
    console.error("Set VN_CLI_PATH to a vn binary.");
    process.exit(2);
}

const MARK = "‸";

function position(text) {
    const offset = text.indexOf(MARK);
    const lines = text.slice(0, offset).split("\n");
    return { clean: text.replace(MARK, ""), line: lines.length - 1, character: lines[lines.length - 1].length };
}

(async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "vn-completion-"));
    for (const testCase of cases) {
        for (const [name, content] of Object.entries(testCase.files ?? {})) fs.writeFileSync(path.join(dir, name), content);
    }
    const rpc = new Rpc(vn);
    await rpc.request("initialize", {
        processId: process.pid,
        rootUri: "file:///" + dir.split(path.sep).join("/"),
        capabilities: { textDocument: { completion: { completionItem: { snippetSupport: true } } } },
    });
    rpc.notify("initialized", {});
    let failed = 0;
    let index = 0;
    const selected = cases.filter((c) => !only || c.name.includes(only));
    for (const testCase of selected) {
        const body = testCase.prelude === false ? testCase.code : `${cases.PRELUDE}\n${testCase.code}`;
        const { clean, line, character } = position(body);
        const uri = "file:///" + path.join(dir, `case${index++}.vn`).split(path.sep).join("/");
        rpc.notify("textDocument/didOpen", { textDocument: { uri, languageId: "vn", version: 1, text: clean } });
        let items = [];
        rpc.logs.length = 0;
        for (let attempt = 0; attempt < 12; attempt++) {
            const response = await rpc.request("textDocument/completion", { textDocument: { uri }, position: { line, character } });
            const result = response.result;
            items = Array.isArray(result) ? result : (result?.items ?? []);
            if (items.length > 0 || testCase.none) break;
            await new Promise((resolve) => setTimeout(resolve, 200));
        }
        const labels = items.map((item) => item.label);
        const problems = [];
        for (const label of testCase.includes ?? []) if (!labels.includes(label)) problems.push(`missing ${label}`);
        for (const label of testCase.excludes ?? []) if (labels.includes(label)) problems.push(`unexpected ${label}`);
        if (testCase.none && labels.length > 0) problems.push(`expected nothing, got ${labels.length} items`);
        if (testCase.autoImport) {
            const hit = items.find((item) => item.label === testCase.autoImport && (item.additionalTextEdits?.length ?? 0) > 0);
            if (!hit) problems.push(`no auto-import edit for ${testCase.autoImport}`);
        }
        const known = problems.length > 0 && testCase.known;
        if (problems.length > 0 && !known) failed++;
        console.log(`${problems.length === 0 ? "ok  " : known ? "KNOWN" : "FAIL"} ${testCase.name}${problems.length ? `: ${problems.join("; ")}` : ""}`);
        if (dump || problems.length > 0) console.log(`     [${labels.length}] ${labels.slice(0, 40).join(" ")}${labels.length > 40 ? " ..." : ""}`);
        if (problems.length > 0) {
            const log = rpc.logs.filter((line) => line.includes("cmp ")).pop();
            if (log) console.log(`     log: ${log.slice(0, 260)}`);
        }
        rpc.notify("textDocument/didClose", { textDocument: { uri } });
    }
    rpc.proc.kill();
    console.log(`\n${selected.length - failed} ok, ${failed} failed`);
    process.exit(failed > 0 ? 1 : 0);
})();
