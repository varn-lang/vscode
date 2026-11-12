# Install Varn

The extension runs your code with the `vn` program. It looks for it in this order:

1. the `vn.cli.path` setting
2. `VN_HOME/bin`
3. the `target/release` or `target/debug` folder of the workspace
4. your `PATH`

Run `vn --version` in a terminal to check that it resolves.
