# Protocolo de Geração de Prompts do Auditor (Antigravity)

> **Regra de Ouro Inegociável:** Antes de montar qualquer prompt de execução para agentes executores (Cursor, Claude Code, Codex), o Auditor **DEVE consultar este checklist** para garantir 100% de precisão e evitar erros de comunicação ou violações de fluxo Git.

---

## Checklist Pré-Emissão de Prompt

Antes de entregar qualquer prompt ao Alexssander:

- [ ] **1. Branch de Trabalho Isolada Obrigatória:**
  - O prompt NUNCA diz "trabalhe na develop".
  - O prompt SEMPRE instrui:
    ```bash
    git checkout develop
    git pull (ou assegurar develop limpo)
    git checkout -b <tipo>/<nome-da-tarefa>
    ```
- [ ] **2. Porta Fixa 5080:**
  - O prompt reforça que o Nex roda exclusivamente em `http://localhost:5080`.
- [ ] **3. Critérios de Build Limpo (0 Erros):**
  - O prompt especifica explicitamente:
    `npm --prefix frontend run build` (0 erros)
    `dotnet build backend -c Release` (0 erros)
- [ ] **4. Protocolo de Merge & Cleanup:**
  - O prompt instrui o ciclo completo:
    ```bash
    # Na branch de tarefa:
    git commit -m "tipo(escopo): mensagem descritiva"
    # No develop:
    git checkout develop
    git merge <tipo>/<nome-da-tarefa>
    git branch -d <tipo>/<nome-da-tarefa>
    ```
- [ ] **5. Rastreabilidade de Autoria:**
  - O prompt exige registro da entrega em `.ai/logs/<agente>.md` (Cursor ou Claude).
