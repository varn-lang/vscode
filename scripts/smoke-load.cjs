const fs = require("node:fs");
const path = require("node:path");
const Module = require("node:module");

const sources = ["extension.js", ...walk("src")];
const names = new Set();
for (const file of sources) {
    const text = fs.readFileSync(file, "utf8");
    for (const match of text.matchAll(/\bvscode\.([A-Za-z_]\w*)/g)) names.add(match[1]);
}

function walk(dir) {
    return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) return walk(full);
        return /\.(js|ts)$/.test(entry.name) ? [full] : [];
    });
}

function member() {
    const fn = function () {};
    return new Proxy(fn, {
        get: (target, key) => (key === "prototype" ? target.prototype : member()),
        apply: () => member(),
        construct: () => ({}),
    });
}

function stubClass() {
    return new Proxy(class {}, {
        get: (target, key) => (key in target || typeof key !== "string" ? target[key] : member()),
    });
}

const stub = {};
for (const name of names) {
    stub[name] = /^[A-Z]/.test(name) ? stubClass() : member();
}

const vscodeStub = new Proxy(stub, {
    get: (target, key) => {
        if (key in target || typeof key !== "string") return target[key];
        return /^[A-Z]/.test(key) ? stubClass() : member();
    },
});

const originalLoad = Module._load;
Module._load = function (request, ...rest) {
    return request === "vscode" ? vscodeStub : originalLoad.call(this, request, ...rest);
};

const bundle = require(path.resolve("dist/extension.cjs"));
const exported = Object.keys(bundle).sort();
if (!exported.includes("activate") || !exported.includes("deactivate")) {
    console.error("bundle does not export activate/deactivate:", exported);
    process.exit(1);
}
console.log("bundle loads; exports:", exported.join(", "));
