export interface ScannedCase {
    title: string;
    line: number;
    column: number;
}

export interface ScannedSuite extends ScannedCase {
    cases: ScannedCase[];
}

export interface ScanResult {
    suites: ScannedSuite[];
    cases: ScannedCase[];
}

const QUOTED = String.raw`(["'\`])((?:\\.|(?!\1).)*)\1`;
const SUITE = new RegExp(String.raw`^\s*(?:await\s+)?describe\(\s*${QUOTED}`);
const CASE = new RegExp(String.raw`^\s*(?:await\s+)?(?:it|test)\(\s*${QUOTED}`);
const TEST_DECORATOR = /^\s*@test\b/;
const DECORATOR = /^\s*@/;
const FUNCTION_DECLARATION = /^\s*(?:export\s+)?(?:async\s+)?function\s*\*?\s*([A-Za-z_$][\w$]*)/;

/**
 * Find the tests of a Varn source file: `describe("…")` suites with their
 * `it("…")` / `test("…")` cases, and functions marked with `@test`.
 */
export function scanTests(text: string): ScanResult {
    const result: ScanResult = { suites: [], cases: [] };
    const lines = text.split(/\r?\n/);
    let decorated = false;

    lines.forEach((line, lineIndex) => {
        if (TEST_DECORATOR.test(line)) {
            decorated = true;
            return;
        }

        const declaration = decorated ? FUNCTION_DECLARATION.exec(line) : null;
        if (declaration) {
            decorated = false;
            result.cases.push({
                title: declaration[1],
                line: lineIndex,
                column: line.indexOf(declaration[1]),
            });
            return;
        }
        if (line.trim() !== "" && !DECORATOR.test(line)) decorated = false;

        const suite = SUITE.exec(line);
        if (suite) {
            result.suites.push({ title: suite[2], line: lineIndex, column: line.indexOf(suite[2]), cases: [] });
            return;
        }

        const testCase = CASE.exec(line);
        if (testCase) {
            const found: ScannedCase = { title: testCase[2], line: lineIndex, column: line.indexOf(testCase[2]) };
            const currentSuite = result.suites[result.suites.length - 1];
            if (currentSuite) currentSuite.cases.push(found);
            else result.cases.push(found);
        }
    });

    return result;
}
