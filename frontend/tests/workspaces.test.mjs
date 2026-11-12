// Testa os workspaces (modos Geral, Security e Dev), o isolamento das listas e o favicon.
// Rodar: node --experimental-strip-types --test frontend/tests/workspaces.test.mjs
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { WORKSPACES, filterByMode, parseMode, workspaceOf } from "../src/lib/workspaces.ts";
import { SECURITY_DOMAIN_PROMPT, composeSystem } from "../src/lib/securityAgents.ts";
import { DEV_DOMAIN_PROMPT } from "../src/lib/devPrompt.ts";

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");

test("workspaces: Geral, Security e Dev, nessa ordem, com ícone, nome e resumo", () => {
  assert.deepEqual(WORKSPACES.map((w) => w.mode), ["general", "security", "dev"]);
  assert.deepEqual(WORKSPACES.map((w) => w.icon), ["🌐", "🛡️", "💻"]);
  assert.deepEqual(WORKSPACES.map((w) => w.name), ["Geral", "Security", "Dev"]);
  for (const w of WORKSPACES) assert.ok(w.summary.length > 5, w.mode);
  assert.equal(workspaceOf("dev").name, "Dev");
});

test("modo: valor desconhecido, vazio ou lixo vira Geral", () => {
  assert.equal(parseMode("security"), "security");
  assert.equal(parseMode("dev"), "dev");
  for (const v of ["general", "", null, undefined, "hacker", 3]) assert.equal(parseMode(v), "general", String(v));
});

test("isolamento: a lista de cada modo mostra só as conversas dele; sem o campo é do Geral", () => {
  const items = [
    { id: "1", title: "g", updatedAt: "x", mode: "general" },
    { id: "2", title: "s", updatedAt: "x", mode: "security" },
    { id: "3", title: "d", updatedAt: "x", mode: "dev" },
    { id: "4", title: "antiga", updatedAt: "x" },
  ];
  assert.deepEqual(filterByMode(items, "general").map((c) => c.id), ["1", "4"]);
  assert.deepEqual(filterByMode(items, "security").map((c) => c.id), ["2"]);
  assert.deepEqual(filterByMode(items, "dev").map((c) => c.id), ["3"]);
  assert.deepEqual(filterByMode([], "dev"), []);
});

test("prompt: Dev tem a instrução própria, Security a dele, Geral fica enxuto", () => {
  assert.equal(composeSystem("base", "general"), "base");
  assert.ok(composeSystem("base", "dev").includes(DEV_DOMAIN_PROMPT));
  assert.ok(!composeSystem("base", "dev").includes(SECURITY_DOMAIN_PROMPT));
  assert.ok(composeSystem("base", "security").includes(SECURITY_DOMAIN_PROMPT));
});

test("favicon: SVG próprio com orbe ciano e roxo, ligado no index.html", () => {
  const svg = fs.readFileSync(path.join(ROOT, "public", "favicon.svg"), "utf8");
  assert.match(svg, /^<svg[^>]*xmlns="http:\/\/www\.w3\.org\/2000\/svg"/);
  assert.match(svg, /#22d3ee|#67e8f9/i, "ciano");
  assert.match(svg, /#7c3aed/i, "roxo");
  assert.ok(svg.length < 3000, "pequeno");
  const html = fs.readFileSync(path.join(ROOT, "index.html"), "utf8");
  assert.match(html, /<link rel="icon" type="image\/svg\+xml" href="\/favicon\.svg"/);
});
