# Skill: Git Agent Workflow (Nex Multi-Agent Git Engine)

> **Role:** Procedimento padrão de engenharia para desenvolvimento em branches locais, integração em `develop` e release em `main`.  
> **Scope:** Toda e qualquer tarefa de código realizada por agentes de IA no ecossistema Nex.

---

## 1. Topologia do Git no Nex

O fluxo de versionamento do Nex é desenhado para desenvolvimento com múltiplos agentes autônomos sem colisões e sem vazar trabalho não testado para a nuvem:

```
[ GitHub (origin) ]
       │
     main  (ÚNICA branch no GitHub! Estado final testado e aprovado)
       ▲
       │ (Merge autorizado EXCLUSIVAMENTE pelo Alexssander)
       │
[ Local / Desktop ]
    develop  (Ambiente integrado de teste. Roda no atalho http://localhost:5080)
       ▲
       │ (Fast-Forward ou merge limpo após validação local)
       │
┌──────┴──────────────────────────────┐
│  Branches Locais por Tarefa         │
│  (Ex: feature/ux-cards, fix/prompt) │
│  Trabalho isolado dos Agentes       │
└─────────────────────────────────────┘
```

---

## 2. Invariantes do Processo

1. **GitHub é Exclusivo da `main`:**
   - No GitHub (`origin`) só existe e só existirá a branch `main`.
   - Nenhuma branch de agente ou de teste é enviada para o repositório remoto.
2. **`develop` é o Ambiente de Teste e Integração:**
   - O atalho do Desktop executa o `develop` na porta 5080 (`develop\iniciar-nex.ps1`).
   - Cada entrega de agente deve ser integrada em `develop` sem quebrar a execução local.
3. **Agentes NUNCA Codificam Direto no `develop`:**
   - Cada agente cria uma branch local dedicada a partir do `develop` (ex: `feature/minha-tarefa`).
   - Todo raciocínio e experimentação ocorre nessa branch isolada.
4. **Passo a Passo de Entrega do Agente:**
   - Passo 1: Implementar e validar a tarefa (`dotnet build` e `npm run build` com 0 erros).
   - Passo 2: Criar commit com mensagem semântica clara.
   - Passo 3: Registrar o commit no arquivo de log do seu agente sob `.ai/logs/<agente>.md` (seguindo a skill `work-attribution`).
   - Passo 4: Fazer merge para `develop` (preferencialmente `--ff-only` ou rebase prévio).
   - Passo 5: Apagar a branch local temporária (`git branch -d feature/nome`) para manter o repositório limpo.
5. **Cuidado Extremo com Junctions (`backend\data`):**
   - Se estiver usando worktree, lembre-se: `backend\data` pode ser um junction para os dados reais de conversas.
   - NUNCA use `git worktree remove --force` sem antes rodar `cmd /c rmdir <caminho>\backend\data`.

---

## 3. Checklist de Validação Pré-Merge
- [ ] `dotnet build` executa com 0 erros.
- [ ] `npm run build` executa com 0 erros.
- [ ] Commit criado localmente com hash real.
- [ ] Linha adicionada em `.ai/logs/<agente>.md`.
- [ ] Merge realizado em `develop`.
- [ ] Branch de tarefa deletada após o merge.
