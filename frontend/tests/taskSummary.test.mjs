// Testa o texto e o estado da pílula de tarefa (ferramentas + raciocínio).
// Rodar: node --experimental-strip-types --test frontend/tests/taskSummary.test.mjs
import test from "node:test";
import assert from "node:assert/strict";
import { collapsedLine, liveStatus, pillState, summarizeTools, thinkingTokens, toolLabel, toolShort, toolVerb } from "../src/lib/taskSummary.ts";

const run = (name, state, extra = {}) => ({ name, state, ...extra });
const dom = (state = "concluida") => run("browser__browser_get_dom", state);

test("rótulos e nomes curtos", () => {
  assert.equal(toolLabel("browser__browser_get_dom"), "Navegador");
  assert.equal(toolLabel("arquivos__read_text_file"), "Arquivos");
  assert.equal(toolLabel("desktop__desktop_click_element"), "Computador");
  assert.equal(toolLabel("topic_write"), "Caderno");
  assert.equal(toolLabel("pesquisa"), "Pesquisa");
  assert.equal(toolLabel("outra"), "Ferramenta");
  assert.equal(toolShort("browser__browser_get_dom"), "browser_get_dom");
  assert.equal(toolShort("topic_read"), "topic_read");
});

test("verbos da telemetria ao vivo", () => {
  assert.equal(toolVerb("browser__browser_get_dom"), "lendo a página");
  assert.equal(toolVerb("browser__browser_navigate"), "abrindo a página");
  assert.equal(toolVerb("arquivos__read_text_file"), "lendo o arquivo");
  assert.equal(toolVerb("topic_write"), "anotando no caderno");
  assert.equal(toolVerb("desktop__desktop_take_screenshot"), "capturando a tela");
  assert.equal(toolVerb("x__coisa_nova"), "coisa_nova");
});

test("resumo: conta só o que concluiu, no singular e no plural", () => {
  assert.equal(summarizeTools([dom()]), "1 página lida");
  assert.equal(summarizeTools([dom(), dom(), run("browser__browser_navigate", "concluida")]), "2 páginas lidas, 1 página aberta");
  assert.equal(summarizeTools([dom("falhou"), dom("executando")]), "");
  assert.equal(summarizeTools([run("topic_write", "concluida"), run("arquivos__read_text_file", "concluida")]), "1 arquivo lido, 1 nota anotada");
  assert.equal(summarizeTools([run("alguma__ferramenta_nova", "concluida")]), "1 ferramenta");
  assert.equal(summarizeTools([]), "");
});

test("estado da pílula: erro > recusa > ao vivo > ok", () => {
  assert.equal(pillState([dom("falhou")], true), "error");
  assert.equal(pillState([run("browser__browser_click", "recusada")], false), "warn");
  assert.equal(pillState([dom("falhou"), run("x", "recusada")], false), "error");
  assert.equal(pillState([dom()], true), "running");
  assert.equal(pillState([dom()], false), "ok");
  assert.equal(pillState([], false), "ok");
});

test("ao vivo: mostra a ferramenta em execução com o resumo dos argumentos", () => {
  const live = liveStatus([run("browser__browser_navigate", "executando", { brief: "url=https://a.com" })], true);
  assert.equal(live, "⚡ [Navegador] abrindo a página url=https://a.com…");
  assert.equal(liveStatus([], true), "💭 Planejando…");
  assert.equal(liveStatus([], false), "💭 Pensando…");
  assert.match(liveStatus([dom("concluida")], true), /Passo concluído/);
});

test("linha recolhida DEPOIS de terminar: resumo + raciocínio em uma linha", () => {
  const thinking = "x".repeat(560); // 140 tokens
  assert.equal(collapsedLine([dom()], thinking, false), "⚡ 1 página lida · 💭 Raciocínio (140 tokens)");
  assert.equal(collapsedLine([], thinking, false), "💭 Raciocínio (140 tokens)");
  assert.equal(collapsedLine([dom()], "", false), "⚡ 1 página lida");
  assert.equal(collapsedLine([], "", false), "💭 Raciocínio");
});

test("linha recolhida com FALHA: destaque de erro e chamada para inspecionar", () => {
  assert.equal(collapsedLine([dom("falhou")], "plano", false), "⚠️ Falha na ação · Inspecionar erro");
  assert.equal(collapsedLine([dom("falhou"), dom("falhou")], "plano", false), "⚠️ 2 falhas na ação · Inspecionar erro");
  assert.equal(collapsedLine([dom("falhou")], "plano", true), "⚠️ Falha na ação · Inspecionar erro", "a falha aparece mesmo durante o streaming");
});

test("linha recolhida com ação recusada pelo usuário", () => {
  assert.equal(collapsedLine([run("browser__browser_click", "recusada")], "plano", false), "⚠️ Ação recusada · 💭 Raciocínio (1 token)");
});

test("linha ao vivo junta a ferramenta e o planejamento", () => {
  const line = collapsedLine([run("browser__browser_get_dom", "executando")], "plano", true);
  assert.equal(line, "⚡ [Navegador] lendo a página… · 💭 Planejando…");
  assert.equal(collapsedLine([], "plano", true), "💭 Planejando…");
});

test("tokens do raciocínio: ~4 caracteres por token, no mínimo 1", () => {
  assert.equal(thinkingTokens("abcd"), 1);
  assert.equal(thinkingTokens("x".repeat(400)), 100);
  assert.equal(thinkingTokens(""), 1);
});
