const PRELUDE = `
interface Named { name: str; greet(): str }
enum Color { Red, Green, Blue }
class Person implements Named {
    name: str;
    private secret: int = 1;
    static species: str = "human";
    constructor(name: str) { this.name = name }
    greet(): str { return this.name }
    static create(name: str): Person { return new Person(name) }
}
class Student extends Person {
    school: str = "x";
    study(): void {}
}
class Box<T> { value: T; constructor(value: T) { this.value = value } get(): T { return this.value } }
namespace Geometry { export const pi = 3.14; export function area(r: int): int { return r } }
extension Shout on str { shout(): str { return this } }
function make(): Person { return new Person("a") }
const people: Person[] = [];
const p = new Person("ann");
const maybe: str | null = null;
const id: int | str = 1;
`;

module.exports = [
    { name: "instance members", code: "p.‸", includes: ["name", "greet"], excludes: ["secret", "create", "species"] },
    { name: "this sees private members", code: "class A { private x: int = 1; m(): int { return this.‸ } }", includes: ["x", "m"] },
    { name: "static members", code: "Person.‸", includes: ["create", "species"], excludes: ["greet", "name"] },
    { name: "enum members", code: "Color.‸", includes: ["Red", "Green", "Blue"] },
    { name: "inherited members", code: "const s = new Student(\"a\"); s.‸", includes: ["school", "study", "name", "greet"] },
    { name: "super members", code: "class T extends Person { m(): str { return super.‸ } }", includes: ["greet"] },
    { name: "string members", code: "const s = \"x\"; s.‸", includes: ["length"] },
    { name: "array members", code: "people.‸", includes: ["length", "map", "filter", "push"] },
    { name: "map members", code: "const m = new Map<str, int>(); m.‸", includes: ["get", "set", "has"] },
    { name: "generic class member", code: "const b = new Box<int>(1); b.‸", includes: ["value", "get"] },
    { name: "call result", code: "make().‸", includes: ["name", "greet"] },
    { name: "namespace members", code: "Geometry.‸", includes: ["pi", "area"] },
    { name: "extension methods", code: "const s = \"x\"; s.‸", includes: ["shout"] },
    { name: "optional chain on nullable", code: "maybe?.‸", includes: ["length"] },
    { name: "narrowed by is", code: "if (id is str) { id.‸ }", includes: ["length"] },
    { name: "narrowed by null check", code: "if (maybe != null) { maybe.‸ }", includes: ["length"] },
    { name: "interface member", code: "function f(n: Named): str { return n.‸ }", includes: ["name", "greet"] },
    { name: "lambda parameter inferred", code: "people.map(x => x.‸)", includes: ["name", "greet"] },
    { name: "for-of variable", code: "for (const x of people) { x.‸ }", includes: ["name", "greet"] },
    { name: "member in template", code: "const t = `${p.‸}`;", includes: ["name", "greet"] },
    { name: "type position", code: "let a: ‸", includes: ["int", "str", "Person", "Color", "Named"], excludes: ["make", "p"] },
    { name: "generic argument", code: "const l: Array<‸>", includes: ["int", "Person"] },
    { name: "return type", code: "function f(): ‸ {}", includes: ["int", "Person"] },
    { name: "new expression", code: "const x = new ‸", includes: ["Person", "Student", "Box"], excludes: ["Named", "Color"] },
    { name: "extends clause", code: "class A extends ‸", includes: ["Person", "Student"], excludes: ["Named"] },
    { name: "implements clause", code: "class A implements ‸", includes: ["Named"], excludes: ["Person"] },
    { name: "import specifiers", code: "import { ‸ } from \"std:test\";", prelude: false, includes: ["describe", "it", "expect"] },
    { name: "import module path", code: "import { x } from \"std:‸\";", prelude: false, includes: ["std:test", "std:math"] },
    { name: "statement keywords", code: "‸", includes: ["const", "let", "function", "class", "if", "for", "return", "import"] },
    { name: "locals and parameters", code: "function f(alpha: int): int { const beta = 1; return ‸ }", includes: ["alpha", "beta", "make", "Person"] },
    { name: "loop variable", code: "for (let i = 0; i < 3; i++) { ‸ }", includes: ["i"] },
    { name: "no locals from sibling scope", code: "function a(): void { const hidden = 1 }\nfunction b(): void { ‸ }", excludes: ["hidden"] },
    { name: "none inside a line comment", code: "// p.‸", none: true },
    { name: "none inside a string", code: "const s = \"p.‸\";", none: true },
    { name: "none inside a block comment", code: "/* p.‸ */", none: true },
    { name: "prefix filters members", code: "p.gr‸", includes: ["greet"] },
    { name: "named arguments", code: "function greet(greeting: str, formal: bool): str { return greeting }\ngreet(‸)", includes: ["greeting:", "formal:"] },
    { name: "object literal keys", code: "const o: Named = { ‸ }", includes: ["name", "greet"] },
    { name: "destructuring keys", code: "const { ‸ } = p;", includes: ["name", "greet"] },
    { name: "enum in match", code: "const c = Color.Red; const r = match (c) { Color.‸ }", includes: ["Red", "Green", "Blue"] },
    { name: "decorator", code: "@‸\nclass D {}", includes: [] },
    { name: "reflection access", code: "p::‸", includes: [] },
    { name: "after spread", code: "const q = [...‸]", includes: ["people"] },
    { name: "index expression", code: "people[0].‸", includes: ["name", "greet"] },
    { name: "chained generic call", code: "const b = new Box<Person>(p); b.get().‸", includes: ["name", "greet"] },
    { name: "auto import from another file", code: "helper‸", prelude: false, files: { "lib.vn": "export function helperFn(): int { return 1 }" }, autoImport: "helperFn" },
    { name: "empty file", code: "‸", prelude: false, includes: ["const", "function"] },
];

module.exports.push(...require("./edge-cases.cjs"));
module.exports.push(...require("./imports-cases.cjs"));
module.exports.PRELUDE = PRELUDE;
