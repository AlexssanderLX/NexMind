import { useState } from "react";
import { api, type DevNode } from "../../api";
import type { Settings } from "../../types";
import { loadDrawers, saveDrawers, type DevDrawerKey } from "../../lib/devPrompt";
import DevCodeViewer, { type DevTab } from "./DevCodeViewer";
import DevCopilotPanel from "./DevCopilotPanel";
import DevFileExplorer from "./DevFileExplorer";
import DevTaskPanel from "./DevTaskPanel";

export default function DevWorkspace({ settings }: { settings: Settings }) {
  const [root, setRoot] = useState<string | null>(null);
  const [nodes, setNodes] = useState<DevNode[]>([]);
  const [collapsed, setCollapsed] = useState(false);
  const [tabs, setTabs] = useState<DevTab[]>([]);
  const [active, setActive] = useState<string | null>(null);
  const [drawers, setDrawers] = useState(loadDrawers);

  async function openFolder(path: string) {
    const opened = await api.devOpen(path);
    setRoot(opened.path);
    const tree = await api.devTree();
    setNodes(tree.nodes);
  }

  async function openFile(path: string) {
    const existing = tabs.find((t) => t.path === path);
    if (existing) {
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

  function setDrawer(key: DevDrawerKey, text: string) {
    setDrawers((d) => {
      const next = { ...d, [key]: text };
      saveDrawers(next);
      return next;
    });
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <DevTaskPanel drawers={drawers} onChange={setDrawer} />
      <div className="flex min-h-0 flex-1">
        <DevFileExplorer root={root} nodes={nodes} collapsed={collapsed} onToggle={() => setCollapsed((c) => !c)} onOpenFolder={openFolder} onOpenFile={(p) => void openFile(p)} />
        <DevCodeViewer tabs={tabs} active={active} onSelect={setActive} onClose={(p) => {
          setTabs((t) => t.filter((tab) => tab.path !== p));
          setActive((cur) => (cur === p ? null : cur));
        }} onChange={change} onSave={(p) => void save(p)} />
        <DevCopilotPanel settings={settings} workspace={root} drawers={drawers} />
      </div>
    </div>
  );
}
