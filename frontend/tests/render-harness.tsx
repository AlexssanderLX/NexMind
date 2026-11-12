// Renderiza os componentes novos em HTML estático (react-dom/server) para o teste render.test.mjs conferir. Sem navegador, sem porta.
import { renderToStaticMarkup } from "react-dom/server";
import MessageView from "../src/components/MessageView";
import FloatingPanel from "../src/components/panels/FloatingPanel";
import { AgentMenu, RobotOrb } from "../src/components/SecurityAgentsLayer";
import SecurityTaskPanel from "../src/components/SecurityTaskPanel";
import { VaultFormatted } from "../src/components/SecurityVaultModal";
import { VAULTS } from "../src/lib/vaults";
import SubagentChat from "../src/components/SubagentChat";
import Sidebar from "../src/components/Sidebar";
import WorkspaceSwitcher from "../src/components/WorkspaceSwitcher";
import TaskThinkingPill from "../src/components/TaskThinkingPill";
import type { Message, MicroAppMode, ToolRun } from "../src/types";

const noop = () => {};
const planning = "💭 [Planejamento de Execução]\n• Complexidade: direta\n• Contexto: 4096 (100% na GPU)\n• Ferramentas: nenhuma\n".repeat(5);
const run = (name: string, state: string, extra: Partial<ToolRun> = {}): ToolRun => ({ name, state, ...extra });

const msg = (over: Partial<Message>): Message => ({ role: "assistant", content: "", ...over });

export function render() {
  const sidebar = (microApp: MicroAppMode, collapsed = false) =>
    renderToStaticMarkup(
      <Sidebar
        items={[
          { id: "a", title: "Conversa geral", updatedAt: "2026-11-12T00:00:00Z", mode: "general" },
          { id: "b", title: "Conversa de seguranca", updatedAt: "2026-11-12T00:00:00Z", mode: "security" },
          { id: "c", title: "Conversa antiga", updatedAt: "2026-11-12T00:00:00Z" },
        ]}
        activeId="a"
        connected
        connectionLabel="ok"
        collapsed={collapsed}
        onToggle={noop}
        onNew={noop}
        onSelect={noop}
        onDelete={noop}
        onRename={noop}
        onSettings={noop}
        mode={microApp}
      />,
    );

  const panelBase = { bounds: { w: 1200, h: 800 }, onMove: noop, onMoveEnd: noop, mobile: false, glass: true, onToggle: noop };
  const recon = { id: "recon" as const, name: "Recon Specialist" };

  return {
    taskPanel0: renderToStaticMarkup(<SecurityTaskPanel />),
    taskPanelCounts: renderToStaticMarkup(<SecurityTaskPanel counts={{ surface: 3, hypotheses: 1 }} />),
    vaultFormatted: renderToStaticMarkup(<VaultFormatted text={"# Rotas\n- GET /api/users/{id}\n- POST /api/login\nTexto solto"} />),
    vaultEmpty: renderToStaticMarkup(<VaultFormatted text="" />),
    taskPanelQueue: renderToStaticMarkup(<SecurityTaskPanel queue={[{ id: "1", title: "Mapear /api", state: "rodando" }]} />),
    fabClosed: renderToStaticMarkup(
      <FloatingPanel title="Subagentes de Security" icon="🤖" orb={<RobotOrb />} open={false} pos={{ x: 900, y: 400 }} {...panelBase}>
        <AgentMenu open={[]} onPick={noop} />
      </FloatingPanel>,
    ),
    fabMenu: renderToStaticMarkup(
      <FloatingPanel title="Subagentes de Security" icon="🤖" orb={<RobotOrb />} open pos={{ x: 900, y: 400 }} {...panelBase}>
        <AgentMenu open={["auth", "verify"]} onPick={noop} />
      </FloatingPanel>,
    ),
    subWindow: renderToStaticMarkup(
      <FloatingPanel title={recon.name} icon="🧭" orb={null} open pos={{ x: 100, y: 70 }} width={380} closeGlyph="✕" closeTitle="Fechar" {...panelBase}>
        <SubagentChat agent={recon} conversationId={null} ensureConversation={async () => "x"} model="qwen3:4b-instruct" ceiling={32768} />
      </FloatingPanel>,
    ),
    plainPanel: renderToStaticMarkup(
      <FloatingPanel title="Atividade do Nex" icon="i" orb={null} open pos={{ x: 16, y: 56 }} {...panelBase}>
        <p>corpo</p>
      </FloatingPanel>,
    ),
    direct: renderToStaticMarkup(<MessageView m={msg({ content: "Bom dia, Alexssander. Em que ajudo?", thinking: planning })} />),
    withTool: renderToStaticMarkup(
      <MessageView
        m={msg({ content: "O site mostra um portfólio.", thinking: planning, tools: [run("browser__browser_get_dom", "concluida", { detail: "Aba [1] https://a.com" })] })}
      />,
    ),
    live: renderToStaticMarkup(
      <MessageView
        streaming
        m={msg({ content: "Vou abrir o site e ler a página.", thinking: planning, tools: [run("browser__browser_navigate", "executando", { brief: "url=https://a.com" })] })}
      />,
    ),
    liveNoText: renderToStaticMarkup(<MessageView streaming m={msg({ thinking: planning })} />),
    failed: renderToStaticMarkup(
      <MessageView
        m={msg({ content: "Não consegui abrir.", thinking: planning, tools: [run("browser__browser_navigate", "falhou", { detail: "ERRO: A porta 9334 do Nex está ocupada" })] })}
      />,
    ),
    refused: renderToStaticMarkup(<MessageView m={msg({ content: "Ok, não clico.", tools: [run("browser__browser_click", "recusada")] })} />),
    plainOld: renderToStaticMarkup(<MessageView m={msg({ content: "Mensagem antiga, sem raciocínio nem ferramentas." })} />),
    pillOnly: renderToStaticMarkup(<TaskThinkingPill tools={[run("topic_write", "concluida")]} thinking="" live={false} />),
    sidebarGeneral: sidebar("general"),
    sidebarSecurity: sidebar("security"),
    sidebarCollapsedSecurity: sidebar("security", true),
    sidebarDev: sidebar("dev"),
    switcherSecurity: renderToStaticMarkup(<WorkspaceSwitcher mode="security" onChange={noop} />),
    switcherDev: renderToStaticMarkup(<WorkspaceSwitcher mode="dev" onChange={noop} />),
    switcherDisabled: renderToStaticMarkup(<WorkspaceSwitcher mode="general" onChange={noop} disabled />),
    panel: renderToStaticMarkup(<SecurityTaskPanel />),
    vaults: [...VAULTS],
  };
}
