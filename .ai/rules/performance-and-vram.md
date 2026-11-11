# Regras de Desempenho, VRAM e Gestão de Contexto

## 1. Métricas Medidas em Hardware Real (RTX 3050 6 GB / 16 GB RAM)

Os limites práticos de offload e taxa de geração (tok/s) observados em benchmarks no Ollama (Qwen 4B / Qwen 8B):

| Janela de Contexto | Alocação de Camadas | Desempenho Médio |
|---|---|---|
| **4.096 a 8.192 tokens** | **100% na GPU (VRAM)** | **~41 a 42 tok/s** (fluidez máxima) |
| **16.384 tokens** | 24 na GPU / 12 na RAM | ~25 a 41 tok/s |
| **32.768 tokens** | **~36% na CPU (RAM)** / 64% na VRAM | **~14 tok/s** (latência perceptível) |

## 2. Invariantes Operacionais

1. **Contexto Dinâmico Escolhido por Mensagem:**
   - O tamanho de contexto (`num_ctx`) não é fixo; ele é selecionado dinamicamente por mensagem (4k, 8k, 16k ou 32k) dependendo da complexidade da tarefa ou do tamanho dos anexos.
   - Tarefas corriqueiras devem priorizar 4k/8k para manter 100% do modelo na GPU e taxa acima de 40 tok/s.

2. **Prevenção de Recarga do Modelo (`OLLAMA_KEEP_ALIVE=60m`):**
   - O Ollama deve ser iniciado ou configurado com `OLLAMA_KEEP_ALIVE=60m`. Isso mantém o modelo ancorado na VRAM durante pausas de trabalho e evita o custo de 4 a 9 segundos de recarga a cada nova mensagem.

3. **Concisão e Foco (`BasePrompt` em `Program.cs`):**
   - O prompt base do sistema impõe respostas diretas e curtas por padrão. Respostas prolixas saturam a VRAM desnecessariamente e aumentam o tempo de streaming.

4. **Perfil Econômico do Ollama:**
   - `OLLAMA_FLASH_ATTENTION=1`
   - `OLLAMA_KV_CACHE_TYPE=q8_0`
   - `OLLAMA_MAX_LOADED_MODELS=1`
   - `OLLAMA_NUM_PARALLEL=1` (evita multiplicar o cache de contexto na VRAM).
