const fs = require("node:fs");
const path = require("node:path");
const cp = require("node:child_process");
const vt = require("vscode-textmate");
const onig = require("vscode-oniguruma");

const root = path.resolve(__dirname, "..");
const grammarPath = path.join(root, "syntaxes", "vn.tmLanguage.json");
const args = process.argv.slice(2);
const corpus = path.resolve(args.find((a) => !a.startsWith("--")) ?? path.join(root, "test", "integration", "fixtures"));
const limit = Number(args[args.indexOf("--limit") + 1]) || 60;
const showExamples = Number(args[args.indexOf("--examples") + 1]) || 4;
const minimum = Number(args[args.indexOf("--min") + 1]) || 0;
const vn = process.env.VN_CLI_PATH;
if (!vn || !fs.existsSync(vn)) {
    console.error("Set VN_CLI_PATH to a vn binary.");
    process.exit(2);
}

const NAMED = /^(entity\.name|variable\.(other|parameter)|support\.(class|function|type)|storage\.type\.(class|interface|enum))/;

async function loadGrammar() {
    const wasm = fs.readFileSync(require.resolve("vscode-oniguruma/release/onig.wasm")).buffer;
    await onig.loadWASM(wasm);
    const registry = new vt.Registry({
        onigLib: Promise.resolve({
            createOnigScanner: (sources) => new onig.OnigScanner(sources),
            createOnigString: (text) => new onig.OnigString(text),
        }),
        loadGrammar: async (name) => (name === "source.vn" ? vt.parseRawGrammar(fs.readFileSync(grammarPath, "utf8"), grammarPath) : null),
    });
    return registry.loadGrammar("source.vn");
}

class Rpc {
    constructor() {
        this.proc = cp.spawn(vn, ["lsp"], { stdio: ["pipe", "pipe", "ignore"], windowsHide: true });
        this.buffer = Buffer.alloc(0);
        this.pending = new Map();
        this.next = 1;
        this.proc.stdout.on("data", (chunk) => {
            this.buffer = Buffer.concat([this.buffer, chunk]);
            for (;;) {
                const split = this.buffer.indexOf("\r\n\r\n");
                if (split < 0) return;
                const length = Number(/Content-Length: (\d+)/i.exec(this.buffer.slice(0, split).toString())[1]);
                if (this.buffer.length < split + 4 + length) return;
                const message = JSON.parse(this.buffer.slice(split + 4, split + 4 + length).toString());
                this.buffer = this.buffer.slice(split + 4 + length);
                if (message.id !== undefined && this.pending.has(message.id)) {
                    this.pending.get(message.id)(message);
                    this.pending.delete(message.id);
                } else if (message.id !== undefined && message.method) {
                    this.send({ jsonrpc: "2.0", id: message.id, result: null });
                }
            }
        });
    }
    send(message) {
        const body = Buffer.from(JSON.stringify(message));
        this.proc.stdin.write(`Content-Length: ${body.length}\r\n\r\n`);
        this.proc.stdin.write(body);
    }
    request(method, params) {
        const id = this.next++;
        return new Promise((resolve) => {
            this.pending.set(id, resolve);
            this.send({ jsonrpc: "2.0", id, method, params });
        });
    }
    notify(method, params) {
        this.send({ jsonrpc: "2.0", method, params });
    }
}

function listFiles(dir) {
    const out = [];
    (function walk(current) {
        for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
            if (entry.name === "node_modules" || entry.name === "target" || entry.name === ".git" || entry.name === "errors") continue;
            const full = path.join(current, entry.name);
            if (entry.isDirectory()) walk(full);
            else if (entry.name.endsWith(".vn")) out.push(full);
        }
    })(dir);
    return out;
}

(async () => {
    const grammar = await loadGrammar();
    const rpc = new Rpc();
    const init = await rpc.request("initialize", {
        processId: process.pid,
        rootUri: null,
        capabilities: { textDocument: { semanticTokens: { requests: { full: true }, tokenTypes: [], tokenModifiers: [], formats: ["relative"] } } },
    });
    const legend = init.result.capabilities.semanticTokensProvider.legend;
    rpc.notify("initialized", {});

    const files = listFiles(corpus).slice(0, limit);
    const missing = new Map();
    let named = 0;
    let covered = 0;
    for (const file of files) {
        const text = fs.readFileSync(file, "utf8");
        const uri = "file:///" + file.split(path.sep).join("/");
        rpc.notify("textDocument/didOpen", { textDocument: { uri, languageId: "vn", version: 1, text } });
        let data = [];
        for (let attempt = 0; attempt < 20 && data.length === 0; attempt++) {
            const response = await rpc.request("textDocument/semanticTokens/full", { textDocument: { uri } });
            data = response.result?.data ?? [];
            if (data.length === 0) await new Promise((resolve) => setTimeout(resolve, 250));
        }
        const seen = new Set();
        let line = 0;
        let start = 0;
        for (let i = 0; i < data.length; i += 5) {
            line += data[i];
            start = data[i] === 0 ? start + data[i + 1] : data[i + 1];
            seen.add(`${line}:${start}`);
        }
        let ruleStack = vt.INITIAL;
        text.split(/\r?\n/).forEach((content, lineNumber) => {
            const result = grammar.tokenizeLine(content, ruleStack);
            ruleStack = result.ruleStack;
            for (const token of result.tokens) {
                const scope = token.scopes[token.scopes.length - 1];
                if (!NAMED.test(scope)) continue;
                const lexeme = content.slice(token.startIndex, token.endIndex);
                if (!/^[A-Za-z_$][\w$]*$/.test(lexeme)) continue;
                named++;
                if (seen.has(`${lineNumber}:${token.startIndex}`)) {
                    covered++;
                    continue;
                }
                const key = scope;
                if (!missing.has(key)) missing.set(key, { count: 0, examples: [] });
                const entry = missing.get(key);
                entry.count++;
                if (entry.examples.length < showExamples) entry.examples.push(`${lexeme} @ ${path.relative(corpus, file)}:${lineNumber + 1}`);
            }
        });
        rpc.notify("textDocument/didClose", { textDocument: { uri } });
    }
    rpc.proc.kill();
    console.log(`files=${files.length} named identifiers=${named} with a semantic token=${covered} (${((covered / Math.max(named, 1)) * 100).toFixed(1)}%)`);
    for (const [scope, { count, examples }] of [...missing].sort((a, b) => b[1].count - a[1].count)) {
        console.log(`${String(count).padStart(6)}  ${scope}`);
        for (const example of examples) console.log(`          ${example}`);
    }
    const percent = (covered / Math.max(named, 1)) * 100;
    if (percent < minimum) {
        console.error(`coverage ${percent.toFixed(1)}% is below the required ${minimum}%`);
        process.exit(1);
    }
    process.exit(0);
})();
