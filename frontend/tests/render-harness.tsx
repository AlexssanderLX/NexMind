// Renderiza os componentes novos em HTML estático (react-dom/server) para o teste render.test.mjs conferir. Sem navegador, sem porta.
import { renderToStaticMarkup } from "react-dom/server";
import MessageView from "../src/components/MessageView";
import SecurityTaskPanel, { SECURITY_STAGES } from "../src/components/SecurityTaskPanel";
import Sidebar from "../src/components/Sidebar";
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
        items={[{ id: "a", title: "Conversa", updatedAt: "2026-11-12T00:00:00Z" }]}
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
        microApp={microApp}
        onMicroApp={noop}
      />,
    );

  return {
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
    panel: renderToStaticMarkup(<SecurityTaskPanel />),
    stages: [...SECURITY_STAGES],
  };
}
