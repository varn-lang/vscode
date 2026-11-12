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
    viewport.style.transform = `translate(${panX}px, ${panY}px) scale(${zoom})`;
}

window.addEventListener("message", (event) => {
    const msg = event.data;
    if (msg.type === "updateData") {
        globalData = msg.data;
        renderFunctions();
        vscode.postMessage({
            command: "rendered",
            functions: globalData.functions ? globalData.functions.length : 0
        });
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
        opt.textContent = `fn @${f.name} (${f.blocks.length} blocks)`;
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
        card.id = `block-${block.id}`;
        card.className = "bb-card";
        card.setAttribute("data-block-id", block.id);

        const lvl = blockLevels[bIdx] || 0;
        const indexInLevel = levelMap[lvl].indexOf(bIdx);
        const totalInLevel = levelMap[lvl].length;
        const posX = (indexInLevel - (totalInLevel - 1) / 2) * (BLOCK_WIDTH + HORIZONTAL_GAP) + 350;
        const posY = lvl * LEVEL_HEIGHT + 40;

        card.style.left = `${posX}px`;
        card.style.top = `${posY}px`;

        let instsHtml = "";
        block.insts.forEach((inst, iIdx) => {
            const dest = inst.dest ? `<span class="inst-dest">${inst.dest} =</span>` : "";
            const lineBadge = inst.line > 0 ? `<span class="inst-line-badge">L${inst.line}</span>` : "";
            instsHtml += `
                <div class="inst-line" id="inst-${block.id}-${iIdx}" onclick="jumpToSource(${inst.line})">
                    ${dest}
                    <span class="inst-repr">${escapeHtml(inst.repr)}</span>
                    ${lineBadge}
                </div>
            `;
            allExecutionSteps.push({
                blockId: block.id,
                instIdx: iIdx,
                dest: inst.dest,
                repr: inst.repr
            });
        });

        card.innerHTML = `
            <div class="bb-header">
                <span class="bb-title">${block.id} ${block.params.length ? '(' + block.params.join(', ') + ')' : ''}</span>
                <span class="bb-badge">${block.insts.length} insts</span>
            </div>
            <div class="bb-body">
                ${instsHtml}
                <div class="bb-term" onclick="jumpToSource(${block.term_line})">↳ ${escapeHtml(block.terminator)}</div>
            </div>
        `;

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
        const fromCard = document.getElementById(`block-${block.id}`);
        if (!fromCard) return;

        const startX = fromCard.offsetLeft + fromCard.offsetWidth / 2;
        const startY = fromCard.offsetTop + fromCard.offsetHeight;

        block.successors.forEach(succ => {
            const toCard = document.getElementById(`block-${succ.target}`);
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
    return `M ${x1} ${y1} C ${x1} ${y1 + dy}, ${x2} ${y2 - dy}, ${x2} ${y2}`;
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
    document.getElementById("step-counter").textContent = `${allExecutionSteps.length ? currentStep + 1 : 0} / ${allExecutionSteps.length}`;
    document.querySelectorAll(".bb-card").forEach(c => c.classList.remove("active-execution"));
    document.querySelectorAll(".inst-line").forEach(i => i.classList.remove("active-inst"));

    if (allExecutionSteps.length === 0) return;

    const step = allExecutionSteps[currentStep];
    const card = document.getElementById(`block-${step.blockId}`);
    if (card) card.classList.add("active-execution");

    const instEl = document.getElementById(`inst-${step.blockId}-${step.instIdx}`);
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
            regHtml += `
                <div class="reg-row">
                    <span class="reg-badge">${s.dest}</span>
                    <span class="reg-val">${escapeHtml(s.repr)}</span>
                </div>
            `;
        }
    }
    document.getElementById("reg-count").textContent = `${count} active`;
    regList.innerHTML = regHtml || '<div style="color:#888;font-size:11px;text-align:center;margin-top:20px;">No registers defined yet.</div>';
}

function escapeHtml(text) {
    if (!text) return "";
    return String(text).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

vscode.postMessage({ command: "ready" });
