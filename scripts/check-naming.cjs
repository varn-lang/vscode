const fs = require("node:fs");
const path = require("node:path");

// `vn` names logic: ids, commands, setting keys, schemes, types, file names.
// `Varn` names the brand: text a person reads. Anything else is a mix-up.

const root = path.resolve(__dirname, "..");

const sources = [];
(function collect(dir) {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) collect(full);
        else if (full.endsWith(".ts")) sources.push(full);
    }
})(path.join(root, "src"));
sources.push(path.join(root, "extension.ts"), path.join(root, "package.json"));

const allowed = [/varn-lang\/varn\b/g, /varn-lang/g, /varn-language/g, /varn-extension/g, /VARN_[A-Z_]+/g];

const rules = [
    [/["'`]varn["'`]/, 'bare "varn": use "vn" for an id or "Varn" for text'],
    [/["'`]varn[.:/-]/, 'lowercase "varn" prefix on an id: use "vn"'],
    [/\bVarn\.[a-z]/, 'dotted id in brand case ("Varn.x"): use "vn.x"'],
    [/\bVn\b/, '"Vn" is neither the brand nor the logic name'],
    [/\bvarn\b(?=[^-])/, 'lowercase "varn" in text: use "Varn" for the brand or "vn" for the program'],
];

const problems = [];
for (const file of sources) {
    const lines = fs.readFileSync(file, "utf8").split(/\r?\n/);
    lines.forEach((line, index) => {
        let scrubbed = line;
        for (const pattern of allowed) scrubbed = scrubbed.replace(pattern, "");
        for (const [pattern, message] of rules) {
            if (pattern.test(scrubbed)) {
                problems.push(`${path.relative(root, file)}:${index + 1}: ${message}\n    ${line.trim()}`);
                break;
            }
        }
    });
}

if (problems.length > 0) {
    console.error(problems.join("\n"));
    process.exit(1);
}
console.log(`naming ok: ${sources.length} files use vn for logic and Varn for the brand`);
