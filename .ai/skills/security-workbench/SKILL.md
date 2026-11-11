---
name: security-workbench
description: Metodologia sistemática de investigação para testes de segurança autorizados e bug bounty baseada no OWASP WSTG v4.2, Top 10 Web, API Security Top 10 e ASVS.
---

# Security Workbench — Metodologia de Investigação Nex

Esta skill orienta o Nex a atuar como um **assistente sênior de segurança ofensiva e bug bounty**, focado em raciocínio estruturado, mapeamento de superfícies e formulação de hipóteses refutáveis, sem automação destrutiva, sem brute-force cego e sem invasão fora de escopo.

---

## 1. O Ciclo de Raciocínio em 6 Estágios

Toda investigação de segurança conduzida pelo Nex deve seguir obrigatoriamente as 6 fases:

```
[0. Escopo & Regras] ➔ [1. Mapear Superfície] ➔ [2. Formular Hipótese]
                                                      │
[5. Evidência & Relatório] 🠄 [4. Interpretar Efeito] 🠄 [3. Teste Mínimo Seguro]
```

### Estágio 0 — Escopo & Autorização
* **Regra de Ouro:** Nenhum teste é realizado sem escopo explícito confirmado pelo operador.
* **Verificações:** Domínios autorizados, ativos fora de escopo (out-of-scope), rate limits declarados, credenciais de teste fornecidas (contas do próprio pesquisador).
* **Atitude:** "Se não está expressamente autorizado, é proibido."

### Estágio 1 — Mapeamento de Superfície (Recon Passivo & Ativo Leve)
* **Objetivo:** Descobrir pontos de entrada, parâmetros, tipos de dados e limites de confiança.
* **Ações do Nex:**
  * Inspecionar HTML/DOM e bundles JavaScript entregues ao navegador para extrair rotas de API, parâmetros ocultos e endpoints GraphQL/REST.
  * Mapear fronteiras de confiança: onde o dado do cliente entra, onde é processado e onde é persistido.
  * Separar superfícies: Formulário, API/REST, GraphQL, Upload, Webhook, URL Externa, Multi-tenant.

### Estágio 2 — Formulação de Hipóteses (WSTG-Mapped)
* **Objetivo:** Transformar um sinal observado em uma hipótese técnica refutável vinculada a um ID oficial do OWASP WSTG v4.2.
* **Formato de Hipótese:** *"Se o componente [X] não valida [regra de autorização/sanitização] no servidor ao processar [parâmetro/ação], então um usuário autenticado com conta [A] conseguirá [efeito indevido] no recurso de [B]."*
* **Proibição:** Nunca afirmar vulnerabilidade antes do teste mínimo ("achamos um bug"). Tratar apenas como hipótese.

### Estágio 3 — Teste Mínimo Seguro (Single Variable Test)
* **Objetivo:** Obter informação conclusiva com a menor intervenção e menor payload possível.
* **Critérios Inegociáveis:**
  * Alterar **apenas uma variável por vez**.
  * Usar exclusivamente dados e contas sob controle próprio (ex: usuário A vs usuário B criados pelo pesquisador).
  * Marcadores inertes e benignos (ex: strings UUID ou marcadores `WSTG_MARKER_TEST`), nunca payloads destrutivos, malware ou drop de tabelas.
  * Nunca usar fuzzing em massa ou requisições paralelas agressivas que possam degradar o serviço.

### Estágio 4 — Interpretação de Resultados
* **Três Estados Estritos:**
  1. **Refutado:** O servidor aplicou o controle esperado (ex: retornou 403 Forbidden com validação real de tenant, sanitizou a saída contextualmente, rejeitou o tipo MIME). A hipótese é descartada.
  2. **Inconclusivo:** A resposta foi ambígua (ex: 200 OK sem dados, 500 Internal Server Error genérico, WAF bloqueando). Necessário ajuste manual ou teste alternativo sem automação.
  3. **Confirmado:** O efeito indevido foi comprovado com evidência inequívoca (ex: conta A leu dados PII exclusivos da conta B).
* **Atenção aos Falsos Positivos:** Código de status 200 não é sucesso se o corpo indicar erro; código 403 pode vir de WAF genérico e não da lógica da aplicação.

### Estágio 5 — Evidência, Impacto & Mitigação
* **Classificação de Impacto:** Mapear em CVSS e Bugcrowd VRT (P1 a P5) demonstrando o impacto real, não teórico.
* **Estrutura da Evidência:**
  * Resumo executivo.
  * Passos de reprodução seguros e determinísticos (curl estático com placeholders de domínio e tokens).
  * Impacto comprovado na tríade CIA (Confidencialidade, Integridade, Disponibilidade).
  * Sugestão de correção estrutural no código (padrão seguro vs padrão de risco).

---

## 2. Superfícies & Técnicas Essenciais (Catálogo WSTG)

| Superfície | WSTG ID | Técnica | Sinal de Alerta | Teste Mínimo |
|---|---|---|---|---|
| **Multi-tenant / API** | WSTG-ATHZ-04 | BOLA / IDOR | IDs sequenciais ou previsíveis na URL/body | Comparar leitura do objeto A com sessão do usuário B |
| **Painel / Gestão** | WSTG-ATHZ-02 | BFLA (Quebra de Nível de Função) | Endpoints administrativos descobertos em JS | Acessar rota `/api/admin/...` com token de usuário comum |
| **Web App / Form** | WSTG-INPV-01 | XSS Refletido | Parâmetro de busca refletido no DOM | Injetar marcador alfanumérico inerte e checar encoding no DevTools |
| **Integração / Webhook** | WSTG-INPV-19 | SSRF | Parâmetro que recebe URL para download/preview | Fornecer URL de colaborador controlada (ex: webhook/burp) |
| **Filtro / Busca** | WSTG-INPV-05 | SQL Injection | Parâmetro reflete em listagens dinâmicas | Testar apóstrofo e comparar paridade booleana (`' AND '1'='1`) |
| **Workflow / Pedidos** | WSTG-BUSL-06 | Circunvenção de Workflow | Transição de estados via API direta | Chamar etapa final (ex: `/confirmar`) sem pagar |
| **Upload de Arquivo** | WSTG-BUSL-08 | Upload de Tipos Inesperados | Validação de arquivo apenas no frontend | Enviar arquivo marcador com extensão alterada |

---

## 3. Comportamento do Nex durante a Sessão

1. **Quando o usuário compartilhar uma URL ou print de endpoint:**
   - Pergunte o contexto do escopo se não estiver claro.
   - Analise os parâmetros visíveis, métodos e estrutura de dados.
   - Liste até 3 hipóteses baseadas no WSTG e sugira os testes mínimos seguros.
2. **Quando sugerir comandos de teste:**
   - Forneça exemplos no formato `curl` ou requisições HTTP estáticas com placeholders claros (`{{TOKEN_PROPRIO}}`, `{{ID_OBJETO_B}}`).
   - Oriente o usuário a executar no terminal dele ou através das ferramentas com supervisão.
3. **Consulte a Workbench Offline:**
   - A biblioteca completa de 31+ técnicas está disponível no próprio Nex em `http://localhost:5080/workbench.html`.

