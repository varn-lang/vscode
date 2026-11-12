const fs = require("node:fs");
const path = require("node:path");
const vt = require("vscode-textmate");
const onig = require("vscode-oniguruma");

const root = path.resolve(__dirname, "..");
const grammarPath = path.join(root, "syntaxes", "vn.tmLanguage.json");
const fixtures = path.join(root, "test", "grammar");
const update = process.argv.includes("--update");

async function loadGrammar() {
    const wasm = fs.readFileSync(require.resolve("vscode-oniguruma/release/onig.wasm")).buffer;
    await onig.loadWASM(wasm);
    const registry = new vt.Registry({
        onigLib: Promise.resolve({
            createOnigScanner: (sources) => new onig.OnigScanner(sources),
            createOnigString: (text) => new onig.OnigString(text),
        }),
        loadGrammar: async (name) =>
            name === "source.vn" ? vt.parseRawGrammar(fs.readFileSync(grammarPath, "utf8"), grammarPath) : null,
    });
    return registry.loadGrammar("source.vn");
}

function snapshot(grammar, text) {
    const out = [];
    let ruleStack = vt.INITIAL;
    text.split(/\r?\n/).forEach((line, index) => {
        out.push(`${index + 1}: ${line}`);
        const result = grammar.tokenizeLine(line, ruleStack);
        ruleStack = result.ruleStack;
        for (const token of result.tokens) {
            const piece = line.slice(token.startIndex, token.endIndex);
            if (!piece.trim()) continue;
            const scopes = token.scopes.slice(1).join(" ") || "(none)";
            out.push(`    ${JSON.stringify(piece)} ${scopes}`);
        }
    });
    return out.join("\n") + "\n";
}

(async () => {
    const grammar = await loadGrammar();
    const sources = fs.readdirSync(fixtures).filter((name) => name.endsWith(".vn")).sort();
    let failed = 0;
    for (const name of sources) {
        const actual = snapshot(grammar, fs.readFileSync(path.join(fixtures, name), "utf8"));
        const expectedPath = path.join(fixtures, `${name}.snap`);
        if (update || !fs.existsSync(expectedPath)) {
            fs.writeFileSync(expectedPath, actual);
            console.log(`  wrote ${name}.snap`);
            continue;
        }
        const expected = fs.readFileSync(expectedPath, "utf8").replace(/\r\n/g, "\n");
        if (expected === actual.replace(/\r\n/g, "\n")) {
            console.log(`  ok    ${name}`);
            continue;
        }
        failed++;
        const want = expected.split("\n");
        const got = actual.split("\n");
        const at = want.findIndex((line, i) => line !== got[i]);
        console.log(`  FAIL  ${name} (first difference at line ${at + 1})`);
        console.log(`        expected: ${want[at]}`);
        console.log(`        actual:   ${got[at]}`);
    }
    if (failed > 0) {
        console.error(`${failed} grammar snapshot(s) differ. Review them, then run pnpm run grammar:snapshot -- --update.`);
        process.exit(1);
    }
})();
