import { useState, type PointerEvent as ReactPointerEvent } from "react";
import { api, type DevNode } from "../../api";
import type { NexCore } from "../../hooks/useNexCore";
import type { Settings } from "../../types";
import { loadDrawers } from "../../lib/devPrompt";
import DevCodeViewer, { type DevTab } from "./DevCodeViewer";
import DevCopilotPanel from "./DevCopilotPanel";
import DevFileExplorer from "./DevFileExplorer";

function clamp(n: number, min: number, max: number) {
  return Math.min(max, Math.max(min, n));
}

export default function DevWorkspace({ settings, core }: { settings: Settings; core: NexCore }) {
  const [root, setRoot] = useState<string | null>(null);
  const [nodes, setNodes] = useState<DevNode[]>([]);
  const [tabs, setTabs] = useState<DevTab[]>([]);
  const [active, setActive] = useState<string | null>(null);
  const [drawers] = useState(loadDrawers);
  const [explorerW, setExplorerW] = useState(260);
  const [copilotW, setCopilotW] = useState(400);

  function startDrag(which: "explorer" | "copilot", e: ReactPointerEvent<HTMLDivElement>) {
    e.preventDefault();
    const startX = e.clientX;
    const start = which === "explorer" ? explorerW : copilotW;
    const move = (ev: PointerEvent) => {
      const dx = ev.clientX - startX;
      if (which === "explorer") setExplorerW(clamp(start + dx, 180, 400));
      else setCopilotW(clamp(start - dx, 320, 600));
    };
    const up = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  }

  /** Pasta nova: as abas da pasta anterior não valem mais. */
  function resetTabs() {
    setTabs([]);
    setActive(null);
  }

  /** "Abrir Pasta": janela nativa do Windows; cancelar não muda nada. */
  async function pickFolder() {
    const picked = await api.devPick();
    if (picked.cancelled || !picked.path) return;
    setRoot(picked.path);
    setNodes(picked.nodes ?? []);
    resetTabs();
  }

  async function dropFolder(path: string) {
    const opened = await api.devOpen(path);
    setRoot(opened.path);
    setNodes((await api.devTree()).nodes);
    resetTabs();
  }

  async function refresh() {
    setNodes((await api.devTree()).nodes);
  }

  async function openFile(path: string) {
    if (tabs.some((t) => t.path === path)) {
      setActive(path);
      return;
    }
    const file = await api.devRead(path);
    setTabs((t) => [...t, { path, content: file.content, dirty: false }]);
    setActive(path);
  }

  function change(path: string, content: string) {
    setTabs((t) => t.map((tab) => (tab.path === path ? { ...tab, content, dirty: true } : tab)));
  }

  async function save(path: string) {
    const tab = tabs.find((t) => t.path === path);
    if (!tab) return;
    await api.devWrite(path, tab.content);
    setTabs((t) => t.map((item) => (item.path === path ? { ...item, dirty: false } : item)));
  }

  return (
    <div className="flex min-h-0 flex-1 bg-[#0b0f19]">
      <div style={{ width: explorerW }} className="shrink-0">
        <DevFileExplorer root={root} nodes={nodes} activePath={active} onPickFolder={pickFolder} onDropFolder={dropFolder} onRefresh={refresh} onOpenFile={(p) => void openFile(p)} />
      </div>
      <div
        role="separator"
        aria-orientation="vertical"
        aria-label="Redimensionar explorador"
        onPointerDown={(e) => startDrag("explorer", e)}
        className="w-1.5 shrink-0 cursor-col-resize bg-white/5 transition-colors hover:bg-accent/40"
      />
      <DevCodeViewer
        core={core}
        tabs={tabs}
        active={active}
        onSelect={setActive}
        onClose={(p) => {
          setTabs((t) => t.filter((tab) => tab.path !== p));
          setActive((cur) => (cur === p ? null : cur));
        }}
        onChange={change}
        onSave={(p) => void save(p)}
      />
      <div
        role="separator"
        aria-orientation="vertical"
        aria-label="Redimensionar o Nex"
        onPointerDown={(e) => startDrag("copilot", e)}
        className="w-1.5 shrink-0 cursor-col-resize bg-white/5 transition-colors hover:bg-accent/40"
      />
      <div style={{ width: copilotW }} className="shrink-0">
        <DevCopilotPanel settings={settings} workspace={root} drawers={drawers} />
      </div>
    </div>
  );
}
