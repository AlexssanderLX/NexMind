# Invariantes Globais e Constituição do Nex

## 1. Visão do Produto
O **Nex** é um ambiente de chat e orquestração de IA local autônomo, desenhado para:
- Rodar em hardware de consumo (ex: 6 GB a 16 GB de VRAM) com máxima eficiência.
- Utilizar o Ollama como runtime de inferência de modelos abertos.
- Expandir as capacidades do LLM através de **MCPs próprios** (Model Context Protocol).
- Oferecer interface elegante e ultraleve inspirada no Claude.

## 2. Princípios de Engenharia Inegociáveis
1. **Autoridade do Backend:** Toda orquestração de chamadas ao Ollama, execução de ferramentas e acesso ao sistema operacional é controlada pelo backend ASP.NET Core. O frontend é uma camada de visualização reativa.
2. **Economia Rígida de Recursos:**
   - O **núcleo 3D é permitido** na interface com perfis de desempenho (*Máximo*, *Equilibrado* e *Leve*) e suporte a queda graciosa para 2D. Medições comprovam zero impacto nos tokens/segundo do Ollama quando executado dentro desses perfis.
   - Aplicar throttling no streaming de tokens (lotes de 150-700 ms) para não degradar o renderizador da interface.
   - Leitura de métricas via `nvml.dll` direto na memória do driver em vez de spawns frequentes de processos de CLI (`nvidia-smi`).
3. **Persistência Segura:** Toda gravação de histórico de conversa deve utilizar padrão atômico (escrita em arquivo temporário com `File.Replace`) para evitar arquivos corrompidos se o app for fechado durante a escrita.
4. **Respeito aos Contratos:** Não alterar schemas de dados das conversas salvas em `backend/data/conversations/` sem migração retrocompatível garantida.

