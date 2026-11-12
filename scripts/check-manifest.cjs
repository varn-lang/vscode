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

for (const walkthrough of contributes.walkthroughs ?? []) {
    for (const step of walkthrough.steps) {
        const where = `walkthrough ${walkthrough.id} step ${step.id}`;
        const media = step.media?.markdown;
        if (!media || !fs.existsSync(path.join(root, media))) problems.push(`${where}: missing media file ${media}`);
        const linked = [...step.description.matchAll(/command:([A-Za-z0-9.]+)/g)].map((match) => match[1]);
        const events = (step.completionEvents ?? []).filter((e) => e.startsWith("onCommand:")).map((e) => e.slice(10));
        for (const id of [...linked, ...events]) {
            if (id.startsWith("vn.") && !declared.includes(id)) problems.push(`${where}: references undeclared command ${id}`);
        }
    }
}

for (const welcome of contributes.viewsWelcome ?? []) {
    for (const match of welcome.contents.matchAll(/command:([A-Za-z0-9.]+)/g)) {
        if (match[1].startsWith("vn.") && !declared.includes(match[1])) {
            problems.push(`welcome view ${welcome.view} references undeclared command ${match[1]}`);
        }
    }
}

if (problems.length > 0) {
    for (const problem of problems) console.error(problem);
    process.exit(1);
}
console.log(`manifest ok: ${declared.length} commands declared and registered once`);
