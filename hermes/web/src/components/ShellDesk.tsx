import { FitAddon } from "@xterm/addon-fit";
import { Terminal } from "@xterm/xterm";
import { forwardRef, useEffect, useImperativeHandle, useRef, useState, type ReactNode } from "react";

import { api } from "@/lib/api";
import { TERMINAL_FONT_FAMILY } from "@/lib/terminal-font-refit";

export type ShellKind = "powershell" | "kali" | "cmd";

type Tab = { id: string; kind: ShellKind; title: string; cwd: string };

const PROFILES: { kind: ShellKind; title: string; mark: string }[] = [
  { kind: "powershell", title: "PowerShell", mark: "PS" },
  { kind: "kali", title: "Kali Linux", mark: "KL" },
  { kind: "cmd", title: "Command Prompt", mark: "C" },
];

export type ShellDeskHandle = {
  sendLine: (text: string) => void;
};

function profileOf(kind: ShellKind) {
  return PROFILES.find((item) => item.kind === kind) ?? PROFILES[0];
}

export const ShellDesk = forwardRef<
  ShellDeskHandle,
  {
    initialCwd: string;
    accent: string;
    onEmpty: () => void;
    boot?: ShellKind | null;
    /**
     * Pinned, non-closable first tab rendered in the SAME card as the other
     * shells — Nex talks to the agent through this one "PowerShell" tab
     * (the real agent PTY), while Kali/CMD/extra PowerShell tabs opened via
     * "+"/the dropdown are plain OS shells for hands-on pentest work.
     */
    primaryTab?: { title: string; mark: string; content: ReactNode };
  }
>(
  function ShellDesk({ initialCwd, accent, onEmpty, boot = null, primaryTab }, ref) {
    const [tabs, setTabs] = useState<Tab[]>(() => boot ? [{ id: "boot", kind: boot, title: profileOf(boot).title, cwd: initialCwd }] : []);
    const [active, setActive] = useState(() => (primaryTab ? "primary" : boot ? "boot" : ""));
    const [menu, setMenu] = useState(false);
    const [renaming, setRenaming] = useState<string | null>(null);
    const panes = useRef(new Map<string, { sendLine: (text: string) => void }>());

    useImperativeHandle(ref, () => ({
      sendLine(text: string) {
        panes.current.get(active)?.sendLine(text);
      },
    }));

    function openTab(kind: ShellKind) {
      const id = `${kind}-${Date.now()}`;
      setTabs((current) => [...current, { id, kind, title: profileOf(kind).title, cwd: initialCwd }]);
      setActive(id);
      setMenu(false);
    }

    function closeTab(id: string) {
      setTabs((current) => {
        const next = current.filter((tab) => tab.id !== id);
        if (next.length === 0) {
          setActive("");
          onEmpty();
        } else if (id === active) {
          setActive(next[next.length - 1].id);
        }
        return next;
      });
    }

    return (
      <div
        data-no-core
        className="relative z-20 flex min-h-0 flex-1 flex-col"
        style={{
          // No backdrop-blur and no solid/semi-opaque fill here on purpose:
          // Nex wants the NeuralCore sphere plainly visible behind the shell,
          // not a frosted box over it — and a full-stage backdrop-filter over
          // the live WebGL canvas was triggering GPU context loss (the sphere
          // going permanently blank). The drop-shadow keeps text legible
          // without painting anything behind it.
          filter: "drop-shadow(0 1px 3px rgba(0,0,0,0.9))",
        }}
      >
        <div className="flex h-[38px] shrink-0 items-end gap-1 px-1">
          {primaryTab && (
            <button
              type="button"
              onClick={() => setActive("primary")}
              className="flex h-[38px] min-w-[8rem] max-w-[14rem] items-center gap-2 rounded-t-lg px-3 text-left text-xs"
              style={{
                background: active === "primary" ? "rgba(8,11,17,0.72)" : "transparent",
                color: accent,
              }}
            >
              <span className="grid h-4 w-4 place-items-center rounded-full border text-[9px]" style={{ borderColor: accent }}>
                {primaryTab.mark}
              </span>
              <span className="truncate">{primaryTab.title}</span>
            </button>
          )}
          {tabs.map((tab) => (
            <button
              key={tab.id}
              type="button"
              onClick={() => setActive(tab.id)}
              onDoubleClick={() => setRenaming(tab.id)}
              onContextMenu={(event) => {
                event.preventDefault();
                setRenaming(tab.id);
              }}
              className="flex h-[38px] min-w-[8rem] max-w-[14rem] items-center gap-2 rounded-t-lg px-3 text-left text-xs"
              style={{
                background: tab.id === active ? "rgba(8,11,17,0.72)" : "transparent",
                color: accent,
              }}
            >
              <span className="grid h-4 w-4 place-items-center rounded-full border text-[9px]" style={{ borderColor: accent }}>
                {profileOf(tab.kind).mark}
              </span>
              {renaming === tab.id ? (
                <input
                  autoFocus
                  defaultValue={tab.title}
                  className="w-full bg-transparent outline-none"
                  onClick={(event) => event.stopPropagation()}
                  onBlur={(event) => {
                    const title = event.target.value.trim() || tab.title;
                    setTabs((current) => current.map((item) => (item.id === tab.id ? { ...item, title } : item)));
                    setRenaming(null);
                  }}
                  onKeyDown={(event) => {
                    if (event.key === "Enter") (event.target as HTMLInputElement).blur();
                  }}
                />
              ) : (
                <span className="truncate">{tab.title}</span>
              )}
              <span
                role="button"
                className="ml-auto px-1"
                onClick={(event) => {
                  event.stopPropagation();
                  closeTab(tab.id);
                }}
              >
                x
              </span>
            </button>
          ))}
          <button type="button" className="h-[38px] px-2 text-sm" style={{ color: accent }} onClick={() => openTab("powershell")}>
            +
          </button>
          <button type="button" className="h-[38px] px-1 text-xs" style={{ color: accent }} onClick={() => setMenu((open) => !open)}>
            ▾
          </button>
          {menu && (
            <div className="absolute left-40 top-[38px] z-40 rounded-md border bg-black/90 p-1 text-xs" style={{ borderColor: accent }}>
              {PROFILES.map((item) => (
                <button key={item.kind} type="button" className="block w-full px-3 py-2 text-left" style={{ color: accent }} onClick={() => openTab(item.kind)}>
                  {item.mark} {item.title}
                </button>
              ))}
            </div>
          )}
        </div>
        <div className="relative min-h-0 flex-1">
          {primaryTab && (
            <div className="absolute inset-0 overflow-hidden" style={{ display: active === "primary" ? "block" : "none" }}>
              {primaryTab.content}
            </div>
          )}
          {tabs.map((tab) => (
            <ShellPane
              key={tab.id}
              tab={tab}
              visible={tab.id === active}
              accent={accent}
              onCwd={(cwd) => setTabs((current) => current.map((item) => (item.id === tab.id ? { ...item, cwd } : item)))}
              register={(sendLine) => {
                panes.current.set(tab.id, { sendLine });
                return () => panes.current.delete(tab.id);
              }}
            />
          ))}
        </div>
      </div>
    );
  },
);

function ShellPane({
  tab, visible, accent, onCwd, register,
}: {
  tab: Tab;
  visible: boolean;
  accent: string;
  onCwd: (cwd: string) => void;
  register: (sendLine: (text: string) => void) => () => void;
}) {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const termRef = useRef<Terminal | null>(null);
  const wsRef = useRef<WebSocket | null>(null);
  const lineRef = useRef("");
  const tailRef = useRef<string[]>([]);
  const cwdRef = useRef(tab.cwd);
  const onCwdRef = useRef(onCwd);
  const registerRef = useRef(register);
  onCwdRef.current = onCwd;
  registerRef.current = register;

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    const term = new Terminal({
      cursorBlink: true,
      fontFamily: TERMINAL_FONT_FAMILY,
      fontSize: 14,
      scrollback: 5000,
      allowTransparency: true,
      theme: { background: "transparent", foreground: accent, cursor: accent },
    });
    const fit = new FitAddon();
    term.loadAddon(fit);
    term.open(host);
    const pushSize = () => {
      fit.fit();
      const socket = wsRef.current;
      if (socket && socket.readyState === WebSocket.OPEN && term.cols > 0 && term.rows > 0) {
        socket.send(`\x1b[RESIZE:${term.cols};${term.rows}]`);
      }
    };
    pushSize();
    termRef.current = term;
    let closed = false;
    let ws: WebSocket | null = null;

    const noteOutput = (chunk: string) => {
      for (const line of chunk.split(/\r?\n/)) {
        tailRef.current.push(line);
      }
      if (tailRef.current.length > 80) tailRef.current.splice(0, tailRef.current.length - 80);
    };

    const unregister = registerRef.current((text) => {
      const cd = text.trim().match(/^(?:cd|Set-Location|sl)\s+(.+)$/i);
      if (cd) {
        const next = cd[1].replace(/^["']|["']$/g, "");
        cwdRef.current = next;
        onCwdRef.current(next);
      }
      ws?.send(`${text}\r`);
    });

    void (async () => {
      const params: Record<string, string> = { shell: tab.kind, channel: `tab-${tab.id}` };
      if (cwdRef.current) params.cwd = cwdRef.current;
      const url = await api.buildWsUrl("/api/pty", params);
      if (closed) return;
      ws = new WebSocket(url);
      wsRef.current = ws;
      ws.binaryType = "arraybuffer";
      ws.onopen = () => pushSize();
      ws.onmessage = (event) => {
        const text = typeof event.data === "string" ? event.data : new TextDecoder().decode(event.data as ArrayBuffer);
        const painted = text.replace(/\r?\n/g, "\r\n");
        noteOutput(painted);
        term.write(painted);
      };
      term.onData((data) => {
        if (data === "\r") {
          const trimmed = lineRef.current.trim();
          lineRef.current = "";
          const cd = trimmed.match(/^(?:cd|Set-Location|sl)\s+(.+)$/i);
          if (cd) {
            const next = cd[1].replace(/^["']|["']$/g, "");
            cwdRef.current = next;
            onCwdRef.current(next);
          }
        } else if (data === "\u007f") {
          lineRef.current = lineRef.current.slice(0, -1);
        } else if (data >= " " && data.length === 1) {
          lineRef.current += data;
        }
        ws?.send(data);
      });
      const observer = new ResizeObserver(() => pushSize());
      observer.observe(host);
      ws.addEventListener("close", () => observer.disconnect());
    })();

    return () => {
      closed = true;
      unregister();
      ws?.close();
      term.dispose();
      termRef.current = null;
    };
  }, [tab.id, tab.kind]);

  return (
    <div
      ref={hostRef}
      className="absolute inset-0 overflow-hidden p-2 [&_.xterm]:h-full [&_.xterm-viewport]:!bg-transparent [&_.xterm-screen]:!bg-transparent [&_.xterm-scrollable-element]:!bg-transparent"
      style={{ display: visible ? "block" : "none" }}
    />
  );
}
