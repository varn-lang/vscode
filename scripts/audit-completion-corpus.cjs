const path = require("node:path");
const fs = require("node:fs");
const { Rpc } = require("./lib/lsp-client.cjs");

const args = process.argv.slice(2);
const flag = (name, fallback) => (args.includes(name) ? Number(args[args.indexOf(name) + 1]) : fallback);
const corpus = path.resolve(args.find((a) => !a.startsWith("--") && !/^\d+$/.test(a)) ?? ".");
const perFile = flag("--per-file", 6);
const maxFiles = flag("--limit", 40);
const examples = flag("--examples", 25);
const minimum = flag("--min", 0);
const vn = process.env.VN_CLI_PATH;
if (!vn || !fs.existsSync(vn)) {
    console.error("Set VN_CLI_PATH to a vn binary.");
    process.exit(2);
}

function listFiles(dir) {
    const out = [];
    (function walk(current) {
        for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
            if (["node_modules", "target", ".git", "errors"].includes(entry.name)) continue;
            const full = path.join(current, entry.name);
            if (entry.isDirectory()) walk(full);
            else if (entry.name.endsWith(".vn")) out.push(full);
        }
    })(dir);
    return out;
}

function memberAccesses(text) {
    const found = [];
    const lines = text.split("\n");
    let inBlock = false;
    lines.forEach((line, lineNumber) => {
        let code = line;
        if (inBlock) {
            const close = code.indexOf("*/");
            if (close < 0) return;
            code = " ".repeat(close + 2) + code.slice(close + 2);
            inBlock = false;
        }
        code = code.replace(/\/\*.*?\*\//g, (m) => " ".repeat(m.length));
        if (code.includes("/*")) {
            inBlock = true;
            code = code.slice(0, code.indexOf("/*"));
        }
        code = code.replace(/"(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*'|`(?:[^`\\]|\\.)*`/g, (m) => " ".repeat(m.length));
        const comment = code.indexOf("//");
        if (comment >= 0) code = code.slice(0, comment);
        for (const match of code.matchAll(/(?<![.\d])(\?)?\.([A-Za-z_][A-Za-z0-9_]*)/g)) {
            const dotColumn = match.index + (match[1] ? 1 : 0);
            found.push({ line: lineNumber, dotColumn, name: match[2], receiver: code.slice(0, dotColumn).trim().slice(-30) });
        }
    });
    return found;
}

(async () => {
    const rpc = new Rpc(vn);
    await rpc.request("initialize", { processId: process.pid, rootUri: "file:///" + corpus.split(path.sep).join("/"), capabilities: {} });
    rpc.notify("initialized", {});
    const files = listFiles(corpus).slice(0, maxFiles);
    const failures = [];
    let checked = 0;
    for (const file of files) {
        const text = fs.readFileSync(file, "utf8").replace(/\r\n/g, "\n");
        const picks = memberAccesses(text);
        const step = Math.max(1, Math.floor(picks.length / perFile));
        const sample = picks.filter((_, i) => i % step === 0).slice(0, perFile);
        for (const access of sample) {
            const lines = text.split("\n");
            const original = lines[access.line];
            const head = original.slice(0, access.dotColumn + 1);
            const tail = original.slice(access.dotColumn + 1 + access.name.length);
            lines[access.line] = head + tail;
            const uri = "file:///" + file.split(path.sep).join("/") + `#${checked}`;
            rpc.notify("textDocument/didOpen", { textDocument: { uri, languageId: "vn", version: 1, text: lines.join("\n") } });
            const character = Buffer.from(head, "utf8").length === head.length ? head.length : [...head].reduce((n, ch) => n + ch.length, 0);
            let labels = [];
            for (let attempt = 0; attempt < 10; attempt++) {
                const response = await rpc.request("textDocument/completion", {
                    textDocument: { uri },
                    position: { line: access.line, character },
                    context: { triggerKind: 2, triggerCharacter: "." },
                });
                const result = response.result;
                labels = (Array.isArray(result) ? result : (result?.items ?? [])).map((item) => item.label);
                if (labels.length > 0) break;
                await new Promise((resolve) => setTimeout(resolve, 150));
            }
            checked++;
            const present = labels.some((label) => label === access.name || label === `${access.name}:`);
            if (!present) {
                const log = rpc.logs.filter((l) => l.includes("cmp ")).pop() ?? "";
                failures.push({ where: `${path.relative(corpus, file)}:${access.line + 1}`, name: access.name, receiver: access.receiver, got: labels.length, log: log.slice(0, 160) });
            }
            rpc.notify("textDocument/didClose", { textDocument: { uri } });
        }
    }
    rpc.proc.kill();
    const percent = ((checked - failures.length) / Math.max(checked, 1)) * 100;
    console.log(`checked ${checked} member accesses in ${files.length} files: ${checked - failures.length} found (${percent.toFixed(1)}%)`);
    const byStage = new Map();
    for (const failure of failures) {
        const stage = /dotmiss=([a-z-]+)|via=([a-z-]+)|(postfix-only|general|callargs|pattern|object-keys)/.exec(failure.log);
        const key = stage ? stage[1] ?? stage[2] ?? stage[3] : "none";
        byStage.set(key, (byStage.get(key) ?? 0) + 1);
    }
    console.log(`failures by stage: ${[...byStage].map(([k, v]) => `${k}=${v}`).join(" ")}`);
    for (const failure of failures.slice(0, examples)) {
        console.log(`  ${failure.where}  .${failure.name}  after "${failure.receiver}"  [${failure.got} items]  ${failure.log}`);
    }
    if (percent < minimum) {
        console.error(`coverage ${percent.toFixed(1)}% is below the required ${minimum}%`);
        process.exit(1);
    }
    process.exit(0);
})();
