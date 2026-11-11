// Extensão do Nex. Só enxerga e mexe no que ELA criou: um grupo de abas "Nex" e as abas dentro dele.
// Abas suas, e grupos que você mesmo nomear "Nex", nunca são adotados nem navegados.
const GROUP = "Nex";
const STATE_KEY = "nexState";
let port = null;

function connect() {
  if (port) return;
  port = chrome.runtime.connectNative("com.nex.chrome");
  port.onMessage.addListener((msg) => {
    handle(msg).then(
      (result) => reply(msg.id, true, result, null),
      (error) => reply(msg.id, false, null, String(error && error.message ? error.message : error))
    );
  });
  port.onDisconnect.addListener(() => {
    port = null;
    setTimeout(connect, 1500);
  });
}

function reply(id, ok, result, error) {
  if (!port) return;
  port.postMessage({ id, ok, result, error });
}

// Estado guardado em storage.session: sobrevive ao service worker dormir e some quando o Chrome fecha.
async function loadState() {
  const data = await chrome.storage.session.get(STATE_KEY);
  return data[STATE_KEY] || { groupId: null, tabIds: [] };
}

async function saveState(state) {
  await chrome.storage.session.set({ [STATE_KEY]: state });
}

// Aba do Nex = foi criada por esta extensão, ainda existe e continua no grupo que a extensão criou.
async function ownedTabs() {
  const state = await loadState();
  if (state.groupId == null) return [];
  const alive = [];
  for (const id of state.tabIds) {
    try {
      const tab = await chrome.tabs.get(id);
      if (tab.groupId === state.groupId) alive.push(tab);
    } catch { /* aba fechada */ }
  }
  if (alive.length !== state.tabIds.length) {
    state.tabIds = alive.map((t) => t.id);
    if (!alive.length) state.groupId = null;
    await saveState(state);
  }
  return alive;
}

async function ensureTab(url) {
  const tabs = await ownedTabs();
  if (tabs.length) {
    const tab = tabs[tabs.length - 1];
    if (url) await chrome.tabs.update(tab.id, { url, active: false });
    return tab.id;
  }
  const created = await chrome.tabs.create({ url: url || "about:blank", active: false });
  const groupId = await chrome.tabs.group({ tabIds: [created.id] });
  await chrome.tabGroups.update(groupId, { title: GROUP, color: "green" });
  await saveState({ groupId, tabIds: [created.id] });
  return created.id;
}

async function withDebugger(tabId, fn) {
  const tabs = await ownedTabs();
  if (!tabs.some((t) => t.id === tabId)) throw new Error("A aba não é do grupo Nex.");
  await chrome.debugger.attach({ tabId }, "1.3");
  try {
    return await fn(tabId);
  } finally {
    try { await chrome.debugger.detach({ tabId }); } catch { /* já solto */ }
  }
}

const DOM_JS = `(() => {
  const nodes = [];
  let n = 0;
  for (const el of document.querySelectorAll("a, button, input, textarea, select, summary, [role='button'], [role='link'], [role='tab'], [role='menuitem'], [role='option'], [role='checkbox'], [role='switch'], [role='radio'], [contenteditable='true'], [onclick]")) {
    const r = el.getBoundingClientRect();
    if (r.width < 2 || r.height < 2) continue;
    if (el.getAttribute("aria-hidden") === "true") continue;
    n += 1;
    el.setAttribute("data-nex-id", String(n));
    const label = (el.innerText || el.getAttribute("aria-label") || el.getAttribute("title") || el.getAttribute("placeholder") || el.value || "").replace(/\\s+/g, " ").trim().slice(0, 80);
    nodes.push({ id: n, tag: el.tagName.toLowerCase(), label, x: r.x + r.width / 2, y: r.y + r.height / 2 });
    if (n >= 80) break;
  }
  const text = (document.body && document.body.innerText || "").replace(/\\s+/g, " ").trim().slice(0, 6000);
  return { text, items: nodes };
})()`;

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// tabs.update/create devolvem antes da página carregar: sem esperar, o get_dom lê uma página em branco.
async function waitLoaded(tabId, maxMs) {
  const end = Date.now() + maxMs;
  while (Date.now() < end) {
    try {
      const tab = await chrome.tabs.get(tabId);
      if (tab.status === "complete") return true;
    } catch { return false; }
    await sleep(250);
  }
  return false;
}

function sameDocument(a, b) {
  try {
    const x = new URL(a), y = new URL(b);
    x.hash = ""; y.hash = "";
    return x.href === y.href;
  } catch { return false; }
}

async function lastOwnedTabId(noTabMessage) {
  const tabs = await ownedTabs();
  if (!tabs.length) throw new Error(noTabMessage);
  return tabs[tabs.length - 1].id;
}

async function handle(msg) {
  if (msg.op === "get_dom") {
    const tabId = await lastOwnedTabId("O grupo Nex ainda não tem aba. Peça para abrir uma URL.");
    await waitLoaded(tabId, 10000);
    const read = () => withDebugger(tabId, (id) => chrome.debugger.sendCommand({ tabId: id }, "Runtime.evaluate", {
      expression: DOM_JS,
      returnByValue: true
    }));
    let value = await read();
    if (!value.result.value.text && !value.result.value.items.length) {
      await sleep(1500); // página ainda montando: uma segunda leitura antes de dizer que está vazia
      value = await read();
    }
    return value.result.value;
  }
  if (msg.op === "navigate") {
    if (typeof msg.url !== "string" || !/^https?:\/\//i.test(msg.url)) throw new Error("Só são abertos endereços http e https.");
    const before = (await ownedTabs()).slice(-1)[0];
    const tabId = await ensureTab(msg.url);
    let loaded = true;
    if (!before || !sameDocument(before.url, msg.url)) {
      await sleep(300); // deixa a aba entrar em "loading" antes de olhar o status
      loaded = await waitLoaded(tabId, 15000);
      if (loaded) await sleep(500); // folga para o que a página monta por JavaScript
    }
    return { url: msg.url, tabId, loaded };
  }
  if (msg.op === "click" || msg.op === "type") {
    const elementId = Number(msg.elementId);
    if (!Number.isInteger(elementId) || elementId < 1) throw new Error("Elemento inválido.");
    const tabId = await lastOwnedTabId("O grupo Nex ainda não tem aba.");
    const pick = `document.querySelector('[data-nex-id="${elementId}"]')`;
    return withDebugger(tabId, async (id) => {
      const send = (method, params) => chrome.debugger.sendCommand({ tabId: id }, method, params);
      const evalJs = async (expression) => (await send("Runtime.evaluate", { expression, returnByValue: true })).result.value;
      try { await send("Emulation.setFocusEmulationEnabled", { enabled: true }); } catch { /* opcional: aba em segundo plano */ }
      if (msg.op === "click") {
        const r = await evalJs(`(() => { const el = ${pick}; if (!el) return { ok: false }; el.scrollIntoView({ block: "center" }); el.click(); return { ok: true }; })()`);
        if (!r || !r.ok) throw new Error("Elemento não está mais na aba do grupo Nex.");
        await sleep(800);
        await waitLoaded(id, 8000);
        return { ok: true };
      }
      // Digitação de verdade (eventos confiáveis do Chrome): funciona em campos React/Angular, que ignoram el.value = ...
      const r = await evalJs(`(() => { const el = ${pick}; if (!el) return { ok: false }; el.scrollIntoView({ block: "center" }); el.focus(); if (el.select) el.select(); return { ok: true }; })()`);
      if (!r || !r.ok) throw new Error("Elemento não está mais na aba do grupo Nex.");
      await send("Input.insertText", { text: String(msg.text || "") });
      if (msg.pressEnter) {
        for (const type of ["keyDown", "keyUp"]) {
          await send("Input.dispatchKeyEvent", { type, key: "Enter", code: "Enter", windowsVirtualKeyCode: 13, nativeVirtualKeyCode: 13, text: type === "keyDown" ? "\r" : undefined });
        }
        await sleep(1200); // a página reage (tradução, busca, navegação)
        await waitLoaded(id, 8000);
      }
      const now = await evalJs(`(() => { const el = ${pick}; return el ? String(el.value !== undefined ? el.value : el.innerText).slice(0, 200) : null; })()`);
      return { ok: true, value: now };
    });
  }
  if (msg.op === "release") {
    const tabs = await ownedTabs();
    for (const tab of tabs) {
      try { await chrome.debugger.detach({ tabId: tab.id }); } catch { /* solto */ }
    }
    return { released: tabs.length };
  }
  throw new Error("Operação desconhecida.");
}


// Recarrega a extensão sozinha quando os arquivos dela mudam (extensão sem pacote): você não precisa mais clicar em
// "recarregar" em chrome://extensions depois de cada atualização do Nex.
const WATCHED = ["background.js", "manifest.json"];
let fingerprint = null;

function hashText(text) {
  let h = 5381;
  for (let i = 0; i < text.length; i++) h = ((h << 5) + h + text.charCodeAt(i)) | 0;
  return String(h);
}

async function readFingerprint() {
  let out = "";
  for (const file of WATCHED) {
    const res = await fetch(chrome.runtime.getURL(file), { cache: "no-store" });
    out += hashText(await res.text()) + ";";
  }
  return out;
}

async function watchSelf() {
  try {
    const now = await readFingerprint();
    if (fingerprint === null) fingerprint = now;
    else if (now !== fingerprint) chrome.runtime.reload();
  } catch { /* arquivo em escrita: tenta no próximo ciclo */ }
}

setInterval(watchSelf, 4000);
watchSelf();

connect();
