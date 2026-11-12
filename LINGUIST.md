# Preparing Varn for GitHub Linguist

Linguist is what GitHub uses to highlight `.vn` files and to name the language
in a repository's language bar. Until Varn is accepted upstream,
`varn-lang/varn` carries `*.vn linguist-language=TypeScript` in
`.gitattributes` as a stand-in for highlighting.

## Upstream requirements (github-linguist/linguist, CONTRIBUTING.md)

Verify against the current CONTRIBUTING.md before opening the PR; these are
the points that decide acceptance.

- [ ] **Usage threshold**: the extension must be in real use on GitHub (the
      guide asks for on the order of 200 unique repositories using it). This is
      the long pole: it depends on adoption, not on files here.
- [ ] **Unique extension**: confirm `.vn` is not already claimed by another
      language in `lib/linguist/languages.yml`, or that heuristics can separate it.
- [ ] **Grammar**: a TextMate grammar under an OSS license, added with
      `script/add-grammar`. Ours is `syntaxes/vn.tmLanguage.json`
      (`scopeName: source.vn`, Apache-2.0, same repo license).
- [ ] **Samples**: real-world `.vn` files in `samples/Varn/`, from repositories
      with a license that allows it. Candidates: `varn-lang/varn` `examples/` and `std/`.
- [ ] **languages.yml entry**: `type: programming`, `color`, `extensions: [.vn]`,
      `tm_scope: source.vn`, `ace_mode`, and the `language_id` produced by
      `script/update-ids`.

## Grammar readiness

- [x] Single grammar file; the stale `vn.tmLanguage.full.backup.json` is gone.
- [x] `scopeName` is `source.vn` and matches the extension's `package.json`.
- [ ] Run the grammar over every `.vn` under `varn-lang/varn/tests` and `std`
      and check for unscoped spans (`script/grammar-compiler` / `vscode-tmgrammar-test`).
- [ ] Add scope snapshot tests so grammar changes are reviewed.

## Once accepted

Delete the TypeScript override from `varn-lang/varn/.gitattributes`.
