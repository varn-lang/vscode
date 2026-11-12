const KEYWORDS = new Set(
    ("let const function class struct interface type enum namespace extension if else while for do break continue return throw try catch finally " +
        "import export from as async await yield new this super in of is true false null public private protected static abstract override readonly " +
        "mut out declare native extends implements get set constructor destructor match using on default case with void typeof delete instanceof var switch").split(" "),
);

const DECLARES =
    /(?:function|class|struct|interface|enum|type|namespace|extension|const|let|using|import|export|from|as|get|set|static|readonly|new|extends|implements|is|catch|abstract|override|async|declare|native)\s+$/;

function codeOnly(lines) {
    const result = [];
    let inBlock = false;
    for (const line of lines) {
        let code = line;
        if (inBlock) {
            const close = code.indexOf("*/");
            if (close < 0) {
                result.push("");
                continue;
            }
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
        result.push(code);
    }
    return result;
}

function identifierReferences(text) {
    const found = [];
    codeOnly(text.split("\n")).forEach((code, lineNumber) => {
        for (const match of code.matchAll(/(?<![.\w$@#:])([A-Za-z_][A-Za-z0-9_]*)(?![\w$])/g)) {
            const name = match[1];
            const rest = code.slice(match.index + name.length);
            const before = code.slice(0, match.index);
            if (KEYWORDS.has(name) || name.length < 3 || DECLARES.test(before)) continue;
            if (/^\s*\??:(?!:)/.test(rest) || /^\s*=>/.test(rest)) continue;
            if (/(?:[({,]\s*)$/.test(before) && /^\s*[,}]/.test(rest)) continue;
            if (/\b(?:function|constructor)\b[^)]*$/.test(before) || /\bimport\b[^;]*$/.test(before) || /\bexport\s*\{[^}]*$/.test(before)) continue;
            found.push({ line: lineNumber, dotColumn: match.index - 1, name, receiver: before.trim().slice(-30) });
        }
    });
    return found;
}

module.exports = { identifierReferences, codeOnly };
