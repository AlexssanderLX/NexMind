// Teste de renderização dos componentes novos (pílula de tarefa, ordem action-first, Micro Apps, painel Security).
// O Vite empacota o harness em modo SSR numa pasta temporária (sem abrir porta); o Node confere o HTML.
// Rodar: node --test frontend/tests/render.test.mjs   (a partir da raiz do repositório)
import test, { before } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL, fileURLToPath } from "node:url";

const frontend = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
let html;

before(async () => {
  // dentro de node_modules/.cache (fora do git): assim o Node acha react-dom ao importar o pacote empacotado
  const out = path.join(frontend, "node_modules", ".cache", "nex-render");
  fs.rmSync(out, { recursive: true, force: true });
  execFileSync(process.execPath, [path.join(frontend, "node_modules", "vite", "bin", "vite.js"), "build", "--ssr", "tests/render-harness.tsx", "--outDir", out, "--emptyOutDir", "false", "--logLevel", "error"], {
    cwd: frontend,
    stdio: "pipe",
  });
  const file = fs.readdirSync(out).find((f) => f.startsWith("render-harness"));
  html = (await import(pathToFileURL(path.join(out, file)).href)).render();
});

const idx = (s, needle) => {
  const i = s.indexOf(needle);
  assert.ok(i >= 0, `não achei "${needle}" em: ${s.slice(0, 300)}`);
  return i;
};

test("action-first: o texto do Nex vem ANTES da pílula", () => {
  assert.ok(idx(html.direct, "Bom dia, Alexssander") < idx(html.direct, "data-task-pill"));
  assert.ok(idx(html.withTool, "O site mostra") < idx(html.withTool, "data-task-pill"));
});

test("a pílula recolhida resume em UMA linha: ferramenta + raciocínio", () => {
  assert.match(html.withTool, /⚡ 1 página lida · 💭 Raciocínio \(\d+ tokens\)/);
  assert.match(html.direct, /💭 Raciocínio \(\d+ tokens\)/);
  assert.match(html.pillOnly, /⚡ 1 nota anotada/);
});

test("recolhida por padrão: os detalhes só aparecem com clique", () => {
  assert.match(html.withTool, /aria-expanded="false"/);
  assert.ok(!html.withTool.includes("Aba [1] https://a.com"), "o log da ferramenta não pode vir aberto");
  assert.ok(!html.direct.includes("Complexidade: direta"), "o planejamento não pode vir aberto");
});

test("ao vivo: a barra mostra o micropasso da ferramenta em execução", () => {
  assert.match(html.live, /⚡ \[Navegador\] abrindo a página url=https:\/\/a\.com…/);
  assert.match(html.live, /data-state="running"/);
  assert.ok(idx(html.live, "Vou abrir o site") < idx(html.live, "data-task-pill"), "fala primeiro, ferramenta depois");
});

test("ao vivo e ainda sem texto: aparece a pílula 'Planejando', não um balão de raciocínio", () => {
  assert.match(html.liveNoText, /💭 Planejando…/);
  assert.ok(!html.liveNoText.includes("text-mute\">…</span>"));
});

test("falha: pílula vermelha com 'Falha na ação · Inspecionar erro'", () => {
  assert.match(html.failed, /⚠️ Falha na ação · Inspecionar erro/);
  assert.match(html.failed, /data-state="error"/);
  assert.match(html.failed, /border-red-400/);
});

test("ação recusada: destaque âmbar", () => {
  assert.match(html.refused, /data-state="warn"/);
  assert.match(html.refused, /border-amber-400/);
  assert.match(html.refused, /⚠️ Ação recusada/);
});

test("mensagem antiga sem raciocínio nem ferramenta não ganha pílula", () => {
  assert.ok(!html.plainOld.includes("data-task-pill"));
  assert.ok(html.plainOld.includes("Mensagem antiga"));
});

test("Micro Apps: seletor com Geral e Security, e o modo ativo marcado", () => {
  for (const s of [html.sidebarGeneral, html.sidebarSecurity]) {
    assert.match(s, /role="radiogroup" aria-label="Micro Apps"/);
    assert.match(s, />Geral</);
    assert.match(s, /Security</);
    assert.match(s, /<svg[^>]*><path d="M12 3l7 3v5/, "ícone de escudo");
  }
  assert.match(html.sidebarGeneral, /role="radio" aria-checked="true"[^>]*>(?:<!-- -->)?Geral/);
  assert.match(html.sidebarSecurity, /aria-checked="true"[^>]*><svg[\s\S]*?Security/);
});

test("barra lateral recolhida tem o botão de escudo que alterna o modo", () => {
  assert.match(html.sidebarCollapsedSecurity, /aria-pressed="true"/);
  assert.match(html.sidebarCollapsedSecurity, /Micro App: Security/);
});

test("painel Security mostra os 6 estágios e a fila vazia", () => {
  assert.equal(html.stages.length, 6);
  for (const [i, name] of html.stages.entries()) assert.ok(html.panel.includes(`${i}. ${name.replaceAll("&", "&amp;")}`), name); // o HTML escreve & como &amp;
  assert.match(html.panel, /Fila de tarefas dos agentes: vazia/);
  assert.match(html.panel, /aria-current="step"/);
});
