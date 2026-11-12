# Varn Language Support

VS Code extension for the [Varn](https://github.com/varn-lang/varn) language:
syntax highlighting, diagnostics, hover, go-to-definition, completions,
rename, run and debug. It drives the `vn` binary (`vn lsp` for the language
server), so install Varn first.

Requires VS Code 1.109 or newer. In an untrusted workspace it runs in limited
mode: binaries found inside the workspace are not executed and a workspace
`vn.cli.path` is ignored.

## Development

The extension is written in strict TypeScript and bundled with esbuild into a
single `dist/extension.cjs`.

```sh
pnpm install
pnpm build              # typecheck, manifest check, bundle, then vsce package
```

| Script | What it does |
|---|---|
| `pnpm typecheck` | `tsc` with `strict`, no emit |
| `pnpm check:manifest` | every command in `package.json` is registered exactly once, ids are lowercase |
| `pnpm bundle` | esbuild bundle to `dist/extension.cjs` |
| `pnpm smoke` | loads the bundle against a generated `vscode` stub and checks `activate`/`deactivate` |
| `pnpm scan:tests` | runs the test scanner over a Varn checkout (`../varn-lang`) and fails on a missed `describe`/`it` |
| `pnpm grammar:scan` | tokenizes a Varn checkout with the TextMate grammar and fails on a timeout or `invalid.*` scope |

`scripts/reinstall.ps1` rebuilds the package and reinstalls it into VS Code.

## Grammar

`syntaxes/vn.tmLanguage.json` is the TextMate grammar for `.vn` files. It is the
source the GitHub Linguist submission is prepared from; see `LINGUIST.md`.

## License

Apache-2.0, see `LICENSE`.
