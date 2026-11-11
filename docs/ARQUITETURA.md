# Arquitetura do NexMind (estado em 2026-11-10)

## Stack

- **Backend:** ASP.NET Core minimal API, .NET 10, em `backend/`. Porta `5080`. Serve o frontend compilado
  (`backend/wwwroot/`) e a API em `/api`.
- **Frontend:** React 19 + TypeScript + Tailwind CSS 4 + Vite, em `frontend/`. Markdown e fórmulas com
  `react-markdown` + KaTeX.
- **LLM:** Ollama local (`localhost:11434`). Modelos: `qwen3:4b-instruct` (Conversa) e `qwen3:4b` (Raciocínio).
- **Execução:** atalho **Nex** na Área de Trabalho, via `criar-atalho.ps1` e `iniciar-nex.ps1` (inicia o Ollama com perfil
  econômico de VRAM, o backend e abre o navegador).

## Mapa de módulos

```
backend/
  Program.cs            rotas e injeção de dependência (ponto de conflito: tudo junto)
  Models.cs             Conversation, Message, ChatRequest, ChatStats
  Llm/OllamaClient.cs   ÚNICO ponto que fala com o Ollama (chat em streaming, status, modelo carregado)
  Storage/              ConversationStore: um JSON por conversa + índice em memória, gravação atômica
  Metrics/              SystemMetrics: CPU, RAM, RAM do Ollama e GPU via NVML (nvidia-smi como plano B)
frontend/src/
  App.tsx               estado do app e chat (ponto de conflito: monólito de ~360 linhas)
  api.ts, types.ts      cliente da API e tipos
  components/           Sidebar, MessageView, SettingsPanel, MetricsModal, Background (esfera 2D atual)
  hooks/usePolling.ts   consultas periódicas que pausam com a aba oculta
  lib/tokenBuffer.ts    agrupa tokens em lotes para o streaming não pesar
```

## API atual

| Rota | Função |
|---|---|
| `GET /api/status` | conexão com o Ollama, versão e modelos instalados |
| `GET /api/metrics` | CPU, RAM, GPU/VRAM da máquina e modelo carregado |
| `GET/POST /api/conversations` | listar / criar |
| `GET/DELETE /api/conversations/{id}` | abrir / apagar |
| `POST /api/conversations/{id}/chat` | enviar mensagem; resposta em streaming NDJSON |

Não há autenticação: a API é pensada para `localhost`.

## Camadas previstas (ainda não implementadas)

1. **LLM**: inferência, configuração e comunicação com o Ollama (existe: `backend/Llm/`).
2. **MCPs / ferramentas**: integrações futuras (não implementado).
3. **Regras e políticas**: limites de execução e orçamentos por agente: CPU, RAM, VRAM, tempo (não implementado).

## Estado e riscos conhecidos

- **Sem testes automatizados.** Tudo foi validado por scripts e testes manuais. É a primeira lacuna a fechar.
- **Pontos de conflito:** `Program.cs` e `App.tsx` concentram muita coisa. Por isso os refactors `0a` e `0b` em
  `AGENTES.md`.
- **Voz:** STT/TTS não existem. O núcleo visual só visualiza o microfone, quando o usuário clica.
- **Limite de hardware:** só um modelo de 4B cabe na VRAM por vez. Agentes paralelos se revezam; o Ollama roda com
  `NUM_PARALLEL=1` no perfil econômico.
- **Desempenho medido:** ver a seção "Desempenho" do `README.md`.
