// Testa a escolha do motor de fala quando o Piper não está instalado.
// Rodar: node --experimental-strip-types --test frontend/tests/ttsEngine.test.mjs
import test from "node:test";
import assert from "node:assert/strict";
import { pickEngine, shouldFallBack } from "../src/lib/ttsEngine.ts";

test("sem falha anterior usa o motor dos ajustes", () => {
  assert.equal(pickEngine("piper", null), "piper");
  assert.equal(pickEngine("sapi", null), "sapi");
});

test("depois que o piper foi recusado, usa a voz do Windows", () => {
  assert.equal(pickEngine("piper", "piper"), "sapi");
});

test("a falha de um motor não afeta outro: se o usuário trocar de motor, vale o novo", () => {
  assert.equal(pickEngine("sapi", "piper"), "sapi");
  assert.equal(pickEngine("outro", "piper"), "outro");
});

test("a voz do Windows nunca cai em si mesma", () => {
  assert.equal(pickEngine("sapi", "sapi"), "sapi");
  assert.equal(shouldFallBack(503, "sapi"), false);
});

test("503 de um motor que não é a voz do Windows pede o plano B", () => {
  assert.equal(shouldFallBack(503, "piper"), true);
});

test("outros erros não disparam o plano B (ficam como erro de verdade)", () => {
  for (const status of [200, 400, 404, 500, 502]) assert.equal(shouldFallBack(status, "piper"), false, String(status));
});
