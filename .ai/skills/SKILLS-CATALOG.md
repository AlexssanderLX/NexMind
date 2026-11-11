# Catálogo Oficial de Skills (Nex Mind)

> **Finalidade:** Registro único, auditável e canônico de todas as skills do projeto Nex.  
> **Regra:** Quando um agente criar ou sugerir uma nova skill, ele DEVE registrar uma entrada nesta tabela com a justificativa técnica. O Auditor e Tech Lead (Antigravity) e o Dono do Projeto (Alexssander) revisam para aprovar, consolidar ou arquivar.

---

## 1. Registro Histórico de Skills

| Data (UTC) | Nome da Skill | Caminho | Autor / Agente | Justificativa / Problema Resolvido | Status |
|---|---|---|---|---|---|
| 2026-11-11 | `work-attribution` | `.ai/skills/work-attribution/` | Antigravity | Rastreabilidade inegociável de commits e autoria de agentes nos logs individuais (`.ai/logs/<agente>.md`) | Ativa |
| 2026-11-11 | `git-agent-workflow` | `.ai/skills/git-agent-workflow/` | Antigravity | Padrão de trabalho em branches locais por tarefa, merge limpo para `develop` (atalho) e apenas `main` no GitHub | Ativa |
| 2026-11-11 | `daily-engineering-kickoff` | `.ai/skills/daily-engineering-kickoff/` | Antigravity | Protocolo de inicialização diária, checagem de integridade, testes de build e auditoria de estado do Git | Ativa |
| 2026-11-11 | `implement-mcp-server` | `.ai/skills/implement-mcp-server/` | Antigravity | Padrão arquitetural para expansão de tools locais via protocolo MCP (Stdio JSON-RPC em C# e Python) | Ativa |
| 2026-11-11 | `micro-rag-memory` | `.ai/skills/micro-rag-memory/` | Cursor / Antigravity | Governança de memória local isolada por conversa (`INDEX.md`, fatos comprovados e scratchpad de hipóteses) | Ativa |
| 2026-11-11 | `auto-tools-routing` | `.ai/skills/auto-tools-routing/` | Cursor / Antigravity | Ativação automática de ferramentas por análise de intenção e exibição colapsável de raciocínio/atividades | Ativa |

---

## 2. Critérios para Aprovação de Novas Skills
1. **Reutilização Real:** Aplica-se a mais de uma tarefa ou domínio futuro do Nex (não é remendo pontual).
2. **Estabilidade e Isolamento:** Respeita o limite de VRAM da RTX 3050 (6GB) e as convenções de arquitetura limpa.
3. **Não-Redundância:** Não duplica regras já existentes em `.ai/rules/`.
