const cp = require("node:child_process");

class Rpc {
    constructor(vn) {
        this.proc = cp.spawn(vn, ["lsp"], { stdio: ["pipe", "pipe", process.env.VN_LSP_STDERR ? "inherit" : "ignore"], windowsHide: true });
        this.buffer = Buffer.alloc(0);
        this.pending = new Map();
        this.next = 1;
        this.logs = [];
        this.proc.stdout.on("data", (chunk) => {
            this.buffer = Buffer.concat([this.buffer, chunk]);
            for (;;) {
                const split = this.buffer.indexOf("\r\n\r\n");
                if (split < 0) return;
                const length = Number(/Content-Length: (\d+)/i.exec(this.buffer.slice(0, split).toString())[1]);
                if (this.buffer.length < split + 4 + length) return;
                const message = JSON.parse(this.buffer.slice(split + 4, split + 4 + length).toString());
                this.buffer = this.buffer.slice(split + 4 + length);
                if (message.id !== undefined && this.pending.has(message.id)) {
                    this.pending.get(message.id)(message);
                    this.pending.delete(message.id);
                } else if (message.method === "window/logMessage") {
                    this.logs.push(message.params.message);
                } else if (message.id !== undefined && message.method) {
                    this.send({ jsonrpc: "2.0", id: message.id, result: null });
                }
            }
        });
    }
    send(message) {
        const body = Buffer.from(JSON.stringify(message));
        this.proc.stdin.write(`Content-Length: ${body.length}\r\n\r\n`);
        this.proc.stdin.write(body);
    }
    request(method, params) {
        const id = this.next++;
        return new Promise((resolve) => {
            this.pending.set(id, resolve);
            this.send({ jsonrpc: "2.0", id, method, params });
        });
    }
    notify(method, params) {
        this.send({ jsonrpc: "2.0", method, params });
    }
}

module.exports = { Rpc };
