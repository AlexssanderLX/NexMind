# Skill: Work Attribution (Atribuição e Rastreabilidade de Commits)

> **Role:** Procedimento obrigatório para registrar atribuição de commits nos arquivos individuais sob `.ai/logs/<agent>.md`.  
> **Scope:** Rastreabilidade cirúrgica multi-agente, auditoria de bugs e eliminação de conflitos de merge.

---

## 1. Finalidade

Manter uma camada leve, rápida e auditável sobre o histórico do Git, permitindo ao Dono do Projeto (Alexssander) e ao Tech Lead (Antigravity) saber imediatamente qual agente ou desenvolvedor criou determinado commit, quando criou, qual era a tarefa e onde está a especificação do handoff.

---

## 2. Quando Usar

- Sempre que um agente de IA (Claude, Cursor, Codex, Antigravity) criar um commit real no Git do Nex como parte de uma implementação, correção, refatoração ou documentação.
- **Gatilho:** A atribuição ocorre **SOMENTE DEPOIS** que um commit real do Git foi gerado com sucesso.
- **Não usar:** Quando a tarefa for apenas de auditoria/leitura sem commit, ou ao modificar o próprio arquivo de log (evitando loops de recursão).

---

## 3. Identidades Canônicas de Agentes

Cada agente tem seu arquivo fixo sob `.ai/logs/`:
- `antigravity.md`: Tech Lead, auditorias, blueprints de arquitetura, governança e handoffs.
- `claude.md`: Claude Code (execuções de terminal, refatorações amplas, fundações).
- `cursor.md`: Cursor IDE agent (desenvolvimento assistido no editor, UI, fixes cirúrgicos).
- `codex.md`: Codex / GitHub Copilot (geração de código pontual).

---

## 4. Procedimento Obrigatório

1. **Confirmar Commit Real no Git:**
   - O commit deve estar criado e visível no log local:
     ```powershell
     git log -1 --format="%cd|%h|%s" --date=short
     ```
2. **Abrir o Log Exclusivo do seu Agente:**
   - Abra o arquivo correspondente em `.ai/logs/<agente>.md` (ex: se você é o Claude, use `claude.md`; se é o Cursor, use `cursor.md`).
3. **Adicionar Linha de Registro (Append-Only):**
   - Insira uma nova linha no final da tabela no formato:
     `| YYYY-MM-DD | <task-id> | <commit-hash> | <escopo-descricao> | <link-handoff> |`
4. **Regras Inegociáveis:**
   - **Append-Only:** NUNCA apague, reordene ou edite linhas anteriores.
   - **Zero Hashes Falsos:** NUNCA invente hashes, datas ou mensagens.
   - **Isolamento Total:** Edite **apenas** o arquivo do seu agente para garantir zero conflitos com outros agentes.

---

## 5. Exemplo de Saída Esperada

No arquivo `.ai/logs/cursor.md`:
```markdown
| 2026-11-11 | TASK-UX-AUTO-TOOLS-THINKING-CARD-015 | debc2e4 | Seleção de ferramentas por intenção no backend, card flutuante de raciocínio (thinking), accordion de tools e remoção da tarja vermelha invasiva | [TASK-UX-AUTO-TOOLS-THINKING-CARD-015.yaml](../handoffs/TASK-UX-AUTO-TOOLS-THINKING-CARD-015.yaml) |
```
