// Testa o prompt do modo Security, o catálogo dos subagentes e os helpers do micro-chat.
// Rodar: node --experimental-strip-types --test frontend/tests/securityAgents.test.mjs
import test from "node:test";
import assert from "node:assert/strict";
import { SECURITY_AGENTS, SECURITY_DOMAIN_PROMPT, SECURITY_KNOWLEDGE, clampWindow, composeSystem, splitAttachments } from "../src/lib/securityAgents.ts";

test("catálogo: 5 especialistas, na ordem, com nome, emoji e resumo", () => {
  assert.deepEqual(SECURITY_AGENTS.map((a) => a.id), ["recon", "auth", "input", "logic", "verify"]);
  assert.deepEqual(SECURITY_AGENTS.map((a) => a.emoji), ["🧭", "🔑", "💉", "⚙️", "🛡️"]);
  assert.deepEqual(SECURITY_AGENTS.map((a) => a.name), ["Recon Specialist", "Auth Specialist", "Input Specialist", "Logic Specialist", "Verify Specialist"]);
  for (const a of SECURITY_AGENTS) assert.ok(a.summary.length > 10, a.id);
});

test("modo Geral: o system das Configurações segue como está (só sem espaços nas pontas)", () => {
  assert.equal(composeSystem("  seja breve  ", "general"), "seja breve");
  assert.equal(composeSystem("", "general"), "");
});

test("modo Security: injeta a instrução de domínio do Nex Security", () => {
  const s = composeSystem("", "security");
  assert.ok(s.startsWith("Você está operando como o Nex Security (Pentest & Bug Bounty Workbench)."));
  assert.ok(s.includes("especialista sênior de segurança ofensiva ética"));
  assert.ok(s.includes("OWASP WSTG v4.2"));
  assert.ok(s.includes("explique o Workbench, os 6 estágios e as ferramentas disponíveis com maestria."));
});

test("modo Security: o system das Configurações vem antes e é preservado", () => {
  const s = composeSystem("Responda em português.", "security");
  assert.ok(s.startsWith("Responda em português.\n\nVocê está operando como o Nex Security"));
});

test("modo Security: o modelo recebe o conhecimento para explicar o app (estágios, Workbench, subagentes, notas)", () => {
  const s = composeSystem("", "security");
  for (const stage of ["Escopo & Autorização", "Mapear Superfície", "Formular Hipótese", "Teste Mínimo Seguro", "Interpretar Efeito", "Evidência & Relatório"]) assert.ok(s.includes(stage), stage);
  assert.ok(s.includes("/workbench.html"));
  for (const a of ["Recon", "Auth", "Input", "Logic", "Verify"]) assert.ok(s.includes(a), a);
  assert.ok(s.includes("recon.md") && s.includes("INDEX.md"));
  assert.ok(s.includes("Você NÃO lê essas notas por conta própria"), "a regra de ouro do micro-RAG está no prompt");
  assert.ok(s.includes("BOLA/IDOR") && s.includes("SSRF") && s.includes("contraprovas"));
});

test("o prompt do modo é compacto (~450 tokens de conhecimento + a instrução), para não pesar", () => {
  assert.ok(SECURITY_DOMAIN_PROMPT.length + SECURITY_KNOWLEDGE.length < 3200, String(SECURITY_DOMAIN_PROMPT.length + SECURITY_KNOWLEDGE.length));
});

test("anexos do micro-chat: separa o texto e mostra só nome e tamanho", () => {
  const { files, body } = splitAttachments("[[ARQUIVO req.txt]]\nGET /a HTTP/1.1\n[[/ARQUIVO]]\n\nmapeie isto");
  assert.deepEqual(files, [{ name: "req.txt", chars: 15 }]);
  assert.equal(body, "mapeie isto");
  const two = splitAttachments("[[ARQUIVO a.js]]\nx\n[[/ARQUIVO]]\n\n[[ARQUIVO b.html]]\n<b/>\n[[/ARQUIVO]]\n\nolha");
  assert.equal(two.files.length, 2);
  assert.equal(two.body, "olha");
  assert.deepEqual(splitAttachments("só texto"), { files: [], body: "só texto" });
});

test("anexo já guardado no histórico (conteúdo omitido) vira só o chip", () => {
  const { files, body } = splitAttachments("[[ARQUIVO req.txt]]\n(conteúdo omitido do histórico)\n[[/ARQUIVO]]\nmapeie isto");
  assert.equal(files[0].name, "req.txt");
  assert.equal(body, "mapeie isto");
});

test("janela flutuante: nunca sai da área", () => {
  const bounds = { w: 1000, h: 700 };
  const size = { w: 380, h: 440 };
  assert.deepEqual(clampWindow({ x: 100, y: 100 }, bounds, size), { x: 100, y: 100 });
  assert.deepEqual(clampWindow({ x: -50, y: -9 }, bounds, size), { x: 0, y: 0 });
  assert.deepEqual(clampWindow({ x: 900, y: 600 }, bounds, size), { x: 620, y: 260 });
  assert.deepEqual(clampWindow({ x: 5, y: 5 }, { w: 200, h: 200 }, size), { x: 0, y: 0 }, "área menor que a janela");
});

// ---------- várias janelas de subagente ao mesmo tempo ----------
import { cascadePos, closeWindow, openWindow, windowZ } from "../src/lib/securityAgents.ts";
import { clampWindow as clampGeometry } from "../src/lib/geometry.ts";

test("janelas: abrir vários especialistas ao mesmo tempo, sem duplicar", () => {
  let order = [];
  order = openWindow(order, "recon");
  order = openWindow(order, "auth");
  order = openWindow(order, "input");
  assert.deepEqual(order, ["recon", "auth", "input"]);
  assert.equal(openWindow(order, "recon").filter((x) => x === "recon").length, 1, "reabrir não duplica");
});

test("janelas: tocar numa janela já aberta a traz para a frente (última da pilha)", () => {
  const order = ["recon", "auth", "input"];
  assert.deepEqual(openWindow(order, "recon"), ["auth", "input", "recon"]);
  assert.deepEqual(openWindow(order, "input"), ["recon", "auth", "input"]);
});

test("janelas: fechar uma não mexe nas outras", () => {
  assert.deepEqual(closeWindow(["recon", "auth", "input"], "auth"), ["recon", "input"]);
  assert.deepEqual(closeWindow(["recon"], "recon"), []);
  assert.deepEqual(closeWindow(["recon"], "logic"), ["recon"], "fechar o que não está aberto é inofensivo");
});

test("janelas: o z-index cresce até a janela da frente (e fica acima dos painéis do Nex, que usam 30)", () => {
  const order = ["recon", "auth", "input"];
  assert.ok(windowZ(order, "recon") < windowZ(order, "auth") && windowZ(order, "auth") < windowZ(order, "input"));
  assert.ok(windowZ(order, "recon") > 30);
  assert.equal(windowZ(["recon"], "verify"), 40, "fora da pilha não quebra");
});

test("janelas: cada nova janela abre em cascata, deslocada da anterior, e inteira dentro da tela", () => {
  const bounds = { w: 1280, h: 800 };
  const size = { w: 380, h: 460 };
  const pos = [0, 1, 2, 3, 4].map((i) => cascadePos(i, bounds, size));
  for (let i = 1; i < pos.length; i++) assert.ok(pos[i].x < pos[i - 1].x && pos[i].y > pos[i - 1].y, `janela ${i} deslocada da ${i - 1}`);
  for (const p of pos) assert.ok(p.x >= 0 && p.y >= 0 && p.x + size.w <= bounds.w && p.y + size.h <= bounds.h);
});

test("janelas: em tela pequena a cascata nunca sai da área", () => {
  const p = cascadePos(4, { w: 500, h: 520 }, { w: 380, h: 460 });
  assert.ok(p.x >= 0 && p.y >= 0 && p.x + 380 <= 500 + 1e-9 && p.y + 460 <= 520 + 1e-9, JSON.stringify(p));
});

// ---------- painéis nos cantos da tela (o menu do robô saía cortado) ----------
test("cantos: o menu do robô (288x335) cabe inteiro nos 4 cantos e no meio", () => {
  const bounds = { w: 1280, h: 800 };
  const menu = { w: 288, h: 335 };
  for (const corner of [{ x: 0, y: 0 }, { x: 1204, y: 0 }, { x: 0, y: 724 }, { x: 1204, y: 724 }, { x: 640, y: 400 }]) {
    const p = clampGeometry(corner, bounds, menu);
    assert.ok(p.x >= 0 && p.y >= 0 && p.x + menu.w <= bounds.w && p.y + menu.h <= bounds.h, `canto ${JSON.stringify(corner)} -> ${JSON.stringify(p)}`);
  }
});

test("cantos: o caso do print (robô em y=470 numa tela de 800) sobe o painel em vez de cortar a base", () => {
  const p = clampGeometry({ x: 1180, y: 470 }, { w: 1280, h: 800 }, { w: 288, h: 335 });
  assert.deepEqual(p, { x: 992, y: 465 });
});

test("cantos: reservar só o tamanho de uma bolinha (o erro antigo) cortava o painel", () => {
  const old = clampGeometry({ x: 1180, y: 470 }, { w: 1280, h: 800 }, { w: 288, h: 76 });
  assert.ok(old.y + 335 > 800, "com 76 px de altura o painel de 335 px passava da borda");
});

test("cantos: painel maior que a área fica no canto superior esquerdo, sem posição negativa", () => {
  assert.deepEqual(clampGeometry({ x: 50, y: 50 }, { w: 200, h: 200 }, { w: 380, h: 460 }), { x: 0, y: 0 });
});
