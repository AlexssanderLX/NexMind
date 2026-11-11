# Regras de Eficiência para Agentes Executores

## 1. Princípios de Execução
- **Escopo Estrito:** O executor deve ater-se rigorosamente aos arquivos e objetivos listados no Handoff. Modificações fora do escopo serão rejeitadas pelo auditor.
- **Não Destruir Comentários Existentes:** Manter documentação existente e regras de negócio já validadas.
- **Zero Over-engineering:** Escrever apenas o código necessário para cumprir o contrato do Handoff. Não criar camadas de abstração genéricas ou prematuras.
- **Verificação Local Obrigatória Antes da Entrega:**
  1. `dotnet build` deve rodar com 0 erros.
  2. Testes unitários/de integração devem passar em 100% verde.
  3. Preencher o handoff de volta com os arquivos tocados e status de validação.

