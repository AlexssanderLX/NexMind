const GROUP = "Nex";
let port = null;
let groupId = null;

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

async function nexTabs() {
  const groups = await chrome.tabGroups.query({ title: GROUP });
  if (!groups.length) return [];
  groupId = groups[0].id;
  return chrome.tabs.query({ groupId });
}

async function ensureTab(url) {
  const tabs = await nexTabs();
  if (tabs.length) {
    const tab = tabs[tabs.length - 1];
    if (url) await chrome.tabs.update(tab.id, { url, active: false });
    return tab.id;
  }
  const created = await chrome.tabs.create({ url: url || "about:blank", active: false });
  groupId = await chrome.tabs.group({ tabIds: [created.id] });
  await chrome.tabGroups.update(groupId, { title: GROUP, color: "green" });
  return created.id;
}

async function withDebugger(tabId, fn) {
  const tab = await chrome.tabs.get(tabId);
  if (tab.groupId === -1) throw new Error("A aba não está no grupo Nex.");
  const group = await chrome.tabGroups.get(tab.groupId);
  if (group.title !== GROUP) throw new Error("A aba não está no grupo Nex.");
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
  for (const el of document.querySelectorAll("a, button, input, textarea, select, [role='button'], [role='link']")) {
    const r = el.getBoundingClientRect();
    if (r.width < 2 || r.height < 2) continue;
    if (el.getAttribute("aria-hidden") === "true") continue;
    n += 1;
    el.setAttribute("data-nex-id", String(n));
    const label = (el.innerText || el.getAttribute("aria-label") || el.getAttribute("placeholder") || el.value || "").replace(/\\s+/g, " ").trim().slice(0, 80);
    nodes.push({ id: n, tag: el.tagName.toLowerCase(), label, x: r.x + r.width / 2, y: r.y + r.height / 2 });
    if (n >= 40) break;
  }
  const text = (document.body && document.body.innerText || "").replace(/\\s+/g, " ").trim().slice(0, 2500);
  return { text, items: nodes };
})()`;

async function handle(msg) {
  if (msg.op === "get_dom") {
    const tabs = await nexTabs();
    if (!tabs.length) throw new Error("O grupo Nex ainda não tem aba. Peça para abrir uma URL.");
    const tabId = tabs[tabs.length - 1].id;
    const value = await withDebugger(tabId, (id) => chrome.debugger.sendCommand({ tabId: id }, "Runtime.evaluate", {
      expression: DOM_JS,
      returnByValue: true
    }));
    return value.result.value;
  }
  if (msg.op === "navigate") {
    const tabId = await ensureTab(msg.url);
    return { url: msg.url, tabId };
  }
  if (msg.op === "click" || msg.op === "type") {
    const tabs = await nexTabs();
    if (!tabs.length) throw new Error("O grupo Nex ainda não tem aba.");
    const tabId = tabs[tabs.length - 1].id;
    const expr = msg.op === "click"
      ? `(() => { const el = document.querySelector('[data-nex-id="${msg.elementId}"]'); if (!el) return { ok: false }; el.click(); return { ok: true }; })()`
      : `(() => { const el = document.querySelector('[data-nex-id="${msg.elementId}"]'); if (!el) return { ok: false }; el.focus(); el.value = ${JSON.stringify(msg.text || "")}; el.dispatchEvent(new Event("input", { bubbles: true })); if (${msg.pressEnter ? "true" : "false"}) el.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true })); return { ok: true }; })()`;
    const value = await withDebugger(tabId, (id) => chrome.debugger.sendCommand({ tabId: id }, "Runtime.evaluate", {
      expression: expr,
      returnByValue: true
    }));
    if (!value.result.value || !value.result.value.ok) throw new Error("Elemento não está mais na aba do grupo Nex.");
    return value.result.value;
  }
  if (msg.op === "release") {
    const tabs = await nexTabs();
    for (const tab of tabs) {
      try { await chrome.debugger.detach({ tabId: tab.id }); } catch { /* solto */ }
    }
    return { released: tabs.length };
  }
  throw new Error("Operação desconhecida.");
}

connect();
