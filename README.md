# Varn Language Support

VS Code extension for the [Varn](https://github.com/varn-lang/varn) language:
syntax highlighting, diagnostics, hover, go-to-definition, completions,
rename, run and debug. It drives the `vn` binary (`vn lsp` for the language
server), so install Varn first.

## Build

```sh
pnpm install
pnpm build        # rollup bundle + vsce package -> varn-language-<version>.vsix
```

`scripts/reinstall.ps1` rebuilds the package and reinstalls it into VS Code.

## Grammar

`syntaxes/vn.tmLanguage.json` is the TextMate grammar for `.vn` files. It is the
source the GitHub Linguist submission is prepared from.

## License

MIT, see `LICENSE`.
