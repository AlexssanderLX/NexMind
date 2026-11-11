# IA Local — chat com modelos do Ollama

Interface web para conversar com um modelo local (primeiro teste: Qwen3) e medir qualidade, velocidade e consumo.

## Pré-requisitos
- [Ollama](https://ollama.com/download) instalado e em execução
- Um modelo baixado, ex.: `ollama pull qwen3:8b` (ou `qwen3:4b`, que cabe inteiro em 6 GB de VRAM)
- Node 22+ e .NET SDK 10

## Executar
```powershell
.\start.ps1      # compila o frontend e inicia o backend em http://localhost:5080
```
Desenvolvimento com hot reload: `dotnet run` em `backend/` e `npm run dev` em `frontend/` (http://localhost:5173).

## Estrutura
- `backend/Llm/` — **LLM**: comunicação com o Ollama (único lugar que conhece a API dele). O modelo é só um parâmetro.
- `backend/Storage/` — conversas em `backend/data/conversations/*.json`.
- `backend/Metrics/` — CPU, RAM, RAM do Ollama e GPU/VRAM (via `nvidia-smi`).
- `frontend/` — React + TypeScript + Tailwind.
- **MCPs** e **Regras/políticas**: ainda não implementados (reservados para etapas futuras).

## Configurações (painel no app)
Modelo (qualquer um do Ollama), contexto (`num_ctx`), raciocínio (thinking) e prompt de sistema. Ficam salvas no navegador.
A URL do Ollama está em `backend/appsettings.json`.

## Barra de consumo
CPU, RAM, GPU e VRAM da máquina, RAM usada pelo Ollama e quanto do modelo carregado está na GPU
(abaixo de 100% = parte rodando na CPU, mais lento). Cada resposta mostra tokens/s e tempos.
