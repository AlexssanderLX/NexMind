// Testes da logica do grupo de abas: node --test extension/chrome/tests
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { fileURLToPath } from "node:url";

const SRC = fs.readFileSync(process.env.NEX_BG || path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "background.js"), "utf8");

// Chrome falso: guarda abas, grupos e debugger para conferir exatamente o que a extensao tocou.
function boot(seed = {}) {
  const world = { tabs: new Map(), groups: new Map(), nextTab: 100, nextGroup: 500, attached: [], detached: [], navigations: [], session: {}, replies: [], listener: null, failCommand: false, loadMs: 20, reloaded: 0, commands: [], files: { "background.js": "v1", "manifest.json": "m1" }, tick: null };
  world.fetch = async (url) => ({ text: async () => world.files[url.split("/").pop()] });
  for (const t of seed.tabs || []) world.tabs.set(t.id, { groupId: -1, url: "about:blank", ...t });
  for (const g of seed.groups || []) world.groups.set(g.id, g);
  const chrome = {
    runtime: { getURL: (f) => "chrome-extension://nex/" + f, reload: () => { world.reloaded += 1; }, connectNative: () => ({
      onMessage: { addListener: (f) => { world.listener = f; } },
      onDisconnect: { addListener() {} },
      postMessage: (m) => world.replies.push(m)
    }) },
    storage: { session: {
      get: async (k) => ({ [k]: structuredClone(world.session[k]) }),
      set: async (o) => { Object.assign(world.session, structuredClone(o)); }
    } },
    tabs: {
      create: async ({ url }) => { const id = world.nextTab++; const t = { id, url, groupId: -1, status: "loading" }; world.tabs.set(id, t); world.navigations.push({ id, url }); setTimeout(() => { t.status = "complete"; }, world.loadMs); return { ...t }; },
      get: async (id) => { const t = world.tabs.get(id); if (!t) throw new Error("No tab"); return { ...t }; },
      update: async (id, { url }) => { const t = world.tabs.get(id); if (!t) throw new Error("No tab"); if (url) { const hash = new URL(url).hash && new URL(url).href.split("#")[0] === t.url.split("#")[0]; t.url = url; world.navigations.push({ id, url }); if (!hash) { t.status = "loading"; setTimeout(() => { t.status = "complete"; }, world.loadMs); } } return { ...t }; },
      group: async ({ tabIds }) => { const gid = world.nextGroup++; world.groups.set(gid, { id: gid }); for (const id of tabIds) world.tabs.get(id).groupId = gid; return gid; }
    },
    tabGroups: { update: async (gid, props) => { Object.assign(world.groups.get(gid), props); } },
    debugger: {
      attach: async ({ tabId }) => { world.attached.push(tabId); },
      detach: async ({ tabId }) => { world.detached.push(tabId); },
      sendCommand: async (_target, method, params) => {
        world.commands.push([method, params]);
        if (world.failCommand) throw new Error("falha do CDP");
        if (params && params.expression && params.expression.includes("String(el.value")) return { result: { value: "eco" } };
        return { result: { value: { ok: true, text: "pagina", items: [] } } };
      }
    }
  };
  vm.runInNewContext(SRC, { chrome, fetch: (...a) => world.fetch(...a), setInterval: (f) => { world.tick = f; return 0; }, setTimeout, console, structuredClone, JSON, Number, String, Error, Promise, RegExp, Date, URL });
  let id = 0;
  world.send = (msg) => new Promise((resolve) => {
    const mid = ++id;
    const before = world.replies.length;
    world.listener({ id: mid, ...msg });
    const wait = () => {
      const r = world.replies.slice(before).find((x) => x.id === mid);
      if (r) resolve(r); else setTimeout(wait, 5);
    };
    wait();
  });
  return world;
}

test("navigate cria uma aba e o grupo Nex, e a segunda URL reutiliza a mesma aba", async () => {
  const w = boot();
  const a = await w.send({ op: "navigate", url: "https://example.com/" });
  assert.equal(a.ok, true);
  assert.equal(w.tabs.size, 1);
  const group = [...w.groups.values()][0];
  assert.equal(group.title, "Nex");
  assert.equal(group.color, "green");
  const b = await w.send({ op: "navigate", url: "https://example.org/" });
  assert.equal(b.ok, true);
  assert.equal(w.tabs.size, 1, "nao abre aba nova");
  assert.equal([...w.tabs.values()][0].url, "https://example.org/");
});

test("grupo chamado Nex criado pelo usuario NAO e adotado", async () => {
  const w = boot({
    tabs: [{ id: 7, url: "https://banco.exemplo/conta", groupId: 90 }],
    groups: [{ id: 90, title: "Nex" }]
  });
  const r = await w.send({ op: "navigate", url: "https://example.com/" });
  assert.equal(r.ok, true);
  assert.equal(w.tabs.get(7).url, "https://banco.exemplo/conta", "aba do usuario intacta");
  assert.equal(w.tabs.size, 2, "criou uma aba nova propria");
  const dom = await w.send({ op: "get_dom" });
  assert.equal(dom.ok, true);
  assert.deepEqual(w.attached, [100], "debugger so na aba criada pela extensao");
});

test("aba do usuario arrastada para dentro do grupo Nex e ignorada, mesmo sendo a ultima", async () => {
  const w = boot();
  await w.send({ op: "navigate", url: "https://example.com/" });
  const gid = [...w.groups.keys()][0];
  // pior caso: o usuario arrasta uma aba dele para o fim do grupo
  w.tabs.set(999, { id: 999, url: "https://banco.exemplo/conta", groupId: gid });
  const nav = await w.send({ op: "navigate", url: "https://example.org/" });
  assert.equal(nav.ok, true);
  assert.equal(w.tabs.get(999).url, "https://banco.exemplo/conta", "navigate nao sobrescreve aba alheia");
  assert.equal(w.tabs.get(100).url, "https://example.org/");
  const dom = await w.send({ op: "get_dom" });
  assert.equal(dom.ok, true);
  assert.deepEqual(w.attached, [100], "so a aba criada pelo Nex recebe debugger");
});

test("sem aba do Nex, ler/clicar falha e o debugger nunca e anexado", async () => {
  const w = boot({ tabs: [{ id: 7, url: "https://x.com" }] });
  for (const msg of [{ op: "get_dom" }, { op: "click", elementId: 1 }, { op: "type", elementId: 1, text: "a" }]) {
    const r = await w.send(msg);
    assert.equal(r.ok, false);
  }
  assert.deepEqual(w.attached, []);
});

test("aba do Nex tirada do grupo deixa de ser do Nex", async () => {
  const w = boot();
  await w.send({ op: "navigate", url: "https://example.com/" });
  w.tabs.get(100).groupId = -1;
  const r = await w.send({ op: "get_dom" });
  assert.equal(r.ok, false);
  assert.deepEqual(w.attached, []);
});

test("aba do Nex fechada: a proxima navigate cria outra do zero", async () => {
  const w = boot();
  await w.send({ op: "navigate", url: "https://example.com/" });
  w.tabs.delete(100);
  const r = await w.send({ op: "navigate", url: "https://example.org/" });
  assert.equal(r.ok, true);
  assert.equal(w.tabs.size, 1);
  assert.ok(w.tabs.has(101));
});

test("esquemas que nao sao http/https sao recusados sem criar aba", async () => {
  const w = boot();
  for (const url of ["javascript:alert(1)", "file:///C:/x", "chrome://settings", "data:text/html,x", "", undefined, 5]) {
    const r = await w.send({ op: "navigate", url });
    assert.equal(r.ok, false, String(url));
  }
  assert.equal(w.tabs.size, 0);
});

test("elementId malicioso nao vira codigo", async () => {
  const w = boot();
  await w.send({ op: "navigate", url: "https://example.com/" });
  for (const elementId of ['1"]);alert(1);//', "abc", -3, 1.5, null]) {
    const r = await w.send({ op: "click", elementId });
    assert.equal(r.ok, false, String(elementId));
  }
  assert.deepEqual(w.attached, []);
});

test("debugger e solto mesmo quando o comando falha", async () => {
  const w = boot();
  await w.send({ op: "navigate", url: "https://example.com/" });
  w.failCommand = true;
  const r = await w.send({ op: "get_dom" });
  assert.equal(r.ok, false);
  assert.deepEqual(w.attached, [100]);
  assert.deepEqual(w.detached, [100]);
});

test("release solta so as abas do Nex", async () => {
  const w = boot({ tabs: [{ id: 7, url: "https://x.com" }] });
  await w.send({ op: "navigate", url: "https://example.com/" });
  const r = await w.send({ op: "release" });
  assert.equal(r.ok, true);
  assert.deepEqual(w.detached, [100]);
});

test("operacao desconhecida e recusada", async () => {
  const w = boot();
  const r = await w.send({ op: "tabs.remove" });
  assert.equal(r.ok, false);
});

test("navigate so responde depois da pagina carregar (get_dom nao le pagina em branco)", async () => {
  const w = boot();
  w.loadMs = 700;
  const r = await w.send({ op: "navigate", url: "https://example.com/" });
  assert.equal(r.ok, true);
  assert.equal(r.result.loaded, true);
  assert.equal(w.tabs.get(100).status, "complete", "ja carregou quando a resposta chegou");
});

test("mudanca so de #hash nao espera carregamento", async () => {
  const w = boot();
  await w.send({ op: "navigate", url: "https://example.com/" });
  w.loadMs = 5000;
  const t0 = Date.now();
  const r = await w.send({ op: "navigate", url: "https://example.com/#a" });
  assert.equal(r.ok, true);
  assert.ok(Date.now() - t0 < 1500, "nao ficou esperando");
});

test("a extensao se recarrega sozinha so quando os proprios arquivos mudam", async () => {
  const w = boot();
  await new Promise((r) => setTimeout(r, 20));
  await w.tick();
  assert.equal(w.reloaded, 0, "sem mudanca nao recarrega");
  w.files["background.js"] = "v2";
  await w.tick();
  assert.equal(w.reloaded, 1, "arquivo mudou: recarrega");
});

test("falha ao ler o proprio arquivo nao recarrega nem derruba a extensao", async () => {
  const w = boot();
  await new Promise((r) => setTimeout(r, 20));
  w.fetch = async () => { throw new Error("arquivo em escrita"); };
  await w.tick();
  assert.equal(w.reloaded, 0);
});

test("type usa entrada real do Chrome (insertText + Enter) e devolve o valor que ficou no campo", async () => {
  const w = boot();
  await w.send({ op: "navigate", url: "https://example.com/" });
  await w.send({ op: "get_dom" });
  w.commands.length = 0;
  const r = await w.send({ op: "type", elementId: 22, text: "bom dia, tudo bem?", pressEnter: true });
  assert.equal(r.ok, true);
  assert.equal(r.result.value, "eco", "devolve o que leu de volta do campo");
  const methods = w.commands.map((c) => c[0]);
  assert.ok(methods.includes("Input.insertText"));
  assert.equal(JSON.stringify(w.commands.find((c) => c[0] === "Input.insertText")[1]), JSON.stringify({ text: "bom dia, tudo bem?" }));
  assert.equal(methods.filter((m) => m === "Input.dispatchKeyEvent").length, 2, "Enter = keyDown + keyUp");
  assert.deepEqual(w.attached, w.detached, "debugger solto");
});

test("type sem Enter nao dispara tecla", async () => {
  const w = boot();
  await w.send({ op: "navigate", url: "https://example.com/" });
  w.commands.length = 0;
  await w.send({ op: "type", elementId: 3, text: "abc", pressEnter: false });
  assert.ok(!w.commands.some((c) => c[0] === "Input.dispatchKeyEvent"));
});
