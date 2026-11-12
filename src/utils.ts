import * as path from "node:path";
import * as fs from "node:fs";

const ANSI_PATTERN = /\u001b\[[0-9;]*[A-Za-z]/g;

export function varnHomeBinPath(binFile: string): string | undefined {
    const home = process.env.VARN_HOME;
    if (!home) return undefined;
    return path.join(home, "bin", binFile);
}

export function findOnPath(executable: string): string | undefined {
    const pathValue = process.env.PATH;
    if (!pathValue) return undefined;
    for (const dir of pathValue.split(path.delimiter)) {
        if (!dir) continue;
        const full = path.join(dir, executable);
        if (fs.existsSync(full)) return full;
    }
    return undefined;
}

/** Remove ANSI escape sequences from text destined for non-terminal outputs. */
export function stripAnsi(text: string): string {
    return text.replace(ANSI_PATTERN, "");
}
