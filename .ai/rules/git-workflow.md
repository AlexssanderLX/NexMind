# Git Workflow & Governança de Branches no Nex

## 1. Topologia de Branches e Worktrees

Para isolar o trabalho de múltiplos agentes executores e evitar conflitos de arquivos e locks de processos (.NET/Node):

- **Uma branch por agente/tarefa:** Prefixo padronizado de acordo com o tipo:
  - `feature/<nome>`: Novas funcionalidades.
  - `fix/<nome>`: Correção de bugs.
  - `test/<nome>`: Adição de suítes e cobertura de testes.
  - `refactor/<nome>`: Melhorias arquiteturais sem alteração de comportamento.
  - `docs/<nome>`: Documentação e governança.
- **Um git worktree por agente:** Criado em `.worktrees/<nome>` para permitir trabalho paralelo sem alternar o diretório raiz.

## 2. Fluxo Canônico de Integração (develop ──► main)

```text
Branch do Agente (feature/*, fix/*)
       │
       ▼
[Build Limpo + Testes 100% Green]
       │
       ▼
Branch `develop` (Ambiente de Integração)
       │
       ▼
Teste do Usuário via atalho oficial (porta 5080)
       │
       ▼
Autorização Explícita do Usuário
       │
       ▼
Branch `main` / Push para o GitHub
```

### Regras Estritas de Deploy:
1. **A branch de integração é `develop`:** O agente entrega sua branch exclusivamente em `develop` após o build limpo e testes verdes.
2. **Nenhum merge em `main` e nenhum `git push` sem autorização explícita do usuário:** A esteira de produção para `main` e para o repositório remoto depende do crivo humano.
3. **Portas de Desenvolvimento:** Testes de desenvolvimento isolados em worktrees utilizam portas `5081+`. A porta `5080` é de uso exclusivo da versão estável/oficial testada pelo usuário via atalho.
4. **Develop é somente leitura e integração:** É proibido desenvolver ou editar arquivos direto em `.worktrees/develop`. Essa pasta só recebe `git merge --ff-only` vindo da branch de um agente.
5. **Check pré-merge obrigatório:** Antes de qualquer entrega, o executor roda `git -C .worktrees/develop status --short`. Se houver arquivo modificado, a entrega é abortada na hora.
6. **Proibição de build sujo:** Nunca rodar `npm run build` ou `dotnet build` em `develop` com a working tree suja.
7. **Reinicialização econômica da porta 5080:** Mudança de frontend = `npm run build` na pasta `develop` e F5 no navegador. Mudança de backend = reiniciar só a API. Não rodar o atalho inteiro sem necessidade, porque isso reinicia o Ollama e gasta cerca de 7 s de VRAM.
8. **Diretório raiz dos MCPs:** O host MCP em C# roda a partir da raiz da solução. Os caminhos em `mcp_servers.json` são relativos a essa raiz.

## 3. Estratégia de Rollback

Caso uma regressão chegue a `develop` ou `main`:
- **Reversão de Merge:** `git revert -m 1 <commit-hash>`.
- **Restauração via Tag:** Restaurar o ponteiro para a tag estável conhecida (`stable/*`).

## 4. Salvaguarda Crítica de Junctions (Perigo de Perda de Dados)

> [!CAUTION]
> **NUNCA execute `git worktree remove --force` com a junction `backend\data` ativa!**
> No Windows, a junction `backend\data` aponta para os dados reais persistidos (conversas, bancos e arquivos do NexMind). Um `git worktree remove --force` com a junction montada segue o link simbólico e **apaga permanentemente os dados reais em disco**.

### Salvaguarda de remoção de worktree
Sempre remover a junction com `cmd /c rmdir <caminho>\backend\data` antes de `git worktree remove`.

### Procedimento Obrigatório antes de remover qualquer worktree:
1. Remover a junction explicitamente pelo prompt de comando:
   ```cmd
   cmd /c rmdir "<caminho-do-worktree>\backend\data"
   ```
2. Somente após a remoção confirmada da junction, remover o worktree via git:
   ```powershell
   git worktree remove .worktrees/<nome>
   ```
