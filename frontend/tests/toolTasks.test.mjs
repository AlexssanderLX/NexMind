// Testa o monitor de tasks do painel Ferramentas (lib/toolTasks.ts).
// Rodar: node --experimental-strip-types --test frontend/tests/toolTasks.test.mjs
import test from "node:test";
import assert from "node:assert/strict";
import { IDLE_TASKS, TOOL_CARDS, briefArg, describeTask, isBusyState, pathOf, taskStatusText, toolKeyOf } from "../src/lib/toolTasks.ts";

test("cards: 4 ferramentas, todas sem interruptor (o texto diz que ligam pela frase)", () => {
  assert.deepEqual(TOOL_CARDS.map((c) => c.key), ["browser", "pesquisa", "mcp", "desktop"]);
  assert.deepEqual(Object.keys(IDLE_TASKS).sort(), ["browser", "desktop", "mcp", "pesquisa"]);
  for (const c of TOOL_CARDS) assert.ok(c.description.length > 20, c.key);
});

test("status: ocioso = [Pronta / Ociosa]; ocupado = [Executando - ...]", () => {
  assert.equal(taskStatusText({ busy: false, note: "" }), "[Pronta / Ociosa]");
  assert.equal(taskStatusText({ busy: false, note: "lendo x" }), "[Pronta / Ociosa]", "terminou: volta a ociosa");
  assert.equal(taskStatusText({ busy: true, note: "lendo DOM de /dashboard" }), "[Executando - lendo DOM de /dashboard]");
  assert.equal(taskStatusText({ busy: true, note: "" }), "[Executando - trabalhando]");
});

test("eventos: carregando, executando e filtrando ocupam; concluida, falhou e recusada liberam", () => {
  for (const s of ["carregando", "executando", "filtrando"]) assert.equal(isBusyState(s), true, s);
  for (const s of ["concluida", "falhou", "recusada", "pronta"]) assert.equal(isBusyState(s), false, s);
});

test("a qual card cada ferramenta pertence", () => {
  assert.equal(toolKeyOf("browser__browser_get_dom"), "browser");
  assert.equal(toolKeyOf("desktop__desktop_type"), "desktop");
  assert.equal(toolKeyOf("arquivos__read_file"), "mcp");
  assert.equal(toolKeyOf("pesquisa"), "pesquisa");
  assert.equal(toolKeyOf("topic_write"), null, "o caderno não é um card");
});

test("argumentos do resumo do backend e rota da página", () => {
  assert.equal(briefArg("url=https://alvo.local/dashboard tab_id=5", "url"), "https://alvo.local/dashboard");
  assert.equal(briefArg("url=https://alvo.local/dashboard tab_id=5", "tab_id"), "5");
  assert.equal(briefArg("", "url"), "");
  assert.equal(pathOf("https://alvo.local/dashboard?x=1"), "/dashboard");
  assert.equal(pathOf("https://alvo.local/"), "alvo.local");
  assert.equal(pathOf("lixo"), "");
});

test("descrição da task: navegador usa a rota da última página aberta", () => {
  assert.equal(describeTask("browser__browser_navigate", "url=https://alvo.local/dashboard"), "abrindo /dashboard");
  assert.equal(describeTask("browser__browser_get_dom", "tab_id=0", "/dashboard"), "lendo DOM de /dashboard");
  assert.equal(describeTask("browser__browser_get_dom", "tab_id=0"), "lendo DOM de aba atual");
  assert.equal(describeTask("browser__browser_recon", "", "/admin"), "mapeando superfície de /admin");
  assert.equal(describeTask("browser__browser_click", "element_id=7"), "clicando no item 7");
});

test("descrição da task: arquivos, computador e ferramenta desconhecida", () => {
  assert.equal(describeTask("arquivos__read_file", "path=C:\\dados\\notas.md"), "lendo notas.md");
  assert.equal(describeTask("arquivos__read_text_file", "path=/tmp/a.txt"), "lendo a.txt");
  assert.equal(describeTask("arquivos__write_file", "path=C:\\x\\saida.txt content=…"), "gravando saida.txt");
  assert.equal(describeTask("arquivos__list_directory", "path=C:\\dados"), "listando dados");
  assert.equal(describeTask("desktop__desktop_list_windows", ""), "no Windows: list windows");
  assert.equal(describeTask("x__ferramenta_nova", ""), "ferramenta nova");
});
