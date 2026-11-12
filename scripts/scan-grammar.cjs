const fs = require("fs");
const path = require("path");
const cp = require("child_process");
const vt = require("vscode-textmate");
const onig = require("vscode-oniguruma");

const corpusRoot = path.resolve(process.argv[2] || "../varn-lang");
const grammarPath = path.resolve(__dirname, "../syntaxes/vn.tmLanguage.json");
const scopeName = "source.vn";
const topCount = 25;

async function loadGrammar() {
  const wasm = fs.readFileSync(require.resolve("vscode-oniguruma/release/onig.wasm")).buffer;
  await onig.loadWASM(wasm);
  const registry = new vt.Registry({
    onigLib: Promise.resolve({
      createOnigScanner: (sources) => new onig.OnigScanner(sources),
      createOnigString: (text) => new onig.OnigString(text),
    }),
    loadGrammar: async (name) =>
      name === scopeName
        ? vt.parseRawGrammar(fs.readFileSync(grammarPath, "utf8"), grammarPath)
        : null,
  });
  return registry.loadGrammar(scopeName);
}

function listCorpus() {
  return cp
    .execSync('git ls-files "*.vn"', { cwd: corpusRoot, encoding: "utf8", maxBuffer: 1 << 27 })
    .split("\n")
    .filter(Boolean);
}

function scanFile(grammar, file, totals) {
  let ruleStack = vt.INITIAL;
  const lines = fs.readFileSync(path.join(corpusRoot, file), "utf8").split(/\r?\n/);
  lines.forEach((line, index) => {
    const result = grammar.tokenizeLine(line, ruleStack);
    ruleStack = result.ruleStack;
    totals.lines += 1;
    if (result.stoppedEarly) totals.stoppedEarly.push(`${file}:${index + 1}`);
    for (const token of result.tokens) {
      const text = line.slice(token.startIndex, token.endIndex);
      if (!text.trim()) continue;
      totals.tokens += 1;
      const where = `${file}:${index + 1}`;
      if (token.scopes.length === 1) bump(totals.unscoped, text, where);
      if (token.scopes.some((scope) => scope.startsWith("invalid"))) bump(totals.invalid, text, where);
    }
  });
}

function bump(map, key, where) {
  const entry = map.get(key) || { count: 0, where };
  entry.count += 1;
  map.set(key, entry);
}

function report(title, map) {
  console.log(`\n${title}: ${map.size} kinds`);
  [...map]
    .sort((a, b) => b[1].count - a[1].count)
    .slice(0, topCount)
    .forEach(([text, e]) => console.log(`  ${String(e.count).padStart(5)}  ${JSON.stringify(text)}  ${e.where}`));
}

(async () => {
  const grammar = await loadGrammar();
  const files = listCorpus();
  const totals = { lines: 0, tokens: 0, stoppedEarly: [], unscoped: new Map(), invalid: new Map() };
  files.forEach((file) => scanFile(grammar, file, totals));
  console.log(`files=${files.length} lines=${totals.lines} tokens=${totals.tokens}`);
  report("unscoped", totals.unscoped);
  report("invalid", totals.invalid);
  if (totals.stoppedEarly.length) console.log("\nstopped early:", totals.stoppedEarly.slice(0, 10));
  process.exit(totals.stoppedEarly.length || totals.invalid.size ? 1 : 0);
})();
