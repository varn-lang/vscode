# Preparing Varn for GitHub Linguist

Linguist is what GitHub uses to highlight `.vn` files and to name the language
in a repository's language bar. Until Varn is accepted upstream,
`varn-lang/varn` carries `*.vn linguist-language=TypeScript` in
`.gitattributes` as a stand-in for highlighting.

## Upstream requirements

Source: `CONTRIBUTING.md` of github-linguist/linguist, section "Language
extension and filename usage requirements". Re-read it before opening the PR.

- Linguist does not accept very new or hobby languages. Acceptance is decided by
  public usage, assessed with GitHub code search.
- **2000 files** with the extension indexed in the last year, excluding forks
  (`extension:vn NOT is:fork`), for an extension expected to occur many times
  per repository, which `.vn` does.
- A reasonable spread across unique `user/repo` pairs. Users that dominate the
  results (typically the language owner) are filtered out with `-user:<name>`.
- A sample in `samples/Varn/`, with its license stated in the PR.
- A TextMate grammar under an OSS license, added with `script/add-grammar`.
- A `languages.yml` entry: `type: programming`, `color`, `extensions: [.vn]`,
  `tm_scope: source.vn`, `ace_mode`, and the `language_id` from `script/update-ids`.

## Where we stand (measured 2026-11-11)

| Check | Result |
|---|---|
| `extension:vn NOT is:fork` | 2224 files, but not Varn: the top results come from other projects (a SAT solver repo with 60 files, Vine, VastNova, Vanilla, Venice) and unrelated data |
| `extension:vn org:varn-lang` | 0 (repositories were published today and are not indexed yet) |
| `.vn` claimed in Linguist's `languages.yml` | No |
| Language named "Varn" in Linguist | No |

Conclusion: the count that matters is Varn files, not `.vn` files. Other
languages share the extension, so even after Varn has its own volume, Linguist
will need a heuristic to tell them apart. The long pole is adoption, not files
in this repository. Nothing here should be submitted before that exists.

## Grammar readiness

- [x] One grammar file: `syntaxes/vn.tmLanguage.json`, `scopeName: source.vn`,
      Apache-2.0 like the repository.
- [x] Same scope name as `package.json`.
- [x] `pnpm run grammar:scan` tokenizes every `.vn` in a Varn checkout
      (default `../varn-lang`) and exits non-zero on a tokenizer timeout or an
      `invalid.*` scope. Current corpus: 1058 files, 114330 lines, 0 timeouts, 0 invalid.
- [x] Fixed from the first scan: `import` without a trailing `;` never closed and
      left the rest of the file mis-scoped; the decimal suffix is `d` (the lexer
      has `n` and `d`, not `m`); regex literals were scanned as division.
- [ ] 31 kinds of span remain unscoped (about 0.04% of tokens), mostly punctuation
      inside object and mapped types such as `type Partial<T> = { [K in keyof T]?: T[K] }`
      in `crates/varn-builtins/src/modules/core/types/aliases/aliases.vn`.
- [ ] Scope snapshot tests so grammar changes are reviewed.

## Samples

Candidates from `varn-lang/varn` (Apache-2.0): `examples/` and `std/`. Pick files
that show classes, generics, async, pattern matching and decimal and regex
literals. Link the original source and state the license in the PR.

## Once accepted

Delete the TypeScript override from `varn-lang/varn/.gitattributes`.
