# Regras de Arquitetura e Limites de Módulos

## 1. Topologia de Camadas
```text
[Frontend: React 19 + TypeScript + Tailwind]
                     │
            HTTP SSE / WebSocket
                     ▼
[Backend: ASP.NET Core Minimal APIs (.NET 10)]
  ├── Program.cs           # Ponto de entrada, injeção de dependências e roteamento
  ├── Llm/                 # Comunicação isolada com Ollama (único módulo que conhece /api/chat)
  ├── Mcp/                 # Orquestração do Model Context Protocol (clientes JSON-RPC stdio/SSE)
  ├── Tools/               # Ferramentas nativas do assistente
  ├── Storage/             # Gerenciamento de conversas em disco (com índice em memória)
  ├── Metrics/             # Leitura direta de GPU/NVML, CPU e memória
  └── voice/               # Síntese e reconhecimento de voz (Speech)
```

## 2. Invariantes Arquiteturais
- **Isolamento de LLM:** Nenhuma camada fora de `backend/Llm/` pode fazer requisições diretas ao Ollama ou manipular payloads brutos da API de inferência.
- **Isolamento de MCP:** Servidores MCP externos devem ser gerenciados através do ciclo de vida formal (processos em sandbox, timeouts em chamadas `tools/call`, sanitização de argumentos).
- **Sem Quebras de Build:** Qualquer adição de código deve compilar com 0 erros (`dotnet build` e `npm run build`).
- **Renderização e Núcleo 3D:** O núcleo 3D (visualizador) é permitido no frontend e deve operar sob perfis de desempenho ajustáveis (Máximo, Equilibrado, Leve) com capacidade de queda graciosa para Canvas 2D, comprovadamente sem impactar os tok/s do Ollama.


