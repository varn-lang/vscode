import * as vscode from "vscode";
import { getClient } from "../client.js";

type InspectorMessage = { command: "goToLine"; line?: number } | { command: "refresh" };

export class VarnVisualInspectorPanel {
    static currentPanel: VarnVisualInspectorPanel | undefined;
    static readonly viewType = "vnVisualInspector";

    private documentUri: vscode.Uri | undefined;
    private readonly disposables: vscode.Disposable[] = [];
    private refreshTimer: ReturnType<typeof setTimeout> | undefined;

    static createOrShow(extensionUri: vscode.Uri, documentUri?: vscode.Uri): void {
        const column = vscode.window.activeTextEditor ? vscode.ViewColumn.Beside : vscode.ViewColumn.One;

        const current = VarnVisualInspectorPanel.currentPanel;
        if (current) {
            current.panel.reveal(column);
            if (documentUri) {
                current.documentUri = documentUri;
                current.scheduleRefresh();
            }
            return;
        }

        const panel = vscode.window.createWebviewPanel(
            VarnVisualInspectorPanel.viewType,
            "Varn Visual CFG & Debug Inspector",
            column,
            { enableScripts: true, retainContextWhenHidden: false, localResourceRoots: [extensionUri] },
        );

        VarnVisualInspectorPanel.currentPanel = new VarnVisualInspectorPanel(panel, extensionUri, documentUri);
    }

    constructor(
        private readonly panel: vscode.WebviewPanel,
        private readonly extensionUri: vscode.Uri,
        documentUri?: vscode.Uri,
    ) {
        this.documentUri = documentUri ?? vscode.window.activeTextEditor?.document.uri;

        this.update();

        this.panel.onDidDispose(() => this.dispose(), null, this.disposables);

        this.panel.webview.onDidReceiveMessage(
            async (message: InspectorMessage) => {
                switch (message.command) {
                    case "goToLine":
                        if (message.line && this.documentUri) await this.revealLine(this.documentUri, message.line);
                        return;
                    case "refresh":
                        void this.refresh();
                        return;
                }
            },
            null,
            this.disposables,
        );

        vscode.workspace.onDidSaveTextDocument(
            (doc) => {
                if (this.documentUri && doc.uri.toString() === this.documentUri.toString()) this.scheduleRefresh();
            },
            null,
            this.disposables,
        );

        vscode.workspace.onDidChangeTextDocument(
            (event) => {
                if (this.documentUri && event.document.uri.toString() === this.documentUri.toString()) {
                    this.scheduleRefresh();
                }
            },
            null,
            this.disposables,
        );
    }

    private async revealLine(uri: vscode.Uri, oneBasedLine: number): Promise<void> {
        try {
            const doc = await vscode.workspace.openTextDocument(uri);
            const editor = await vscode.window.showTextDocument(doc, {
                viewColumn: vscode.ViewColumn.One,
                preserveFocus: true,
            });
            const pos = new vscode.Position(Math.max(0, oneBasedLine - 1), 0);
            editor.selection = new vscode.Selection(pos, pos);
            editor.revealRange(new vscode.Range(pos, pos), vscode.TextEditorRevealType.InCenter);
        } catch (err) {
            console.error("Failed to jump to line:", err);
        }
    }

    scheduleRefresh(): void {
        if (this.refreshTimer) clearTimeout(this.refreshTimer);
        this.refreshTimer = setTimeout(() => void this.refresh(), 500);
    }

    async refresh(): Promise<void> {
        if (!this.documentUri) return;
        const client = getClient();
        if (!client) return;

        try {
            const data: unknown = await client.sendRequest("workspace/executeCommand", {
                command: "vn.getCFG",
                arguments: [this.documentUri.toString()],
            });
            if (data) void this.panel.webview.postMessage({ type: "updateData", data });
        } catch (err) {
            console.error("Error refreshing CFG data:", err);
        }
    }

    private update(): void {
        this.panel.webview.html = this.getHtmlForWebview();
        setTimeout(() => void this.refresh(), 300);
    }

    dispose(): void {
        VarnVisualInspectorPanel.currentPanel = undefined;
        if (this.refreshTimer) clearTimeout(this.refreshTimer);
        this.panel.dispose();
        while (this.disposables.length) this.disposables.pop()?.dispose();
    }

    private getHtmlForWebview(): string {
        const nonce = String(Date.now().toString(36) + Math.random().toString(36).slice(2));
        return `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; script-src 'nonce-${nonce}';">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Varn Visual CFG & Debug Inspector</title>
    <style>
        :root {
            --bg-color: var(--vscode-editor-background, #1e1e1e);
            --fg-color: var(--vscode-editor-foreground, #d4d4d4);
            --border-color: var(--vscode-panel-border, #333333);
            --accent-color: var(--vscode-textLink-foreground, #3794ff);
            --card-bg: var(--vscode-sideBar-background, #252526);
            --card-header: var(--vscode-editorGroupHeader-tabsBackground, #2d2d2d);
            --active-glow: #00d2ff;
        }

        * { box-sizing: border-box; }

        body {
            background-color: var(--bg-color);
            color: var(--fg-color);
            font-family: var(--vscode-font-family, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif);
            margin: 0;
            padding: 0;
            overflow: hidden;
            display: flex;
            flex-direction: column;
            height: 100vh;
            user-select: none;
        }

        /* Top Toolbar */
        .toolbar {
            background: var(--card-header);
            border-bottom: 1px solid var(--border-color);
            padding: 8px 16px;
            display: flex;
            align-items: center;
            gap: 12px;
            z-index: 100;
        }

        .toolbar h3 {
            margin: 0;
            font-size: 13px;
            font-weight: 600;
            display: flex;
            align-items: center;
            gap: 6px;
            white-space: nowrap;
        }

        .function-select {
            background: var(--card-bg);
            color: var(--fg-color);
            border: 1px solid var(--border-color);
            border-radius: 4px;
            padding: 4px 8px;
            font-size: 12px;
            cursor: pointer;
            outline: none;
            max-width: 200px;
        }

        .tabs {
            display: flex;
            gap: 4px;
        }

        .tab-btn {
            background: transparent;
            border: 1px solid transparent;
            color: var(--fg-color);
            padding: 4px 10px;
            border-radius: 4px;
            cursor: pointer;
            font-size: 12px;
            transition: all 0.2s;
        }

        .tab-btn.active {
            background: var(--card-bg);
            border-color: var(--border-color);
            color: var(--accent-color);
            font-weight: 600;
        }

        .tab-btn:hover:not(.active) {
            background: rgba(255, 255, 255, 0.05);
        }

        .stepper-controls {
            margin-left: auto;
            display: flex;
            align-items: center;
            gap: 4px;
            background: var(--card-bg);
            padding: 2px 6px;
            border-radius: 6px;
            border: 1px solid var(--border-color);
        }

        .btn-ctrl {
            background: transparent;
            border: none;
            color: var(--fg-color);
            cursor: pointer;
            padding: 4px 8px;
            border-radius: 3px;
            font-size: 12px;
        }

        .btn-ctrl:hover {
            background: rgba(255, 255, 255, 0.1);
            color: var(--accent-color);
        }

        .step-label {
            font-size: 11px;
            font-family: monospace;
            padding: 0 6px;
            color: var(--accent-color);
            font-weight: 600;
        }

        /* Content Area */
        .content-area {
            flex: 1;
            position: relative;
            overflow: hidden;
            display: flex;
        }

        /* Canvas & Viewport for Pan/Zoom */
        #graph-canvas {
            flex: 1;
            position: relative;
            overflow: hidden;
            background: radial-gradient(circle, rgba(255, 255, 255, 0.04) 1px, transparent 1px);
            background-size: 24px 24px;
            cursor: grab;
        }

        #graph-canvas.grabbing {
            cursor: grabbing;
        }

        #viewport {
            position: absolute;
            top: 0;
            left: 0;
            width: 10000px;
            height: 10000px;
            transform-origin: 0 0;
            pointer-events: none;
        }

        #svg-layer {
            position: absolute;
            top: 0;
            left: 0;
            width: 100%;
            height: 100%;
            pointer-events: none;
            z-index: 1;
        }

        #blocks-container {
            position: absolute;
            top: 0;
            left: 0;
            width: 100%;
            height: 100%;
            pointer-events: none;
            z-index: 2;
        }

        /* Basic Block Node Card */
        .bb-card {
            pointer-events: auto;
            position: absolute;
            background: var(--card-bg);
            border: 1px solid var(--border-color);
            border-radius: 8px;
            width: 360px;
            box-shadow: 0 6px 16px rgba(0, 0, 0, 0.4);
            transition: border-color 0.2s, box-shadow 0.2s;
            overflow: hidden;
            display: flex;
            flex-direction: column;
        }

        .bb-card:hover {
            border-color: var(--accent-color);
        }

        .bb-card.active-execution {
            border-color: #00d2ff !important;
            box-shadow: 0 0 20px rgba(0, 210, 255, 0.5) !important;
        }

        .bb-header {
            background: var(--card-header);
            padding: 8px 12px;
            display: flex;
            justify-content: space-between;
            align-items: center;
            border-bottom: 1px solid var(--border-color);
            font-size: 12px;
            font-weight: 600;
        }

        .bb-title {
            color: var(--accent-color);
            font-family: monospace;
            font-weight: 700;
        }

        .bb-badge {
            background: rgba(255, 255, 255, 0.08);
            padding: 2px 6px;
            border-radius: 10px;
            font-size: 10px;
            color: #888;
        }

        .bb-body {
            padding: 6px;
            font-family: var(--vscode-editor-font-family, "Cascadia Code", Consolas, monospace);
            font-size: 11.5px;
            max-height: 420px;
            overflow-y: auto;
            display: flex;
            flex-direction: column;
            gap: 2px;
        }

        /* Custom Scrollbar for Block */
        .bb-body::-webkit-scrollbar {
            width: 4px;
        }
        .bb-body::-webkit-scrollbar-thumb {
            background: rgba(255, 255, 255, 0.15);
            border-radius: 2px;
        }

        .inst-line {
            padding: 3px 6px;
            border-radius: 4px;
            display: flex;
            align-items: baseline;
            gap: 6px;
            cursor: pointer;
            transition: background 0.1s;
            white-space: nowrap;
            overflow: hidden;
            text-overflow: ellipsis;
        }

        .inst-line:hover {
            background: rgba(255, 255, 255, 0.07);
        }

        .inst-line.active-inst {
            background: rgba(0, 210, 255, 0.22);
            border-left: 3px solid #00d2ff;
        }

        .inst-dest {
            color: #4ec9b0;
            font-weight: 700;
            flex-shrink: 0;
        }

        .inst-repr {
            color: #d4d4d4;
            overflow: hidden;
            text-overflow: ellipsis;
        }

        .inst-line-badge {
            margin-left: auto;
            font-size: 9px;
            color: #666;
            flex-shrink: 0;
        }

        .bb-term {
            margin-top: 4px;
            padding: 6px 8px;
            border-top: 1px dashed var(--border-color);
            color: #c586c0;
            font-weight: 600;
            font-size: 11px;
            cursor: pointer;
            border-radius: 3px;
        }

        .bb-term:hover {
            background: rgba(255, 255, 255, 0.05);
        }

        /* Floating Viewport Controls */
        .floating-controls {
            position: absolute;
            bottom: 16px;
            left: 16px;
            display: flex;
            gap: 6px;
            background: var(--card-bg);
            border: 1px solid var(--border-color);
            border-radius: 6px;
            padding: 4px;
            box-shadow: 0 4px 12px rgba(0,0,0,0.3);
            z-index: 50;
        }

        .floating-btn {
            background: transparent;
            border: 1px solid transparent;
            color: var(--fg-color);
            cursor: pointer;
            padding: 4px 8px;
            border-radius: 4px;
            font-size: 12px;
        }

        .floating-btn:hover {
            background: rgba(255, 255, 255, 0.1);
            color: var(--accent-color);
        }

        /* Side Register & State Inspector */
        .side-inspector {
            width: 340px;
            background: var(--card-bg);
            border-left: 1px solid var(--border-color);
            display: flex;
            flex-direction: column;
            overflow: hidden;
        }

        .side-header {
            padding: 10px 14px;
            font-size: 12px;
            font-weight: 600;
            background: var(--card-header);
            border-bottom: 1px solid var(--border-color);
            display: flex;
            justify-content: space-between;
            align-items: center;
        }

        .register-list {
            flex: 1;
            overflow-y: auto;
            padding: 8px;
            display: flex;
            flex-direction: column;
            gap: 4px;
        }

        .reg-row {
            background: rgba(255, 255, 255, 0.02);
            border: 1px solid rgba(255, 255, 255, 0.05);
            border-radius: 4px;
            padding: 5px 8px;
            display: flex;
            align-items: baseline;
            gap: 8px;
            font-family: monospace;
            font-size: 11.5px;
        }

        .reg-badge {
            background: rgba(78, 201, 176, 0.15);
            color: #4ec9b0;
            border-radius: 3px;
            padding: 1px 5px;
            font-weight: 700;
            font-size: 11px;
            flex-shrink: 0;
        }

        .reg-val {
            color: #ce9178;
            overflow: hidden;
            text-overflow: ellipsis;
            white-space: nowrap;
        }

        .text-view-container {
            display: none;
            flex: 1;
            padding: 16px;
            overflow: auto;
            font-family: monospace;
            font-size: 12px;
            white-space: pre;
            background: var(--bg-color);
        }
    </style>
</head>
<body>
    <div class="toolbar">
        <h3>⚡ Varn CFG & Debug</h3>
        
        <select id="func-selector" class="function-select" onchange="onSelectFunction()">
            <option value="">(Loading functions...)</option>
        </select>

        <div class="tabs">
            <button class="tab-btn active" onclick="switchTab('graph')">📊 CFG Graph</button>
            <button class="tab-btn" onclick="switchTab('bytecode')">📦 Bytecode</button>
        </div>

        <div class="stepper-controls">
            <button class="btn-ctrl" onclick="stepReset()" title="Reset Simulation">⏮</button>
            <button class="btn-ctrl" onclick="stepPrev()" title="Step Previous">◀</button>
            <span class="step-label" id="step-counter">0 / 0</span>
            <button class="btn-ctrl" onclick="stepNext()" title="Step Next">▶</button>
            <button class="btn-ctrl" onclick="stepRun()" title="Run Animation">⏭</button>
        </div>
    </div>

    <div class="content-area">
        <div id="graph-canvas">
            <div id="viewport">
                <svg id="svg-layer"></svg>
                <div id="blocks-container"></div>
            </div>

            <div class="floating-controls">
                <button class="floating-btn" onclick="zoomIn()" title="Zoom In">➕</button>
                <button class="floating-btn" onclick="zoomOut()" title="Zoom Out">➖</button>
                <button class="floating-btn" onclick="resetView()" title="Center & Reset View">🎯 Center</button>
            </div>
        </div>

        <div id="bytecode-view" class="text-view-container"></div>

        <div class="side-inspector">
            <div class="side-header">
                <span>🔍 Live SSA Virtual Registers</span>
                <span id="reg-count" style="font-size:10px;color:#888;">0 active</span>
            </div>
            <div id="register-list" class="register-list">
                <div style="color: #888; font-size: 11px; text-align: center; margin-top: 20px;">
                    Step through the graph to trace virtual register values.
                </div>
            </div>
        </div>
    </div>

    <script nonce="${nonce}">
        const vscode = acquireVsCodeApi();
        let globalData = null;
        let activeFuncIndex = 0;
        let currentStep = 0;
        let allExecutionSteps = [];
        let autoPlayTimer = null;

        // Pan and Zoom
        let zoom = 1.0;
        let panX = 60, panY = 60;
        let isPanning = false;
        let startX = 0, startY = 0;

        const canvas = document.getElementById("graph-canvas");
        const viewport = document.getElementById("viewport");
        const blocksContainer = document.getElementById("blocks-container");
        const svgLayer = document.getElementById("svg-layer");

        canvas.addEventListener("mousedown", (e) => {
            // Pan on background drag, right click, or middle click
            if (e.target === canvas || e.target === svgLayer || e.button === 1 || e.button === 2) {
                isPanning = true;
                startX = e.clientX - panX;
                startY = e.clientY - panY;
                canvas.classList.add("grabbing");
                e.preventDefault();
            }
        });

        window.addEventListener("mousemove", (e) => {
            if (!isPanning) return;
            panX = e.clientX - startX;
            panY = e.clientY - startY;
            updateTransform();
        });

        window.addEventListener("mouseup", () => {
            if (isPanning) {
                isPanning = false;
                canvas.classList.remove("grabbing");
            }
        });

        canvas.addEventListener("wheel", (e) => {
            e.preventDefault();
            const delta = e.deltaY > 0 ? 0.9 : 1.1;
            zoom = Math.min(Math.max(0.2, zoom * delta), 2.5);
            updateTransform();
        });

        function zoomIn() {
            zoom = Math.min(2.5, zoom * 1.2);
            updateTransform();
        }

        function zoomOut() {
            zoom = Math.max(0.2, zoom * 0.8);
            updateTransform();
        }

        function resetView() {
            zoom = 1.0;
            panX = 60;
            panY = 60;
            updateTransform();
        }

        function updateTransform() {
            viewport.style.transform = \`translate(\${panX}px, \${panY}px) scale(\${zoom})\`;
        }

        window.addEventListener("message", (event) => {
            const msg = event.data;
            if (msg.type === "updateData") {
                globalData = msg.data;
                renderFunctions();
            }
        });

        function switchTab(tab) {
            document.querySelectorAll(".tab-btn").forEach(b => b.classList.remove("active"));
            if (tab === "graph") {
                document.querySelectorAll(".tab-btn")[0].classList.add("active");
                document.getElementById("graph-canvas").style.display = "block";
                document.getElementById("bytecode-view").style.display = "none";
                setTimeout(drawEdges, 50);
            } else {
                document.querySelectorAll(".tab-btn")[1].classList.add("active");
                document.getElementById("graph-canvas").style.display = "none";
                document.getElementById("bytecode-view").style.display = "block";
                if (globalData) {
                    document.getElementById("bytecode-view").textContent = globalData.bytecode || "// No bytecode available.";
                }
            }
        }

        function renderFunctions() {
            if (!globalData || !globalData.functions) return;
            const selector = document.getElementById("func-selector");
            selector.innerHTML = "";

            globalData.functions.forEach((f, idx) => {
                const opt = document.createElement("option");
                opt.value = idx;
                opt.textContent = \`fn @\${f.name} (\${f.blocks.length} blocks)\`;
                selector.appendChild(opt);
            });

            if (globalData.functions.length > 0) {
                activeFuncIndex = Math.min(activeFuncIndex, globalData.functions.length - 1);
                selector.value = activeFuncIndex;
                renderGraph();
            }
        }

        function onSelectFunction() {
            const selector = document.getElementById("func-selector");
            activeFuncIndex = parseInt(selector.value) || 0;
            renderGraph();
        }

        function renderGraph() {
            if (!globalData || !globalData.functions || !globalData.functions[activeFuncIndex]) return;
            const func = globalData.functions[activeFuncIndex];

            blocksContainer.innerHTML = "";
            allExecutionSteps = [];
            currentStep = 0;

            const blockLevels = computeBlockLevels(func);
            const levelMap = {};
            blockLevels.forEach((lvl, bIdx) => {
                if (!levelMap[lvl]) levelMap[lvl] = [];
                levelMap[lvl].push(bIdx);
            });

            const LEVEL_HEIGHT = 500;
            const BLOCK_WIDTH = 380;
            const HORIZONTAL_GAP = 80;

            func.blocks.forEach((block, bIdx) => {
                const card = document.createElement("div");
                card.id = \`block-\${block.id}\`;
                card.className = "bb-card";
                card.setAttribute("data-block-id", block.id);

                const lvl = blockLevels[bIdx] || 0;
                const indexInLevel = levelMap[lvl].indexOf(bIdx);
                const totalInLevel = levelMap[lvl].length;
                const posX = (indexInLevel - (totalInLevel - 1) / 2) * (BLOCK_WIDTH + HORIZONTAL_GAP) + 350;
                const posY = lvl * LEVEL_HEIGHT + 40;

                card.style.left = \`\${posX}px\`;
                card.style.top = \`\${posY}px\`;

                let instsHtml = "";
                block.insts.forEach((inst, iIdx) => {
                    const dest = inst.dest ? \`<span class="inst-dest">\${inst.dest} =</span>\` : "";
                    const lineBadge = inst.line > 0 ? \`<span class="inst-line-badge">L\${inst.line}</span>\` : "";
                    instsHtml += \`
                        <div class="inst-line" id="inst-\${block.id}-\${iIdx}" onclick="jumpToSource(\${inst.line})">
                            \${dest}
                            <span class="inst-repr">\${escapeHtml(inst.repr)}</span>
                            \${lineBadge}
                        </div>
                    \`;
                    allExecutionSteps.push({
                        blockId: block.id,
                        instIdx: iIdx,
                        dest: inst.dest,
                        repr: inst.repr
                    });
                });

                card.innerHTML = \`
                    <div class="bb-header">
                        <span class="bb-title">\${block.id} \${block.params.length ? '(' + block.params.join(', ') + ')' : ''}</span>
                        <span class="bb-badge">\${block.insts.length} insts</span>
                    </div>
                    <div class="bb-body">
                        \${instsHtml}
                        <div class="bb-term" onclick="jumpToSource(\${block.term_line})">↳ \${escapeHtml(block.terminator)}</div>
                    </div>
                \`;

                blocksContainer.appendChild(card);
            });

            updateTransform();
            updateStepUI();
            setTimeout(drawEdges, 80);
        }

        function computeBlockLevels(func) {
            const levels = new Array(func.blocks.length).fill(0);
            const visited = new Set();
            const queue = [0];
            visited.add(0);

            while (queue.length > 0) {
                const curr = queue.shift();
                const block = func.blocks[curr];
                if (!block) continue;

                block.successors.forEach(succ => {
                    const targetIdx = parseInt(succ.target.replace('b', ''));
                    if (!isNaN(targetIdx) && targetIdx < func.blocks.length) {
                        levels[targetIdx] = Math.max(levels[targetIdx], levels[curr] + 1);
                        if (!visited.has(targetIdx)) {
                            visited.add(targetIdx);
                            queue.push(targetIdx);
                        }
                    }
                });
            }
            return levels;
        }

        function drawEdges() {
            if (!globalData || !globalData.functions || !globalData.functions[activeFuncIndex]) return;
            const func = globalData.functions[activeFuncIndex];
            svgLayer.innerHTML = "";

            func.blocks.forEach((block) => {
                const fromCard = document.getElementById(\`block-\${block.id}\`);
                if (!fromCard) return;

                const startX = fromCard.offsetLeft + fromCard.offsetWidth / 2;
                const startY = fromCard.offsetTop + fromCard.offsetHeight;

                block.successors.forEach(succ => {
                    const toCard = document.getElementById(\`block-\${succ.target}\`);
                    if (!toCard) return;

                    const endX = toCard.offsetLeft + toCard.offsetWidth / 2;
                    const endY = toCard.offsetTop;

                    const color = succ.kind === "true" ? "#4ec9b0" : (succ.kind === "false" ? "#f14c4c" : "#3794ff");
                    const path = createBezierPath(startX, startY, endX, endY);

                    const pathEl = document.createElementNS("http://www.w3.org/2000/svg", "path");
                    pathEl.setAttribute("d", path);
                    pathEl.setAttribute("stroke", color);
                    pathEl.setAttribute("stroke-width", "2.5");
                    pathEl.setAttribute("fill", "none");
                    if (succ.kind === "false") {
                        pathEl.setAttribute("stroke-dasharray", "4,4");
                    }

                    svgLayer.appendChild(pathEl);
                });
            });
        }

        function createBezierPath(x1, y1, x2, y2) {
            const dy = Math.max(30, (y2 - y1) * 0.45);
            return \`M \${x1} \${y1} C \${x1} \${y1 + dy}, \${x2} \${y2 - dy}, \${x2} \${y2}\`;
        }

        function jumpToSource(line) {
            if (line > 0) {
                vscode.postMessage({
                    command: "goToLine",
                    line
                });
            }
        }

        function stepNext() {
            if (currentStep < allExecutionSteps.length - 1) {
                currentStep++;
                updateStepUI();
            }
        }

        function stepPrev() {
            if (currentStep > 0) {
                currentStep--;
                updateStepUI();
            }
        }

        function stepReset() {
            currentStep = 0;
            clearInterval(autoPlayTimer);
            updateStepUI();
        }

        function stepRun() {
            clearInterval(autoPlayTimer);
            autoPlayTimer = setInterval(() => {
                if (currentStep < allExecutionSteps.length - 1) {
                    stepNext();
                } else {
                    clearInterval(autoPlayTimer);
                }
            }, 500);
        }

        function updateStepUI() {
            document.getElementById("step-counter").textContent = \`\${allExecutionSteps.length ? currentStep + 1 : 0} / \${allExecutionSteps.length}\`;
            document.querySelectorAll(".bb-card").forEach(c => c.classList.remove("active-execution"));
            document.querySelectorAll(".inst-line").forEach(i => i.classList.remove("active-inst"));

            if (allExecutionSteps.length === 0) return;

            const step = allExecutionSteps[currentStep];
            const card = document.getElementById(\`block-\${step.blockId}\`);
            if (card) card.classList.add("active-execution");

            const instEl = document.getElementById(\`inst-\${step.blockId}-\${step.instIdx}\`);
            if (instEl) {
                instEl.classList.add("active-inst");
                instEl.scrollIntoView({ block: "nearest", behavior: "smooth" });
            }

            // Update Register Inspector Table
            const regList = document.getElementById("register-list");
            let regHtml = "";
            let count = 0;
            for (let i = 0; i <= currentStep; i++) {
                const s = allExecutionSteps[i];
                if (s.dest) {
                    count++;
                    regHtml += \`
                        <div class="reg-row">
                            <span class="reg-badge">\${s.dest}</span>
                            <span class="reg-val">\${escapeHtml(s.repr)}</span>
                        </div>
                    \`;
                }
            }
            document.getElementById("reg-count").textContent = \`\${count} active\`;
            regList.innerHTML = regHtml || '<div style="color:#888;font-size:11px;text-align:center;margin-top:20px;">No registers defined yet.</div>';
        }

        function escapeHtml(text) {
            if (!text) return "";
            return String(text).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
        }
    </script>
</body>
</html>`;
    }
}

export function registerVisualInspectorSerializer(extensionUri: vscode.Uri): vscode.Disposable {
    try {
        return vscode.window.registerWebviewPanelSerializer(VarnVisualInspectorPanel.viewType, {
            async deserializeWebviewPanel(panel: vscode.WebviewPanel): Promise<void> {
                VarnVisualInspectorPanel.currentPanel = new VarnVisualInspectorPanel(
                    panel,
                    extensionUri,
                    vscode.window.activeTextEditor?.document.uri,
                );
            },
        });
    } catch {
        return new vscode.Disposable(() => {});
    }
}
