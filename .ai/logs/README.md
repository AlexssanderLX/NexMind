# Nex AI Work Logs Directory

> **Repositório:** Nex Mind / Local AI Assistant (`ia-local`)  
> **Estrutura:** Logs particionados por agente para assegurar rastreabilidade cirúrgica, autoria clara e zero conflitos de merge.

Cada agente de IA possui seu próprio arquivo de log nesta pasta `.ai/logs/`:

- 🤖 **Antigravity (Tech Lead / Auditor / Arquiteto):** [`antigravity.md`](antigravity.md)
- 🤖 **Claude (Builder / Executor / Fundações & Refatorações):** [`claude.md`](claude.md)
- 🤖 **Cursor (IDE Pair Programmer / Ajustes Cirúrgicos):** [`cursor.md`](cursor.md)
- 🤖 **Codex / Outros (Automações pontuais):** [`codex.md`](codex.md)

### Regra Inegociável para Agentes:
1. Ao concluir uma tarefa com commit real no Git, adicione a linha de registro **exclusivamente** no arquivo do seu agente (ex: se você é o Claude, edite apenas `.ai/logs/claude.md`).
2. NUNCA invente hashes, timestamps ou escopos. Apenas registre commits reais já existentes no Git (`git log -1 --format="%cd|%h|%s" --date=short`).
3. O log é estritamente **append-only** (nunca reescreva, reordene ou delete linhas anteriores).
