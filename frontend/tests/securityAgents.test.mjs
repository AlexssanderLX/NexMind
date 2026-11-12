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
