# Regras para Model Context Protocol (MCP)

## 1. O Padrão MCP no Nex
O Nex atua como **MCP Host / Client**. Ele orquestra ferramentas fornecidas por servidores MCP externos para que o LLM local possa acioná-las.

## 2. Invariantes do Protocolo
1. **SDK Oficial Obrigatório (Proibido JSON-RPC à Mão):**
   - É estritamente **proibido** escrever clientes JSON-RPC manuais ou parsers ad-hoc de protocolo.
   - O backend deve obrigatoriamente consumir o SDK oficial `ModelContextProtocol` da comunidade/Anthropic para gerenciar a comunicação stdio e sessões.
   - Servidores de referência: utilizar pacotes oficiais e validados open source.
2. **Leitor de Arquivos Padrão:**
   - O leitor de arquivos oficial do Nex utiliza `markitdown-mcp` versão `0.0.1a4` com `mcp==1.30.0` fixados (ver `backend/Mcp/requirements-markitdown.txt`), garantindo compatibilidade com o SDK C#.
   - Ambiente virtual isolado em `backend/data/mcp/markitdown/venv` (ignorado pelo git).
3. **Ciclo de Vida Formal:**
   - **Handshake:** Envio de `initialize` e `notifications/initialized` mediado pelo SDK.
   - **Descoberta:** Envio de `tools/list` para mapear schemas de parâmetros (JSON Schema).
   - **Execução:** Envio de `tools/call` com nome da tool e dicionário de argumentos.
4. **Mecanismo de Aprovação Prévia (Human-in-the-Loop - HITL):**
   - **Classificação de Risco:** Ferramentas são categorizadas em `Read-Only` (leitura segura) e `Mutating/Destructive` (escrita de arquivos, execução de comandos CLI, exclusão).
   - **Bloqueio Mandatório:** Nenhuma ação `Mutating/Destructive` pode ser despachada para o MCP sem o consentimento explícito do usuário via interface.
   - **Fluxo de Intercepção:** O backend suspende a execução da tool call, envia o payload de aprovação para o frontend e aguarda o sinal de autorização do usuário antes de repassar para o processo MCP.
5. **Resiliência e Segurança:**
   - **Timeouts Obrigatórios:** Timeout padrão de 15 a 30 segundos por chamada.
   - **Truncamento de Respostas:** Saídas de terminal ou arquivos lidos devem ser truncados em limites seguros para não saturar a VRAM/janela de contexto do Ollama.

