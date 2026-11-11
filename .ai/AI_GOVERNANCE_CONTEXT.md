# Nex — AI Governance Context Map

> **Propósito:** Mapa de contexto mestre para o Agente Auditor & Tech Lead (Antigravity), desenvolvedor líder e agentes executores (Cursor, Claude, Copilot) ao planejar, implementar e auditar tarefas no ecossistema **Nex / ia-local**.
>
> Este documento centraliza o conhecimento de governança técnica. Ele descreve quais recursos existem, quais são suas fronteiras de responsabilidade e quais arquivos devem ser indexados nos prompts para cada tipo de tarefa.

---

# 1. Modelo de Governança

O Nex adota a camada canônica de governança técnica sob `.ai/`:

```text
.ai/
├── rules/
│   ├── nex-core.md               # Constituição do produto, stack (.NET 10 + React 19 + Ollama) e princípios
│   ├── git-workflow.md           # Branches por agente, worktrees em .worktrees/, esteira develop -> main e salvaguarda de junctions
│   ├── architecture.md           # Camadas, contratos de API, isolamento de LLM e núcleos de renderização
│   ├── mcp-protocol.md           # Padrão MCP oficial (SDK ModelContextProtocol), markitdown-mcp e Human-in-the-Loop
│   ├── performance-and-vram.md   # Limites medidos de GPU/VRAM, contexto por mensagem (4k-32k) e keep_alive
│   ├── testing.md                # Estratégia de testes unitários e de integração (100% Green Gate)
│   └── agent-efficiency.md       # Regras para agentes: foco cirúrgico, sem over-engineering, preservar contratos
│
├── skills/
│   ├── daily-engineering-kickoff/SKILL.md # Checklist de 5 passos de saúde do repositório
│   ├── implement-feature/SKILL.md         # Procedimento padrão para novas funcionalidades
│   ├── implement-mcp-server/SKILL.md      # Criação, registro e teste de ferramentas/servidores MCP
│   └── bug-fix/SKILL.md                   # Diagnóstico na raiz e correção sem regressão
│
├── handoffs/
│   ├── TASK-TEMPLATE.yaml        # Template canônico de especificação atômica para executores
│   └── ...                       # Handoffs ativos e arquivados
│
├── logs/
│   └── AI-WORK-LOG.md            # Registro cronológico de auditorias e decisões técnicas
│
└── AI_GOVERNANCE_CONTEXT.md      # Este documento
```

### Hierarquia de Autoridade:
```text
GLOBAL RULES (nex-core.md)
  ──► RELEVANT TECHNICAL RULES (architecture.md, mcp-protocol.md, performance-and-vram.md)
        ──► RELEVANT SKILL (procedimento de execução: SKILL.md)
              ──► ATOMIC TASK HANDOFF (.ai/handoffs/TASK-XYZ.yaml)
```

- **Rules:** Restrições e invariantes estáveis e inegociáveis.
- **Skills:** Procedimentos padronizados e reprodutíveis.
- **Handoffs:** Contratos atômicos de entrega com Definition of Done para agentes executores.

---

# 2. Resumo das Regras Globais (.ai/rules/)

## `nex-core.md`
- **Constituição:** Chat local com modelos abertos (Ollama) priorizando velocidade, baixo consumo de VRAM e extensibilidade via MCPs próprios.
- **Stack:** .NET 10 (ASP.NET Core Minimal APIs / WebSockets / SSE), React 19 + TypeScript + Tailwind, KaTeX para fórmulas, Ollama local.

## `architecture.md`
- **Fronteiras:**
  - `backend/Llm/`: Único ponto de contato com o Ollama (`/api/chat`).
  - `backend/Mcp/`: Subsistema de orquestração de servidores MCP e ferramentas.
  - `backend/Metrics/`: Monitoramento de hardware via NVML direto (`nvml.dll`), com fallback leve para `nvidia-smi`.
  - `backend/Storage/`: Persistência atômica via arquivos temporários (`conversations/*.json`).
  - `frontend/`: Renderização em lotes para evitar que o reprocessamento de Markdown/LaTeX concorra com a CPU/GPU.

## `mcp-protocol.md`
- **Especificação:** Suporte a ferramentas externas via Model Context Protocol (MCP) sobre JSON-RPC 2.0 (stdio / SSE).
- **Ciclo:** Descoberta (`tools/list`) ──► Injeção no contexto do LLM ──► Execução delegada (`tools/call`) ──► Retorno do resultado.

## `performance-and-vram.md`
- **Invariantes de Hardware:** O sistema roda sob restrições reais de VRAM (ex: RTX 3050 6 GB).
- **Otimizações Obrigatórias:** `OLLAMA_FLASH_ATTENTION=1`, `OLLAMA_KV_CACHE_TYPE=q8_0`, `OLLAMA_NUM_PARALLEL=1`, Canvas 2D puro sem WebGL disputando recursos com a IA.

---

# 3. Papéis e Dinâmica de Trabalho

| Papel | Agente | Responsabilidade |
|---|---|---|
| **Auditor & Tech Lead** | Antigravity (esta sessão) | Governança, arquitetura, design de MCPs, criação de handoffs, auditoria de diffs e testes. Não gera código impulsivo. |
| **Executor** | Cursor / Claude / Copilot | Recebe o prompt linkando regras/skills e o handoff em `.ai/handoffs/`. Codifica estritamente dentro da fronteira definida e devolve com testes verdes. |
| **Líder do Produto** | Desenvolvedor Humano | Define prioridades de negócio, aprova arquitetura e comanda o ritmo das entregas. |

