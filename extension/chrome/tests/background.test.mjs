// Testes da logica do grupo de abas Nex: node --test extension/chrome/tests/background.test.mjs
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { fileURLToPath } from "node:url";

const SRC = fs.readFileSync(process.env.NEX_BG || path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "background.js"), "utf8");

// Chrome falso: abas, grupos, debugger e storage, para conferir exatamente o que a extensao tocou.
function boot(seed = {}) {
  const world = {
    tabs: new Map(), groups: new Map(), nextTab: 100, nextGroup: 500, attached: [], detached: [], commands: [],
    session: {}, replies: [], listener: null, failCommand: false, loadMs: 20, reloaded: 0, tick: null,
    files: { "background.js": "v1", "manifest.json": "m1" }
  };
  for (const t of seed.tabs || []) world.tabs.set(t.id, { groupId: -1, url: "about:blank", title: "t" + t.id, status: "complete", ...t });
  for (const g of seed.groups || []) world.groups.set(g.id, { ...g });
  world.fetch = async (url) => ({ text: async () => world.files[url.split("/").pop()] });
  const load = (t) => { t.status = "loading"; setTimeout(() => { t.status = "complete"; }, world.loadMs); };
  const chrome = {
    runtime: {
      getURL: (f) => "chrome-extension://nex/" + f,
      reload: () => { world.reloaded += 1; },
      connectNative: () => ({
        onMessage: { addListener: (f) => { world.listener = f; } },
        onDisconnect: { addListener() {} },
        postMessage: (m) => world.replies.push(m)
      })
    },
    storage: { session: {
      get: async (k) => ({ [k]: structuredClone(world.session[k]) }),
      set: async (o) => { Object.assign(world.session, structuredClone(o)); }
    } },
    tabs: {
      create: async ({ url }) => { const id = world.nextTab++; const t = { id, url, title: "t" + id, groupId: -1 }; world.tabs.set(id, t); load(t); return { ...t }; },
      get: async (id) => { const t = world.tabs.get(id); if (!t) throw new Error("No tab"); return { ...t }; },
      query: async ({ groupId }) => [...world.tabs.values()].filter((t) => t.groupId === groupId).map((t) => ({ ...t })),
      update: async (id, { url }) => {
        const t = world.tabs.get(id); if (!t) throw new Error("No tab");
        if (url) { const hashOnly = t.url.split("#")[0] === url.split("#")[0]; t.url = url; if (!hashOnly) load(t); }
        return { ...t };
      },
      group: async ({ tabIds, groupId }) => {
        let gid = groupId;
        if (gid === undefined) { gid = world.nextGroup++; world.groups.set(gid, { id: gid }); }
        for (const id of tabIds) world.tabs.get(id).groupId = gid;
        return gid;
      }
    },
    tabGroups: {
      get: async (gid) => { const g = world.groups.get(gid); if (!g) throw new Error("No group"); return { ...g }; },
      query: async ({ title }) => [...world.groups.values()].filter((g) => g.title === title).map((g) => ({ ...g })),
      update: async (gid, props) => { Object.assign(world.groups.get(gid), props); }
    },
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

const nexGroup = (w) => [...w.groups.values()].find((g) => g.title === "Nex");
const tabsOf = (w, gid) => [...w.tabs.values()].filter((t) => t.groupId === gid);

test("navigate cria o grupo Nex (verde) com uma aba; a segunda URL abre OUTRA aba no mesmo grupo", async () => {
  const w = boot();
  const a = await w.send({ op: "navigate", url: "https://example.com/" });
  assert.equal(a.ok, true);
  assert.equal(nexGroup(w).color, "green");
  const b = await w.send({ op: "navigate", url: "https://example.org/" });
  assert.equal(b.ok, true);
  const gid = nexGroup(w).id;
  assert.equal(w.groups.size, 1, "um grupo so");
  assert.deepEqual(tabsOf(w, gid).map((t) => t.url), ["https://example.com/", "https://example.org/"], "as duas abas ficam, nada e sobrescrito");
  assert.notEqual(a.result.tabId, b.result.tabId);
});

test("navigate com tabId troca o endereco dessa aba do grupo", async () => {
  const w = boot();
  const a = await w.send({ op: "navigate", url: "https://example.com/" });
  const r = await w.send({ op: "navigate", url: "https://example.org/x", tabId: a.result.tabId });
  assert.equal(r.ok, true);
  assert.equal(w.tabs.size, 1);
  assert.equal(w.tabs.get(a.result.tabId).url, "https://example.org/x");
});

test("o usuario monta o grupo Nex com Gmail, LinkedIn e GitHub: o Nex lista, le e abre mais abas ali dentro", async () => {
  const w = boot({
    tabs: [
      { id: 1, url: "https://mail.google.com/", title: "Gmail", groupId: 90 },
      { id: 2, url: "https://www.linkedin.com/feed/", title: "LinkedIn", groupId: 90 },
      { id: 3, url: "https://github.com/", title: "GitHub", groupId: 90 },
      { id: 4, url: "https://banco.exemplo/conta", title: "Banco", groupId: -1 }
    ],
    groups: [{ id: 90, title: "Nex" }]
  });
  const list = await w.send({ op: "tabs" });
  assert.equal(list.ok, true);
  assert.deepEqual(list.result.tabs.map((t) => t.title), ["Gmail", "LinkedIn", "GitHub"], "so o grupo; o Banco nao aparece");
  const dom = await w.send({ op: "get_dom", tabId: 2 });
  assert.equal(dom.ok, true);
  assert.equal(dom.result.tabId, 2);
  assert.deepEqual(w.attached, [2]);
  const nav = await w.send({ op: "navigate", url: "https://example.com/" });
  assert.equal(nav.ok, true);
  assert.equal(w.tabs.get(nav.result.tabId).groupId, 90, "aba nova entra no grupo do usuario");
  assert.equal(w.groups.size, 1, "nao criou um segundo grupo");
});

test("aba FORA do grupo nunca e lida, clicada, digitada nem navegada", async () => {
  const w = boot({
    tabs: [
      { id: 1, url: "https://github.com/", groupId: 90 },
      { id: 4, url: "https://banco.exemplo/conta", groupId: -1 }
    ],
    groups: [{ id: 90, title: "Nex" }]
  });
  for (const msg of [
    { op: "get_dom", tabId: 4 },
    { op: "click", elementId: 1, tabId: 4 },
    { op: "type", elementId: 1, text: "x", tabId: 4 },
    { op: "navigate", url: "https://example.com/", tabId: 4 }
  ]) {
    const r = await w.send(msg);
    assert.equal(r.ok, false, JSON.stringify(msg));
  }
  assert.deepEqual(w.attached, []);
  assert.equal(w.tabs.get(4).url, "https://banco.exemplo/conta");
});

test("sem grupo Nex, ler/clicar falha e o debugger nunca e anexado", async () => {
  const w = boot({ tabs: [{ id: 7, url: "https://x.com" }] });
  for (const msg of [{ op: "get_dom" }, { op: "click", elementId: 1 }, { op: "type", elementId: 1, text: "a" }]) {
    assert.equal((await w.send(msg)).ok, false);
  }
  assert.deepEqual(w.attached, []);
  const list = await w.send({ op: "tabs" });
  assert.equal(list.result.tabs.length, 0);
});

test("renomear o grupo tira o acesso do Nex na hora", async () => {
  const w = boot();
  await w.send({ op: "navigate", url: "https://example.com/" });
  nexGroup(w).title = "trabalho";
  assert.equal((await w.send({ op: "get_dom" })).ok, false);
  assert.deepEqual(w.attached, []);
});

test("aba tirada do grupo deixa de ser do Nex", async () => {
  const w = boot();
  const a = await w.send({ op: "navigate", url: "https://example.com/" });
  await w.send({ op: "navigate", url: "https://example.org/" });
  w.tabs.get(a.result.tabId).groupId = -1;
  assert.equal((await w.send({ op: "get_dom", tabId: a.result.tabId })).ok, false);
});

test("a aba atual e a ultima aberta ou usada; get_dom sem tabId le a atual", async () => {
  const w = boot();
  const a = await w.send({ op: "navigate", url: "https://example.com/" });
  const b = await w.send({ op: "navigate", url: "https://example.org/" });
  await w.send({ op: "get_dom" });
  assert.deepEqual(w.attached, [b.result.tabId]);
  await w.send({ op: "get_dom", tabId: a.result.tabId });
  await w.send({ op: "get_dom" });
  assert.deepEqual(w.attached, [b.result.tabId, a.result.tabId, a.result.tabId], "depois de usar a primeira, ela vira a atual");
  const list = await w.send({ op: "tabs" });
  assert.deepEqual(list.result.tabs.filter((t) => t.current).map((t) => t.id), [a.result.tabId]);
});

test("limite de abas no grupo", async () => {
  const w = boot();
  for (let i = 0; i < 10; i++) assert.equal((await w.send({ op: "navigate", url: `https://example.com/${i}` })).ok, true);
  const r = await w.send({ op: "navigate", url: "https://example.com/11" });
  assert.equal(r.ok, false);
  assert.match(r.error, /10 abas/);
  assert.equal(w.tabs.size, 10);
});

test("esquemas que nao sao http/https sao recusados sem criar aba", async () => {
  const w = boot();
  for (const url of ["javascript:alert(1)", "file:///C:/x", "chrome://settings", "data:text/html,x", "", undefined, 5]) {
    assert.equal((await w.send({ op: "navigate", url })).ok, false, String(url));
  }
  assert.equal(w.tabs.size, 0);
});

test("elementId malicioso nao vira codigo", async () => {
  const w = boot();
  await w.send({ op: "navigate", url: "https://example.com/" });
  for (const elementId of ['1"]);alert(1);//', "abc", -3, 1.5, null]) {
    assert.equal((await w.send({ op: "click", elementId })).ok, false, String(elementId));
  }
  assert.deepEqual(w.attached, []);
});

test("debugger e solto mesmo quando o comando falha", async () => {
  const w = boot();
  const a = await w.send({ op: "navigate", url: "https://example.com/" });
  w.failCommand = true;
  assert.equal((await w.send({ op: "get_dom" })).ok, false);
  assert.deepEqual(w.attached, [a.result.tabId]);
  assert.deepEqual(w.detached, [a.result.tabId]);
});

test("release solta so as abas do grupo", async () => {
  const w = boot({ tabs: [{ id: 7, url: "https://x.com" }] });
  const a = await w.send({ op: "navigate", url: "https://example.com/" });
  const r = await w.send({ op: "release" });
  assert.equal(r.ok, true);
  assert.deepEqual(w.detached, [a.result.tabId]);
});

test("operacao desconhecida e recusada", async () => {
  const w = boot();
  assert.equal((await w.send({ op: "tabs.remove" })).ok, false);
});

test("navigate so responde depois da pagina carregar", async () => {
  const w = boot();
  w.loadMs = 700;
  const r = await w.send({ op: "navigate", url: "https://example.com/" });
  assert.equal(r.result.loaded, true);
  assert.equal(w.tabs.get(r.result.tabId).status, "complete");
});

test("mudanca so de #hash na mesma aba nao espera carregamento", async () => {
  const w = boot();
  const a = await w.send({ op: "navigate", url: "https://example.com/" });
  w.loadMs = 5000;
  const t0 = Date.now();
  const r = await w.send({ op: "navigate", url: "https://example.com/#a", tabId: a.result.tabId });
  assert.equal(r.ok, true);
  assert.ok(Date.now() - t0 < 1500);
});

test("type usa entrada real do Chrome (insertText + Enter) e devolve o valor que ficou no campo", async () => {
  const w = boot();
  await w.send({ op: "navigate", url: "https://example.com/" });
  w.commands.length = 0;
  const r = await w.send({ op: "type", elementId: 22, text: "bom dia, tudo bem?", pressEnter: true });
  assert.equal(r.result.value, "eco");
  const methods = w.commands.map((c) => c[0]);
  assert.equal(JSON.stringify(w.commands.find((c) => c[0] === "Input.insertText")[1]), JSON.stringify({ text: "bom dia, tudo bem?" }));
  assert.equal(methods.filter((m) => m === "Input.dispatchKeyEvent").length, 2);
  assert.deepEqual(w.attached, w.detached);
});

test("type sem Enter nao dispara tecla", async () => {
  const w = boot();
  await w.send({ op: "navigate", url: "https://example.com/" });
  w.commands.length = 0;
  await w.send({ op: "type", elementId: 3, text: "abc", pressEnter: false });
  assert.ok(!w.commands.some((c) => c[0] === "Input.dispatchKeyEvent"));
});

test("a extensao se recarrega sozinha so quando os proprios arquivos mudam", async () => {
  const w = boot();
  await new Promise((r) => setTimeout(r, 20));
  await w.tick();
  assert.equal(w.reloaded, 0);
  w.files["background.js"] = "v2";
  await w.tick();
  assert.equal(w.reloaded, 1);
});

test("falha ao ler o proprio arquivo nao recarrega nem derruba a extensao", async () => {
  const w = boot();
  await new Promise((r) => setTimeout(r, 20));
  w.fetch = async () => { throw new Error("arquivo em escrita"); };
  await w.tick();
  assert.equal(w.reloaded, 0);
});
