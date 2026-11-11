# Agentes do NexMind: papéis, áreas e contratos

## Briefing comum (todo agente lê antes de começar)

- **Objetivo:** o NexMind (Nex) é um assistente de IA **local**: interface web que conversa com um modelo rodando no
  próprio PC via Ollama. Hoje: Qwen3 4B Instruct (modo Conversa) e Qwen3 4B Thinking (modo Raciocínio).
- **Hardware de referência:** RTX 3050 6 GB (~4,9 GB livres), 16 GB de RAM, Windows 11. A IA já é pesada: o resto do
  app precisa ser leve. Meça antes de afirmar desempenho.
- **Stack:** ASP.NET Core (.NET 10) em `backend/`; React 19 + TypeScript + Tailwind + Vite em `frontend/`. Ver
  `ARQUITETURA.md`.
- **Princípios:** simplicidade, modularidade, sem abstração prematura, sem dependência nova sem justificativa. Nada de
  nuvem para voz ou dados do usuário: tudo local.
- **Regras de branch e fluxo:** `GOVERNANCA.md`. Resumo: uma branch e um worktree por agente, sem merge, relatório em
  `docs/changes/`.

## Papéis e áreas de arquivos

"Pode modificar" é a lista de pastas do agente. Fora dela, só os arquivos compartilhados (abaixo), com mudança mínima e
declarada no relatório.

| Agente | Responsabilidade | Pode modificar | Não deve tocar |
|---|---|---|---|
| **Frontend** | interface, componentes, UX, núcleo visual | `frontend/src/core/`, `components/`, `hooks/`, `lib/`, `index.css` | `backend/` |
| **Backend** | APIs, armazenamento, métricas, integrações | `backend/Storage/`, `backend/Metrics/`, `backend/Endpoints/` (novo) | `backend/Llm/`, `frontend/` |
| **IA** | Ollama, contexto, memória, orquestração, tool-calling | `backend/Llm/`, `backend/Memory/` (novo), `backend/Orchestration/` (novo) | `frontend/src/core/` |
| **Voice** | STT, TTS, VAD, áudio local | `backend/Voice/` (novo), `frontend/src/voice/` (novo) | `frontend/src/core/`, `backend/Llm/` |
| **QA** | testes, regressões, revisão | `backend.Tests/` (novo), `frontend/tests/` (novo), `scripts/qa/` (novo) | código de produção (só reporta) |

### Arquivos compartilhados (pontos de conflito)

`backend/Program.cs`, `frontend/src/App.tsx`, `frontend/src/components/SettingsPanel.tsx`, `frontend/src/types.ts`,
`frontend/package.json`, `README.md`.

Regras: mudanças **aditivas e mínimas**, nunca reorganizar o arquivo, e listar cada alteração no relatório. A forma de
reduzir o conflito de vez é fazer antes dois refactors pequenos (abaixo).

## Contratos entre módulos

1. **Chat em streaming** (`POST /api/conversations/{id}/chat`): resposta NDJSON, uma linha JSON por evento:
   `{type:"thinking"|"token", text}`, `{type:"done", stats}`, `{type:"error", message}`. Quem muda isso avisa a coordenação.
2. **Eventos do núcleo visual** (`frontend/src/core/events.ts`): `nex:state` (`idle|listening|thinking|speaking|tool|
   success|error`) e `nex:audio-level` (0..1). **Voice e Ferramentas só emitem esses eventos**, sem mexer no código do
   núcleo.
3. **Cliente do LLM** (`backend/Llm/OllamaClient.cs`): é o único lugar que fala com o Ollama. Orquestração e memória
   ficam numa camada acima e **chamam** o cliente; não criam um segundo.
4. **Persistência de conversas** (`backend/Storage/ConversationStore.cs`): formato JSON por conversa, com índice em
   memória. Memória de longo prazo usa pasta/arquivos próprios. Mudar o formato das conversas exige migração.
5. **Eventos e rotas novas** entram por módulo (`Endpoints/`), não crescendo o `Program.cs`.
6. **Versão de uso:** o atalho do dono roda a pasta `Programação\NexMind` (worktree na `main`). Nenhum agente edita
   essa pasta nem usa a porta `5080`; testes de desenvolvimento rodam em `.worktrees\<nome>`, em outra porta (ex.:
   `--urls http://localhost:5081`). Ver `GOVERNANCA.md`.

## Regra contra duplicação

Uma funcionalidade tem **um dono**. Antes de implementar algo, o agente confere a tabela acima. Se precisa de algo de
outra área, pede à coordenação em vez de fazer a própria versão. Se dois briefings parecerem se sobrepor, a
coordenação resolve antes de qualquer código.

## Tarefas e ordem de integração (proposta)

| # | Branch | Agente | Depende de | Nota |
|---|---|---|---|---|
| 0a | `refactor/endpoint-modules` | Backend | nada | tira as rotas de `Program.cs` para `Endpoints/`; evita colisão |
| 0b | `refactor/app-hooks` | Frontend | nada | quebra o `App.tsx` em hooks (`useChat` etc.); evita colisão |
| 1 | `feature/nex-core-3d` | Frontend | 0b (recomendado) | núcleo neural 3D, estados, painéis, perfis; define o contrato de eventos |
| 2 | `test/integration-tests` | QA | nada | só adiciona arquivos; pode rodar desde já |
| 3 | `feature/ollama-orchestration` | IA | 0a | contexto, roteamento Conversa/Raciocínio, base para ferramentas |
| 4 | `feature/voice-integration` | Voice | 1 e 0a | STT/TTS/VAD locais; emite os eventos do núcleo |
| 5 | `feature/memory-system` | IA | 3 | memória de longo prazo |

A coordenação confirma a ordem a cada rodada. Nada entra na `main` sem autorização do dono.

## Modelo de briefing para um agente

```
Tarefa: <nome> | Branch: <tipo/nome> | Worktree: ..\NexMind-wt\<nome>
Objetivo: <1-3 frases>
Pode modificar: <pastas>   Arquivos compartilhados que pode tocar (mínimo): <lista>
Contratos que deve respeitar: <números acima>
Depende de: <branches>   Não implementar: <o que é de outro agente>
Entrega: commits + docs/changes/<branch>.md com arquivos modificados, testes executados (resultado real) e limitações.
Proibido: merge, push na main, force-push, tocar outras branches.
```
