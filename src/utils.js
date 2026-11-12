import * as path from "node:path";
import * as fs from "node:fs";

const ANSI_PATTERN = /\u001b\[[0-9;]*[A-Za-z]/g;

/**
 * @param {string} binFile
 * @returns {string | undefined}
 */
export function varnHomeBinPath(binFile) {
    const home = process.env.VARN_HOME;
    if (!home) return undefined;
    return path.join(home, "bin", binFile);
}

/**
 * @param {string} executable
 * @returns {string | undefined}
 */
export function findOnPath(executable) {
    const pathValue = process.env.PATH;
    if (!pathValue) return undefined;
    const dirs = pathValue.split(path.delimiter);
    for (const dir of dirs) {
        if (!dir) continue;
        const full = path.join(dir, executable);
        if (fs.existsSync(full)) return full;
    }
    return undefined;
}

/**
 * Remove ANSI escape sequences from text destined for non-terminal outputs.
 * @param {string} text
 * @returns {string}
 */
export function stripAnsi(text) {
    return text.replace(ANSI_PATTERN, "");
}
