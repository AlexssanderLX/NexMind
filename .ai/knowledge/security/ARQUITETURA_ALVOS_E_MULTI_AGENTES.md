# Especificação Técnica: Motor de Alvos Autorizados e Orquestração Multi-Agente

## 1. Modelo de Dados de Escopo e Alvos Autorizados

Toda sessão do Micro App Security gera um arquivo `scope.json` em `backend/data/security_sessions/<id>/`:

```json
{
  "sessionId": "sec-20261111-001",
  "name": "Auditoria Juice Shop Lab",
  "type": "local_lab", // "local_lab" ou "authorized_bounty"
  "target": {
    "baseUrl": "http://localhost:3000",
    "allowedHosts": ["localhost", "127.0.0.1"],
    "allowedPrefixes": ["/api/", "/rest/"],
    "deniedPrefixes": ["/logout", "/shutdown", "/admin/reset-db"],
    "maxRequestsPerSecond": 3
  },
  "accounts": {
    "attacker": {
      "label": "Conta A (Pesquisador)",
      "token": "Bearer eyJhbGciOi...",
      "tenantId": "1001",
      "userId": "user-a"
    },
    "victim": {
      "label": "Conta B (Segunda Conta Própria)",
      "token": "Bearer eyJhbGciOi...",
      "tenantId": "1002",
      "userId": "user-b"
    }
  },
  "rulesOfEngagement": {
    "allowDestructive": false,
    "requireHumanConfirmationForWrite": true,
    "maxPayloadSizeKb": 64
  }
}
```

---

## 2. Guardrails Inegociáveis do Scope Gatekeeper

Antes de qualquer chamada HTTP (via curl, fetch ou DevTools) ser disparada por qualquer agente:

1. **Host Check:** A URL de destino DEVE casar estritamente com `allowedHosts`. Destinos externos (inclusive CDNs de terceiros ou serviços analíticos) são bloqueados por padrão.
2. **Denylist Check:** Se a rota contiver qualquer prefixo da lista `deniedPrefixes`, a ação é cancelada com log de bloqueio.
3. **Write / Delete Approval:** Qualquer método HTTP `POST`, `PUT`, `PATCH` ou `DELETE` requer aprovação visual no chat através do `ApprovalBroker` do Nex.
4. **Single-Variable Mutation:** Modificar somente um parâmetro por requisição para isolar a causa raiz do comportamento da aplicação.

---

## 3. O Quadro de Sessão Compartilhado (`board.json`)

Para que os subagentes operem sem colisão de tarefas:

```json
{
  "endpoints": [
    {
      "id": "ep-1",
      "path": "/api/BasketItems/5",
      "method": "GET",
      "authRequired": true,
      "discoveredBy": "recon-agent",
      "hypothesesCount": 1
    }
  ],
  "tasks": [
    {
      "id": "tsk-101",
      "endpointId": "ep-1",
      "wstgId": "WSTG-ATHZ-04",
      "assignedTo": "auth-agent",
      "stage": 3,
      "status": "in_progress",
      "detail": "Testando BOLA trocando ID 5 (Conta B) usando Token da Conta A"
    }
  ],
  "findings": [
    {
      "id": "find-01",
      "wstgId": "WSTG-ATHZ-04",
      "title": "BOLA no BasketItems",
      "severity": "P1",
      "status": "confirmed",
      "evidence": "Acesso a itens do carrinho do usuário B comprovado com sessão de A",
      "remediation": "Validar `basket.userId == session.userId` no controlador"
    }
  ]
}
```

---

## 4. Comunicação e Divisão de Papéis dos Subagentes

```
[ Nex Lead Orchestrator ]
       ▲
       │  Emite Tasks & Lê Findings
       ▼
[ Shared Session Board ]
   ├── recon-agent  ➔ Extrai rotas, formulários e JS da tela ativa
   ├── auth-agent   ➔ Testa autorização cruzada com Conta A e Conta B
   ├── input-agent  ➔ Testa injeção e sanitização com marcadores benignos
   └── verify-agent ➔ Revalida o teste para eliminar falsos positivos
```

- **Recon Agent:** Não faz ataques. Apenas mapeia o que a tela expõe (DOM, scripts, chamadas de rede passivas).
- **Auth Agent:** Especialista em quebra de controle de acesso (BOLA, BFLA). Testa se a Conta A acessa dados da Conta B.
- **Input Agent:** Especialista em validação de entrada (XSS, SSRF, SQLi). Usa marcadores alfanuméricos inofensivos (`WSTG_TEST_<hash>`).
- **Verify Agent:** Atua como filtro crítico: se o servidor retornou 200, ele verifica se houve vazamento real ou se foi um erro silencioso com status 200.

