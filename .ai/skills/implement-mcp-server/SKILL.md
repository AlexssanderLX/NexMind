---
name: implement-mcp-server
description: Procedimento padrão para plugar novos servidores MCP open-source e registrar suas ferramentas com controle de aprovação.
---

# Skill: Implementar e Registrar Servidor MCP

Procedimento para cadastrar e validar qualquer servidor MCP (Model Context Protocol) no ecossistema Nex.

## 1. Cadastro no `mcp_servers.json`
Localizado na raiz do backend (`backend/mcp_servers.json`):
```json
{
  "mcpServers": {
    "filesystem": {
      "command": "npx",
      "args": ["-y", "@modelcontextprotocol/server-filesystem", "C:\\Users\\Alexssander"],
      "requiresApproval": ["write_file", "edit_file", "create_directory", "move_file"]
    },
    "terminal": {
      "command": "python",
      "args": ["-m", "meu_mcp_cli"],
      "requiresApproval": ["*"]
    }
  }
}
```

## 2. Invariantes de Execução
- **Transações Seguras:** Ferramentas que alteram estado, criam arquivos ou rodam comandos devem estar listadas em `requiresApproval`.
- **Tratamento de Timeout:** Toda chamada a ferramentas de MCP via `tools/call` deve ter um `CancellationToken` de 30 segundos.
- **Validação de Saída:** O payload devolvido ao Ollama deve ser sanitizado e truncado para evitar estouro de tokens de contexto.

