# Governança de desenvolvimento do NexMind

Regras obrigatórias para qualquer pessoa ou agente que altere este repositório. O dono do projeto decide o que entra
na `main`; a coordenação técnica revisa e prepara, mas **não integra sem autorização explícita**.

## Regras

1. **Ninguém trabalha na `main`.** Vale para agentes e para a coordenação.
2. **Uma branch por tarefa**, com nome no padrão `tipo/nome-em-kebab-case`:

   | Prefixo | Uso | Exemplo |
   |---|---|---|
   | `feature/` | funcionalidade nova | `feature/voice-integration`, `feature/nex-core-3d` |
   | `fix/` | correção | `fix/voice-latency` |
   | `test/` | testes | `test/integration-tests` |
   | `refactor/` | reorganização sem mudar comportamento | `refactor/endpoint-modules` |
   | `perf/` | desempenho | `perf/streaming-render` |
   | `docs/` | documentação | `docs/governance` |

3. **Cada agente só mexe na própria branch** (e só nos arquivos da sua área, ver `AGENTES.md`). Não altera branches
   alheias, não faz rebase nem force-push, não faz `reset --hard` sobre trabalho que não é dele.
4. **Nada de merge, deploy, publicação ou troca da versão executável** sem autorização explícita do dono.
5. **Todo commit é pequeno e descritivo**: `tipo(escopo): o que mudou`, com o porquê no corpo quando não for óbvio.
6. **Todo arquivo modificado é registrado** no relatório da branch (`docs/changes/<branch>.md`, modelo em
   `docs/changes/_TEMPLATE.md`).
7. Não apresentar como concluído o que não foi executado: testes que não rodaram são declarados como "não executados".

## Isolamento entre agentes: um worktree por agente

Dois agentes não podem usar a mesma pasta de trabalho em branches diferentes ao mesmo tempo. Cada agente trabalha num
`git worktree` próprio, criado a partir da `main`:

```powershell
git worktree add ..\NexMind-wt\voice-integration -b feature/voice-integration main
```

Ao terminar, o agente entrega a branch (commits + relatório). O worktree é removido pela coordenação depois.

## Fluxo de uma tarefa

1. A coordenação escreve o briefing (objetivo, arquivos permitidos, contratos, dependências).
2. O agente cria a branch e o worktree e desenvolve.
3. O agente roda os testes da sua área e anota os resultados reais.
4. O agente faz os commits e preenche `docs/changes/<branch>.md` (arquivos modificados, commits, testes, limitações).
5. O agente apresenta o resumo das alterações.
6. A coordenação revisa a compatibilidade com as outras branches (build do backend e do frontend, conflitos de arquivo
   compartilhado, contratos) e relata ao dono.
7. **O dono avalia e autoriza.** Só então a branch entra na `main`.

## Integração e retorno à versão funcional

Quando o dono autorizar uma integração:

1. Garantir que existe uma tag `stable/AAAA-MM-DD-descricao` apontando para a `main` **antes** do merge. Ela é o ponto
   de retorno.
2. `git merge --no-ff <branch>`: o merge fica como um único commit fácil de desfazer.
3. Recompilar (`dotnet build backend -c Release`, `npm run build` em `frontend/`) e fazer um teste de fumaça: abrir o
   app, conversar nos dois modos, criar e apagar uma conversa.
4. Se algo falhar, voltar (abaixo) e informar o dono.

**Voltar atrás**, sem perder histórico:

```powershell
git revert -m 1 <commit-do-merge>      # desfaz a integração mantendo o histórico
# ou, para voltar exatamente ao estado marcado:
git switch -c rollback/AAAA-MM-DD stable/AAAA-MM-DD-descricao
```

Depois, recompile: o `iniciar-nex.ps1` recompila o backend sozinho quando o código muda, e o frontend se refaz com
`npm run build` em `frontend/`.

**Dados:** as conversas ficam em `backend/data/` e não são alteradas por merges. Qualquer mudança no formato delas
exige migração documentada e backup prévio (copiar `backend/data/`).

## Dependências entre tarefas

A ordem de integração e as dependências ficam em `AGENTES.md`. Se uma tarefa depende de outra, ela só entra depois
(ou a dependência é declarada no relatório e resolvida pela coordenação).
