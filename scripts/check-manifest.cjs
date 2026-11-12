const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const manifest = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8"));
const managerSource = fs.readFileSync(path.join(root, "src", "manager.ts"), "utf8");

const contributes = manifest.contributes;
const declared = contributes.commands.map((entry) => entry.command);
const registered = [...managerSource.matchAll(/registerCmd\(\s*"([^"]+)"/g)].map((match) => match[1]);

const problems = [];

for (const id of new Set(registered.filter((id, index) => registered.indexOf(id) !== index))) {
    problems.push(`command registered more than once: ${id}`);
}
for (const id of declared) {
    if (!registered.includes(id)) problems.push(`command declared but never registered: ${id}`);
}
for (const id of declared) {
    if (!id.startsWith("vn.")) problems.push(`command id must start with vn.: ${id}`);
}

const referenced = [
    ...Object.values(contributes.menus ?? {}).flat().map((entry) => ["menu", entry.command]),
    ...(contributes.keybindings ?? []).map((entry) => ["keybinding", entry.command]),
];
for (const [where, id] of referenced) {
    const isOwn = id.toLowerCase().startsWith("vn.") || id.toLowerCase().startsWith("varn.");
    if (isOwn && !declared.includes(id)) problems.push(`${where} references an undeclared command: ${id}`);
}

if (problems.length > 0) {
    for (const problem of problems) console.error(problem);
    process.exit(1);
}
console.log(`manifest ok: ${declared.length} commands declared and registered once`);
