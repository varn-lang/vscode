"use strict";

const vscode = require("vscode");
const { ExtensionManager } = require("./src/manager");

/** @type {ExtensionManager | undefined} */
let manager;

async function activate(context) {
    manager = new ExtensionManager(context);
    await manager.start();
}

async function deactivate() {
    if (manager) {
        await manager.stop();
        manager = undefined;
    }
}

module.exports = { activate, deactivate };
