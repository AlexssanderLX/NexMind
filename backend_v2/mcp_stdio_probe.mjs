// Handshake MCP minimo (JSON-RPC por stdio) contra um comando arbitrario, igual ao mcp_servers do Hermes/Nex.
// Uso: node mcp_stdio_probe.mjs <comando> <arg1> <arg2> ...
import { spawn } from "node:child_process";
import readline from "node:readline";

const [cmd, ...args] = process.argv.slice(2);
const child = spawn(cmd, args, { stdio: ["pipe", "pipe", "pipe"] });
let stderrBuf = "";
child.stderr.on("data", (d) => { stderrBuf += String(d); });
const pending = new Map();
let nextId = 1;
readline.createInterface({ input: child.stdout }).on("line", (line) => {
  let msg;
  try { msg = JSON.parse(line); } catch { return; }
  if (msg.id && pending.has(msg.id)) { pending.get(msg.id)(msg); pending.delete(msg.id); }
});
const rpc = (method, params, timeoutMs = 60000) =>
  new Promise((resolve, reject) => {
    const id = nextId++;
    const timer = setTimeout(() => reject(new Error("timeout " + method)), timeoutMs);
    pending.set(id, (m) => { clearTimeout(timer); resolve(m); });
    child.stdin.write(JSON.stringify({ jsonrpc: "2.0", id, method, params }) + "\n");
  });
const notify = (method, params) => child.stdin.write(JSON.stringify({ jsonrpc: "2.0", method, params }) + "\n");

try {
  const t0 = Date.now();
  const init = await rpc("initialize", { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "nex-probe", version: "0.1" } });
  console.log("initialize ->", JSON.stringify(init.result?.serverInfo ?? init.error));
  notify("notifications/initialized", {});
  const list = await rpc("tools/list", {});
  const tools = list.result?.tools ?? [];
  console.log("tools:", tools.length, "->", tools.map((t) => t.name).join(", "));
  console.log("handshake total:", ((Date.now() - t0) / 1000).toFixed(1), "s");
} catch (e) {
  console.log("ERRO:", e.message);
  console.log("stderr:", stderrBuf.slice(0, 1500));
} finally {
  child.kill();
  process.exit(0);
}
