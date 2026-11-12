import { execSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

const corpusRoot = resolve(process.argv[2] ?? "../varn-lang");
const { scanTests } = await import(pathToFileURL(resolve("src/testing/scan.ts")).href);

const files = execSync('git ls-files "*.vn"', { cwd: corpusRoot, encoding: "utf8", maxBuffer: 1 << 27 })
    .split("\n")
    .filter(Boolean);

const LITERAL_CALL = /^\s*(?:await\s+)?(?:describe|it|test)\(\s*["'`]/;
const missed = [];
let discovered = 0;

for (const file of files) {
    const text = readFileSync(join(corpusRoot, file), "utf8");
    const result = scanTests(text);
    const found = new Set([
        ...result.suites.map((suite) => suite.line),
        ...result.suites.flatMap((suite) => suite.cases.map((testCase) => testCase.line)),
        ...result.cases.map((testCase) => testCase.line),
    ]);
    discovered += found.size;
    text.split(/\r?\n/).forEach((line, index) => {
        if (LITERAL_CALL.test(line) && !found.has(index)) missed.push(`${file}:${index + 1}: ${line.trim()}`);
    });
}

console.log(`files=${files.length} discovered=${discovered} missed=${missed.length}`);
if (missed.length > 0) {
    console.error(missed.join("\n"));
    process.exit(1);
}
