const fs = require("node:fs");
const path = require("node:path");
const cp = require("node:child_process");
const vt = require("vscode-textmate");
const onig = require("vscode-oniguruma");

// Compares what the real lexer (`vn debug -p tokens`) says each token is with the
// scopes the TextMate grammar gives it.
//   node scripts/check-grammar-lexer.cjs [corpus] [--limit N] [--examples N] [--kind Name]

const positional = process.argv.slice(2).filter((arg, i, all) => !arg.startsWith("--") && !/^--(limit|examples|kind)$/.test(all[i - 1] ?? ""));
const flag = (name, fallback) => {
    const at = process.argv.indexOf(`--${name}`);
    return at >= 0 ? process.argv[at + 1] : fallback;
};
const corpusRoot = path.resolve(positional[0] || path.join(__dirname, "..", "..", "varn-lang"));
const limit = Number(flag("limit", "0"));
const examplesPerKind = Number(flag("examples", "3"));
const onlyKind = flag("kind", "");
const grammarPath = path.resolve(__dirname, "../syntaxes/vn.tmLanguage.json");

function findVn() {
    const candidates = [
        process.env.VN_CLI_PATH,
        path.join(corpusRoot, "target", "quick", "vn.exe"),
        path.join(corpusRoot, "target", "release", "vn.exe"),
        path.join(corpusRoot, "target", "quick", "vn"),
        path.join(corpusRoot, "target", "release", "vn"),
    ];
    const found = candidates.find((candidate) => candidate && fs.existsSync(candidate));
    if (!found) {
        console.error("No vn binary found. Build one in the corpus or set VN_CLI_PATH.");
        process.exit(2);
    }
    return found;
}

const has = (scopes, pattern) => scopes.some((scope) => pattern.test(scope));
const KEYWORDISH = /^(keyword\.|storage\.|support\.type|constant\.language|variable\.language|entity\.name\.type\.primitive)/;
const keywordish = (scopes) => has(scopes, KEYWORDISH);
const codeLike = (scopes) => !has(scopes, /^(comment|string)\b/);

const RESERVED = new Set(
    "Let Const Var Function Class Struct Interface Type Enum Namespace Module Extension If Else Switch Case Default While For Do Break Continue Return Throw Try Catch Finally Using With Import Export Async Await Yield New Delete Typeof Instanceof In Void Public Private Protected Static Abstract Override Readonly Declare Extends Implements Constructor Destructor Match".split(" "),
);
const NUMBERS = new Set("IntegerLiteral FloatLiteral BinaryLiteral OctalLiteral HexLiteral BigIntLiteral DecimalLiteral".split(" "));
const STRINGS = new Set("Str Char RawStr Template TemplateHead TemplateMiddle TemplateTail".split(" "));
const OPERATORS = new Set(
    "Plus PlusPlus PlusEq Minus MinusMinus MinusEq Star StarStar StarEq StarStarEq Slash SlashEq Percent PercentEq Amp AmpAmp AmpEq AmpAmpEq Pipe PipePipe PipeEq PipePipeEq PipeGt Caret CaretEq Tilde LtLt LtLtEq GtGt GtGtEq GtGtGt GtGtGtEq Eq EqEq EqEqEq Bang BangEq BangEqEq LtEq GtEq Arrow FatArrow Question QuestionDot QuestionLBracket QuestionQuestion QuestionQuestionEq DotDot DotDotDot DotDotEq".split(" "),
);
const PUNCTUATION = new Set("LParen RParen LBrace RBrace LBracket RBracket LAngle RAngle Semicolon Comma Dot Colon ColonColon".split(" "));

// words the lexer always reports as keywords but the language lets a name use
const SOFT = new Set("Type Extension Module Namespace Default Match Delete Await Yield With Using Declare Static Public Private Protected Abstract Override Readonly Out".split(" "));
const MEMBER_NAME = /^(entity\.name\.function|variable\.other\.property|variable\.other\.object\.property)/;

// inside `${ ... }` of a template literal only the expression's own scopes count
function effective(scopes) {
    const at = scopes.lastIndexOf("meta.template.expression.vn");
    return at >= 0 ? scopes.slice(at + 1) : scopes;
}

function expectation(kind) {
    if (RESERVED.has(kind)) {
        return ["a keyword (or a member name)", (s) => keywordish(s) || has(s, MEMBER_NAME) || (SOFT.has(kind) && has(s, /^variable\./))];
    }
    if (kind === "True" || kind === "False" || kind === "Null") return ["a language constant", (s) => has(s, /^constant\.language/)];
    if (kind === "This" || kind === "Super") return ["a language variable", (s) => has(s, /^variable\.language/)];
    if (NUMBERS.has(kind)) return ["a number", (s) => has(s, /^constant\.numeric/)];
    if (STRINGS.has(kind)) return ["a string", (s) => has(s, /^(string|punctuation\.definition\.(string|template))/) || has(s, /template/)];
    if (kind === "RegularExpression") return ["a regular expression", (s) => has(s, /^string\.regexp|^punctuation\.definition\.string/)];
    if (kind === "DocComment") return ["a comment", (s) => has(s, /^comment/)];
    if (kind === "Identifier") {
        return ["not a keyword, literal, string or comment", (s) => !has(s, /^(keyword\.control|storage|constant\.numeric|constant\.language|string|comment)/)];
    }
    if (OPERATORS.has(kind)) return ["an operator", (s) => has(s, /^(keyword\.operator|keyword\.generator|punctuation)/)];
    if (PUNCTUATION.has(kind)) return ["punctuation", (s) => has(s, /^(punctuation|keyword\.operator|meta\.brace)/)];
    return null;
}

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

function lexerTokens(vn, file) {
    return new Promise((resolve) => {
        cp.execFile(vn, ["debug", file, "-p", "tokens"], { maxBuffer: 1 << 28, windowsHide: true }, (_error, _stdout, stderr) => {
            const tokens = [];
            for (const raw of stderr.split("\n")) {
                const line = raw.replace(/\x1b\[[0-9;]*m/g, "");
                const match = /^\s*\d+\s+│\s+(\d+):(\d+)\s+│\s+(\w+)\s+│\s+"(.*)"\s*$/.exec(line);
                if (match) tokens.push({ line: Number(match[1]) - 2, byteColumn: Number(match[2]), kind: match[3], lexeme: match[4] });
            }
            resolve(tokens);
        });
    });
}

function byteToIndex(text, byteColumn) {
    let bytes = 0;
    let index = 0;
    for (const char of text) {
        if (bytes >= byteColumn) break;
        bytes += Buffer.byteLength(char);
        index += char.length;
    }
    return index;
}

async function mapLimit(items, concurrency, work) {
    const results = new Array(items.length);
    let next = 0;
    await Promise.all(
        Array.from({ length: concurrency }, async () => {
            while (next < items.length) {
                const at = next++;
                results[at] = await work(items[at]);
            }
        }),
    );
    return results;
}

(async () => {
    const vn = findVn();
    const grammar = await loadGrammar();
    let files = cp
        .execSync('git ls-files "*.vn"', { cwd: corpusRoot, encoding: "utf8", maxBuffer: 1 << 27 })
        .split("\n")
        .filter(Boolean)
        .filter((file) => !file.startsWith("tests/errors/"));
    if (limit > 0) files = files.slice(0, limit);

    const failures = new Map();
    let checked = 0;
    let skipped = 0;
    let phantomCount = 0;
    const phantoms = [];

    await mapLimit(files, 8, async (file) => {
        const full = path.join(corpusRoot, file);
        const tokens = await lexerTokens(vn, full);
        if (tokens.length === 0) {
            skipped++;
            return;
        }
        const lines = fs.readFileSync(full, "utf8").split(/\r?\n/);
        let ruleStack = vt.INITIAL;
        const scoped = lines.map((line) => {
            const result = grammar.tokenizeLine(line, ruleStack);
            ruleStack = result.ruleStack;
            return result.tokens;
        });
        const starts = lines.map(() => new Set());

        for (const token of tokens) {
            const text = lines[token.line];
            if (text === undefined) continue;
            const index = byteToIndex(text, token.byteColumn);
            starts[token.line].add(index);
            if (OPERATORS.has(token.kind) || PUNCTUATION.has(token.kind)) {
                for (let covered = 1; covered < token.lexeme.length; covered++) starts[token.line].add(index + covered);
            }
            const expected = expectation(token.kind);
            if (!expected) continue;
            if (onlyKind && token.kind !== onlyKind) continue;
            const covering = scoped[token.line].find((t) => t.startIndex <= index && index < t.endIndex);
            if (!covering) continue;
            const scopes = effective(covering.scopes.slice(1));
            checked++;
            if (!expected[1](scopes)) {
                const key = `${token.kind} should be ${expected[0]}`;
                const entry = failures.get(key) ?? { count: 0, examples: [] };
                entry.count++;
                if (entry.examples.length < examplesPerKind) {
                    entry.examples.push(`${file}:${token.line + 1}  ${JSON.stringify(token.lexeme.slice(0, 30))}  [${scopes.join(" ") || "none"}]  | ${text.trim().slice(0, 80)}`);
                }
                failures.set(key, entry);
            }
        }

        lines.forEach((text, lineIndex) => {
            for (const t of scoped[lineIndex]) {
                const piece = text.slice(t.startIndex, t.endIndex);
                if (!piece.trim()) continue;
                const scopes = t.scopes.slice(1);
                if (!codeLike(scopes) || has(scopes, /regexp|template|meta\.embedded/)) continue;
                let covered = false;
                for (const start of starts[lineIndex]) {
                    if (start >= t.startIndex && start < t.endIndex) {
                        covered = true;
                        break;
                    }
                }
                if (!covered) {
                    phantomCount++;
                    if (phantoms.length < 12) phantoms.push(`${file}:${lineIndex + 1}  ${JSON.stringify(piece.slice(0, 30))}  [${scopes.join(" ")}]  | ${text.trim().slice(0, 80)}`);
                }
            }
        });
    });

    console.log(`files=${files.length - skipped} (skipped ${skipped} without tokens) tokens checked=${checked}`);
    const ordered = [...failures].sort((a, b) => b[1].count - a[1].count);
    console.log(`\nlexer/grammar disagreements: ${ordered.reduce((n, [, e]) => n + e.count, 0)} in ${ordered.length} kinds`);
    for (const [key, entry] of ordered) {
        console.log(`\n  ${String(entry.count).padStart(6)}  ${key}`);
        for (const example of entry.examples) console.log(`          ${example}`);
    }
    console.log(`\ncode-colored text the lexer has no token for: ${phantomCount}`);
    for (const example of phantoms) console.log(`          ${example}`);
    process.exit(ordered.length > 0 ? 1 : 0);
})();
