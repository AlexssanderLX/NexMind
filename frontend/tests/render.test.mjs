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

test("barra de etapas: ocupa 100% da largura em grade de 6 colunas (2, 3 e 6 conforme a tela)", () => {
  assert.match(html.taskPanel0, /<section[^>]*class="w-full px-4 pb-2"/);
  assert.match(html.taskPanel0, /<ol class="grid w-full grid-cols-2 gap-2 sm:grid-cols-3 md:grid-cols-6">/);
  assert.equal((html.taskPanel0.match(/<li /g) ?? []).length, 6);
});

test("barra de etapas: cada estágio vira um cartão com o número em destaque e o nome", () => {
  assert.equal(html.stages.length, 6);
  for (const [i, name] of html.stages.entries()) assert.ok(html.taskPanel0.includes(name.replaceAll("&", "&amp;")), name);
  assert.match(html.taskPanel0, /h-7 w-7 [^>]*>0</, "o número do estágio 0 em destaque");
  assert.match(html.taskPanel0, /rounded-xl border px-3 py-3/);
});

test("barra de etapas: estágio ativo com borda luminosa, concluídos com ✓, pendentes apagados", () => {
  const states = (h) => [...h.matchAll(/data-stage-state="(\w+)"/g)].map((m) => m[1]);
  assert.deepEqual(states(html.taskPanel0), ["active", "pending", "pending", "pending", "pending", "pending"]);
  assert.deepEqual(states(html.taskPanel3), ["done", "done", "done", "active", "pending", "pending"]);
  assert.equal((html.taskPanel3.match(/>✓</g) ?? []).length, 3, "três concluídos com ✓");
  assert.match(html.taskPanel3, /aria-current="step"/);
  assert.match(html.taskPanel3, /border-accent bg-accent\/10 [^"]*shadow-\[0_0_20px/, "borda iluminada na etapa ativa");
  assert.match(html.taskPanel3, /concluída/);
  assert.match(html.taskPanel3, /em andamento/);
  assert.match(html.taskPanel3, /pendente/);
});

test("barra de etapas: clicar num cartão é possível (botão) e a fila vazia aparece", () => {
  assert.equal((html.taskPanel0.match(/<button type="button"/g) ?? []).length, 6);
  assert.match(html.taskPanel0, /Fila de tarefas dos agentes: vazia/);
  assert.match(html.taskPanelQueue, /Fila de tarefas dos agentes: 1/);
  assert.match(html.taskPanelQueue, /Mapear \/api/);
});

test("botão do robô: bolinha 🤖 arrastável quando fechado", () => {
  assert.match(html.fabClosed, /aria-label="Abrir Subagentes de Security"/);
  assert.match(html.fabClosed, /🤖/);
  assert.match(html.fabClosed, /orb-btn[^"]*touch-none/);
  assert.match(html.fabClosed, /left:900px;top:400px/);
});

test("menu do robô: os 5 especialistas com emoji, nome e descrição", () => {
  for (const [emoji, name, summary] of [
    ["🧭", "Recon Specialist", "Mapeamento de superfícies, rotas, DOM, formulários e scripts JS"],
    ["🔑", "Auth Specialist", "BOLA/IDOR, BFLA, tokens e Contas A/B"],
    ["💉", "Input Specialist", "XSS, SSRF, SQLi com marcadores inertes"],
    ["⚙️", "Logic Specialist", "Workflows, limites numéricos e uploads"],
    ["🛡️", "Verify Specialist", "Contra-provas e evidências"],
  ]) {
    assert.ok(html.fabMenu.includes(emoji), emoji);
    assert.ok(html.fabMenu.includes(name), name);
    assert.ok(html.fabMenu.includes(summary), summary);
  }
  assert.equal((html.fabMenu.match(/role="menuitem"/g) ?? []).length, 5);
  assert.match(html.fabMenu, /role="menu" aria-label="Subagentes de Security"/);
  const items = html.fabMenu.split('<li role="none">').slice(1);
  const marked = items.filter((it) => /data-open="true"/.test(it)).map((it) => (it.match(/(\w+) Specialist/) ?? [])[1]);
  assert.deepEqual(marked, ["Auth", "Verify"], "os especialistas com janela aberta ficam marcados, vários ao mesmo tempo");
  assert.equal((html.fabMenu.match(/>aberto</g) ?? []).length, 2);
});

test("janela do subagente: nome no topo, botão fechar ✕ e largura de conversa", () => {
  assert.match(html.subWindow, /<section aria-label="Recon Specialist"/);
  assert.match(html.subWindow, /aria-label="Fechar Recon Specialist"/);
  assert.match(html.subWindow, />✕</);
  assert.match(html.subWindow, /width:380px/);
  assert.match(html.subWindow, /Recon Specialist/);
  assert.match(html.subWindow, /🧭/);
});

test("janela do subagente: interface enxuta, só texto e clipe de arquivo (sem áudio)", () => {
  assert.match(html.subWindow, /<textarea[^>]*aria-label="Mensagem para o Recon Specialist"/);
  assert.match(html.subWindow, /aria-label="Anexar arquivo"/);
  assert.match(html.subWindow, /type="file"/);
  assert.match(html.subWindow, /aria-label="Enviar"/);
  assert.ok(!/microfone|áudio|audio|voz|gravar|ditar|<audio/i.test(html.subWindow), "sem nenhum controle de áudio");
  assert.equal((html.subWindow.match(/<button/g) ?? []).length, 3, "fechar, clipe e enviar: nada mais");
});

test("janela do subagente: histórico exclusivo, começa com a orientação do especialista", () => {
  assert.match(html.subWindow, /data-subagent-messages/);
  assert.match(html.subWindow, /Fale com o Recon Specialist\. Ele só trata da especialidade dele/);
});

test("FloatingPanel: os painéis existentes continuam como eram (288px, botão – de recolher)", () => {
  assert.match(html.plainPanel, /width:288px/);
  assert.match(html.plainPanel, /title="Recolher em bolinha"/);
  assert.match(html.plainPanel, />–</);
});
