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

test("sidebar: sem o bloco 'Micro Apps' e sem o botão de escudo, limpa e focada nas conversas", () => {
  for (const s of [html.sidebarGeneral, html.sidebarSecurity, html.sidebarCollapsedSecurity]) {
    assert.doesNotMatch(s, /Micro App/);
    assert.doesNotMatch(s, /radiogroup/);
    assert.doesNotMatch(s, /M12 3l7 3v5/, "sem o ícone de escudo");
  }
  assert.match(html.sidebarGeneral, /Nova conversa/);
  assert.match(html.sidebarGeneral, /Recentes/);
});

test("sidebar: mostra só as conversas do modo ativo", () => {
  // o harness passa 3 conversas: uma geral, uma security e uma antiga sem o campo mode (= geral)
  assert.match(html.sidebarGeneral, /Conversa geral/);
  assert.match(html.sidebarGeneral, /Conversa antiga/);
  assert.doesNotMatch(html.sidebarGeneral, /Conversa de seguranca/);
  assert.match(html.sidebarSecurity, /Conversa de seguranca/);
  assert.doesNotMatch(html.sidebarSecurity, /Conversa geral|Conversa antiga/);
  assert.match(html.sidebarDev, /Nenhuma conversa neste modo ainda/);
});

test("switcher compacto: botão com ícone, nome do modo e setinha", () => {
  assert.match(html.switcherSecurity, /aria-haspopup="menu"/);
  assert.match(html.switcherSecurity, /aria-expanded="false"/);
  assert.match(html.switcherSecurity, /🛡️/);
  assert.match(html.switcherSecurity, />Security</);
  assert.match(html.switcherSecurity, /▾/);
  assert.match(html.switcherDev, /💻[\s\S]*>Dev</);
  assert.doesNotMatch(html.switcherSecurity, /role="menu"/, "o menu só abre no clique");
});

test("switcher compacto: bloqueado enquanto o Nex responde", () => {
  assert.match(html.switcherDisabled, /disabled=""/);
});

test("gavetas: ocupam 100% da largura em grade de 6 colunas (2, 3 e 6 conforme a tela)", () => {
  assert.match(html.taskPanel0, /<section[^>]*class="w-full px-4 pb-2"/);
  assert.match(html.taskPanel0, /<ul class="grid w-full grid-cols-2 gap-2 sm:grid-cols-3 md:grid-cols-6">/);
  assert.equal((html.taskPanel0.match(/<li /g) ?? []).length, 6);
});

test("gavetas: cada uma é um cartão com ícone, nome e o selo da contagem", () => {
  assert.equal(html.vaults.length, 6);
  for (const v of html.vaults) {
    assert.ok(html.taskPanel0.includes(v.name.replaceAll("&", "&amp;")), v.name);
    assert.ok(html.taskPanel0.includes(v.icon), v.icon);
  }
  assert.equal((html.taskPanel0.match(/>Vazio</g) ?? []).length, 6, "sem dados, todas dizem Vazio");
  assert.match(html.taskPanelCounts, /3 rotas/);
  assert.match(html.taskPanelCounts, /1 hipótese</);
  assert.match(html.taskPanelCounts, /data-vault="surface" data-count="3"/);
});

test("gavetas: sem esteira (nada de pendente, em andamento ou concluída) e com dica de hover", () => {
  for (const h of [html.taskPanel0, html.taskPanelCounts]) {
    assert.doesNotMatch(h, /pendente|em andamento|concluída|aria-current|data-stage-state/i);
  }
  assert.match(html.taskPanel0, /clique para editar/);
  assert.match(html.taskPanel0, /hover:border-accent\/60/);
});

test("gavetas: todo cartão é um botão clicável e a mensagem de bancada aparece", () => {
  assert.equal((html.taskPanel0.match(/<button type="button"/g) ?? []).length, 6);
  assert.match(html.taskPanel0, /Bancada pronta: mapeie superfícies/);
  assert.match(html.taskPanelQueue, /Fila de tarefas dos agentes: 1/);
  assert.match(html.taskPanelQueue, /Mapear \/api/);
});

test("modal da gaveta: renderiza as notas formatadas (títulos, itens, parágrafos) e o estado vazio", () => {
  assert.match(html.vaultFormatted, /<h3[^>]*>Rotas<\/h3>/);
  assert.equal((html.vaultFormatted.match(/•/g) ?? []).length, 2, "dois itens com marcador");
  assert.match(html.vaultFormatted, /GET \/api\/users\/\{id\}/);
  assert.match(html.vaultFormatted, /Texto solto/);
  assert.match(html.vaultEmpty, /Gaveta vazia/);
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

test("Dev explorador: sem pasta, só o botão Abrir Pasta (nada de campo para digitar o caminho)", () => {
  assert.match(html.explorerEmpty, /📂 Abrir Pasta/);
  assert.doesNotMatch(html.explorerEmpty, /<input/);
  assert.doesNotMatch(html.explorerEmpty, /placeholder/);
  assert.doesNotMatch(html.explorerEmpty, /C:\caminho/);
});

test("Dev explorador: com pasta, o nome do projeto em negrito no topo, com chevron, atualizar e trocar", () => {
  assert.match(html.explorerOpen, /aria-expanded="true"/);
  assert.match(html.explorerOpen, /font-bold[^>]*>[\s\S]*?📁[\s\S]*?>ia-local</);
  assert.match(html.explorerOpen, /aria-label="Atualizar a árvore"/);
  assert.match(html.explorerOpen, /aria-label="Trocar de pasta"/);
  assert.doesNotMatch(html.explorerOpen, /Abrir Pasta<\/button>/, "o botão grande some quando há pasta");
});

test("Dev explorador: ícones por tipo de arquivo na árvore", () => {
  for (const label of [">TSX<", ">npm<", ">M↓<", ">&gt;_<"]) assert.ok(html.explorerOpen.includes(label), label);
  assert.match(html.explorerOpen, /data-file-icon/);
});

test("Dev editor vazio: Núcleo do Nex, marca Nex Dev, instrução e modelo", () => {
  for (const h of [html.welcome3d, html.welcomeCss, html.viewerEmpty]) {
    assert.match(h, />Nex Dev</);
    assert.match(h, /Selecione um arquivo na árvore à esquerda para editar com o agente\./);
    assert.match(h, /nex-unfiltered:latest/);
  }
  assert.match(html.welcome3d, /<canvas/, "o núcleo 3D (canvas WebGL)");
  assert.match(html.welcomeCss, /radial-gradient/, "sem WebGL, o orbe de CSS");
  assert.doesNotMatch(html.viewerEmpty, /Abra um arquivo na árvore à esquerda\./);
});

test("Dev editor com arquivo: aba com ● se não salvo, fechar ×, números de linha e a tela de boas-vindas some", () => {
  assert.match(html.viewerTabs, /● Program\.cs/);
  assert.match(html.viewerTabs, /aria-label="Fechar src\/Program\.cs"/);
  assert.match(html.viewerTabs, /<div class="px-2">1<\/div><div class="px-2">2<\/div>/);
  assert.doesNotMatch(html.viewerTabs, /Nex Dev/);
});
