---
name: daily-engineering-kickoff
description: Executa a rotina obrigatória de inspeção de saúde do repositório antes de iniciar qualquer trabalho.
---

# Daily Engineering Kickoff

Procedimento obrigatório executado pelo Auditor ou Executor no início de qualquer sessão de trabalho.

## Checklist de 5 Passos:

### 1. Higiene de Processos e Portas
- Verificar se as portas da aplicação (`5080`, `5173`) e a porta do Ollama (`11434`) estão livres ou rodando normalmente sem instâncias zumbis travadas.
- Se houver processos órfãos ocupando as portas, encerrá-los antes de prosseguir.

### 2. Git & Worktree Status
- Inspecionar a branch ativa (`git branch --show-current`).
- Verificar se o diretório de trabalho está limpo (`git status`).
- Revisar os últimos commits (`git log -n 5 --oneline`).

### 3. Build Limpo
- Compilar o backend .NET:
  ```powershell
  dotnet build backend/LocalAi.Api.csproj
  ```
- O build DEVE terminar com `0 Erro(s)`.

### 4. Sanidade dos Testes (100% Green Gate)
- Rodar os testes automatizados da solução (quando configurados).
- Nenhum avanço ou handoff é permitido sobre uma base quebrada.

### 5. Mapeamento de Handoffs & Blueprint
- Verificar se existem handoffs pendentes em `.ai/handoffs/`.
- Identificar a tarefa prioritária e preparar a especificação atômica para o executor.

