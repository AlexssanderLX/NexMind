// Testa as 6 gavetas da investigação (lib/vaults.ts): catálogo, contagem, selo, formatação e rótulo de "salvo".
// Rodar: node --experimental-strip-types --test frontend/tests/vaults.test.mjs
import test from "node:test";
import assert from "node:assert/strict";
import { VAULTS, countItems, findVault, lastSavedLabel, parseVault, vaultBadge } from "../src/lib/vaults.ts";

test("gavetas: são 6, na ordem pedida, com chave, ícone e nome", () => {
  assert.deepEqual(VAULTS.map((v) => v.key), ["scope", "surface", "hypotheses", "tests", "effects", "evidence"]);
  assert.deepEqual(VAULTS.map((v) => v.name), ["Escopo & Alvos", "Superfície Mapeada", "Hipóteses OWASP", "Testes Executados", "Efeitos & Respostas", "Evidências & PoCs"]);
  for (const v of VAULTS) assert.ok(v.icon && v.hint && v.one && v.many, v.key);
  assert.equal(findVault("effects").name, "Efeitos & Respostas");
});

test("selo: 'Vazio', singular e plural próprios de cada gaveta", () => {
  assert.equal(vaultBadge("surface", 0), "Vazio");
  assert.equal(vaultBadge("surface", 3), "3 rotas");
  assert.equal(vaultBadge("hypotheses", 1), "1 hipótese");
  assert.equal(vaultBadge("hypotheses", 2), "2 hipóteses");
  assert.equal(vaultBadge("evidence", 1), "1 evidência");
});

test("contagem: igual ao backend (ignora títulos e linhas em branco)", () => {
  assert.equal(countItems(""), 0);
  assert.equal(countItems("# Rotas\n- a\n- b\n\n- c\n"), 3);
  assert.equal(countItems("   \n\n"), 0);
  assert.equal(countItems("texto solto"), 1);
});

test("formatada: títulos, itens com - ou *, e parágrafos", () => {
  assert.deepEqual(parseVault("# Rotas\n- GET /a\n* POST /b\n\nobservação"), [
    { kind: "h", text: "Rotas" },
    { kind: "li", text: "GET /a" },
    { kind: "li", text: "POST /b" },
    { kind: "p", text: "observação" },
  ]);
  assert.deepEqual(parseVault(""), []);
});

test("rótulo de salvo: nunca salvo, agora, minutos e data", () => {
  const now = Date.parse("2026-11-12T12:00:00Z");
  assert.equal(lastSavedLabel(null, now), "ainda não salvo");
  assert.equal(lastSavedLabel("lixo", now), "ainda não salvo");
  assert.equal(lastSavedLabel("2026-11-12T11:59:40Z", now), "salvo agora");
  assert.equal(lastSavedLabel("2026-11-12T11:55:00Z", now), "salvo há 5 min");
  assert.match(lastSavedLabel("2026-11-10T09:00:00Z", now), /^salvo em /);
});
