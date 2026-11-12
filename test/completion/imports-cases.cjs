const REFLECT = "import { ClassRef, FunctionRef } from \"std:reflect\";\n";
const TEST = "import { describe, it, expect } from \"std:test\";\n";

module.exports = [
    { name: "member of an imported interface", code: `${REFLECT}function f(cls: ClassRef): void { print(cls.‸); }`, prelude: false, includes: ["name"] },
    { name: "imported interface in a call argument", code: `${REFLECT}let log: str[] = [];\nfunction f(cls: ClassRef): void { log.push(cls.‸); }`, prelude: false, includes: ["name"] },
    { name: "imported interface after a call argument", code: `${REFLECT}function g(a: str, b: str): void {}\nfunction f(cls: ClassRef): void { g(cls.name, cls.‸); }`, prelude: false, includes: ["name"] },
    { name: "second imported interface", code: `${REFLECT}function f(fn: FunctionRef): void { print(fn.‸); }`, prelude: false, includes: ["name", "length"] },
    { name: "imported interface in a lambda", code: `${REFLECT}const h = (cls: ClassRef): str => cls.‸;`, prelude: false, includes: ["name"] },
    { name: "imported interface in a return", code: `${REFLECT}function f(cls: ClassRef): str { return cls.‸; }`, prelude: false, includes: ["name"] },
    { name: "imported interface in a method", code: `${REFLECT}class H { m(cls: ClassRef): str { return cls.‸; } }`, prelude: false, includes: ["name"] },
    { name: "imported interface in a template", code: `${REFLECT}function f(cls: ClassRef): str { return \`\${cls.‸}\`; }`, prelude: false, includes: ["name"] },
    { name: "imported interface in a condition", code: `${REFLECT}function f(cls: ClassRef): void { if (cls.‸ == "a") {} }`, prelude: false, includes: ["name"] },
    { name: "imported interface in an array literal", code: `${REFLECT}function f(cls: ClassRef): str[] { return [cls.‸]; }`, prelude: false, includes: ["name"] },
    { name: "imported interface in an object literal", code: `${REFLECT}function f(cls: ClassRef): void { const o = { n: cls.‸ }; }`, prelude: false, includes: ["name"] },
    { name: "imported interface as a decorator target", code: `${REFLECT}function track(cls: ClassRef): void { print(cls.‸); }\n@track\nclass D {}`, prelude: false, includes: ["name"] },
    { name: "imported function call result", code: `${TEST}describe("x", () => { it("y", () => { expect(1).‸ }) });`, prelude: false, includes: ["toBe"] },
    { name: "member through a std call in the middle of a block", code: `${TEST}describe("x", () => {\n    const a = 1;\n    a.‸\n    const b = 2;\n});`, prelude: false, includes: ["toString"] },
];
