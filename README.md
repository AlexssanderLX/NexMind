# Nex — chat com modelos locais do Ollama

Interface web local para conversar com um modelo rodando no seu computador (primeiro teste: Qwen3) e medir
qualidade, velocidade e consumo de recursos. O visual segue o app de chat do Claude.

## Pré-requisitos
- [Ollama](https://ollama.com/download) instalado e em execução
- Um modelo baixado, ex.: `ollama pull qwen3:4b` (cabe inteiro em 6 GB de VRAM) ou `qwen3:8b`
- Node 22+ e .NET SDK 10

## Executar
**Atalho na Área de Trabalho (recomendado):** rode uma vez `.\criar-atalho.ps1` para criar o atalho **Nex**. Um clique
inicia o Ollama (se estiver parado), o backend e abre http://localhost:5080. Feche a janela do Nex (abre minimizada) para
parar; o Ollama continua em segundo plano. Se mover a pasta do projeto, rode `criar-atalho.ps1` de novo.
Partida típica: ~4 s com o Ollama já aberto, ~9 s com o Ollama parado. O backend só é recompilado quando o código muda.

Alternativa manual:
```powershell
.\start.ps1      # compila o frontend e inicia o backend em http://localhost:5080
```
Desenvolvimento com hot reload: `dotnet run` em `backend/` e `npm run dev` em `frontend/` (http://localhost:5173).

## Estrutura
- `backend/Llm/` — **LLM**: comunicação com o Ollama (único lugar que conhece a API dele). O modelo é só um parâmetro.
- `backend/Storage/` — conversas em `backend/data/conversations/*.json`.
- `backend/Metrics/` — CPU, RAM, RAM do Ollama e GPU/VRAM (via `nvidia-smi`).
- `frontend/` — React + TypeScript + Tailwind. Respostas renderizam markdown e fórmulas matemáticas (KaTeX; aceita `$..$`, `$$..$$`, `\(..\)` e `\[..\]`).
- **MCPs** e **Regras/políticas**: ainda não implementados (reservados para etapas futuras).

## Desenvolvimento e governança
Regras de branches, fluxo de integração, retorno à versão funcional, papéis dos agentes e contratos entre módulos:
[`docs/GOVERNANCA.md`](docs/GOVERNANCA.md), [`docs/AGENTES.md`](docs/AGENTES.md) e
[`docs/ARQUITETURA.md`](docs/ARQUITETURA.md). Nada entra na `main` sem autorização do dono do projeto.

## Desempenho
Medido nesta máquina (RTX 3050 6 GB, 16 GB RAM), antes → depois:
- **Streaming na tela**: tokens em lotes de 150–700 ms. Uma resposta de 3000 caracteres custava ~72% de um núcleo só
  para reprocessar markdown e fórmulas a cada token; agora ~7–15%. Teste real: 520 tokens, 55 atualizações de tela
  (antes ~520) e nenhuma tarefa longa (>50 ms).
- **Consumo da GPU**: lido pela NVML (`nvml.dll`, do driver) em vez de abrir o `nvidia-smi` (~102 ms) a cada consulta.
  CPU do backend por rodada de consultas: 88,7 → 36,3 ms (mesma máquina, mesmo roteiro). O `nvidia-smi` só entra como
  plano B, no máximo a cada 5 s.
- **Lista de conversas**: índice em memória. Com 150 conversas (14 MB) caiu de ~1 s para ~30 ms por chamada.
  Salvamento via arquivo temporário (fechar o app no meio não corrompe a conversa).
- **Consultas da tela**: status e consumo a cada 10 s (1,5 s só com o modal aberto) e pausam com a aba escondida.
- **Perfil econômico do Ollama** (aplicado pelo `iniciar-nex.ps1` quando ele inicia o Ollama): `OLLAMA_FLASH_ATTENTION=1`,
  `OLLAMA_KV_CACHE_TYPE=q8_0`, `OLLAMA_MAX_LOADED_MODELS=1`, `OLLAMA_NUM_PARALLEL=1`.

  | Contexto | Antes | Depois |
  |---|---|---|
  | 4.096 | 3.033 MB na VRAM, 42,7 tok/s | 2.766 MB, ~42 tok/s |
  | 16.384 | 4.072 de 5.142 MB (79% na GPU), 25,3 tok/s | 3.719 MB (100% na GPU), 41,4 tok/s |

  Com `NUM_PARALLEL=1` pedidos simultâneos entram em fila (a VRAM não comporta o cache de contexto multiplicado). Se o
  Ollama já estiver aberto (ex.: iniciado com o Windows), o perfil não é aplicado: feche-o e abra pelo atalho, ou
  defina essas variáveis de ambiente do usuário. O cache `q8_0` quase não afeta a qualidade, mas não foi avaliado aqui.

## Interface
- **Consumo do sistema**: a bolinha no canto superior direito (cor = maior uso entre CPU, RAM, GPU e VRAM) abre um
  modal com os detalhes. Fica fora da tela o resto do tempo.
- **Sidebar minimizável** (a escolha fica salva no navegador).
- **Fundo animado**: esfera 3D de nós em Canvas 2D, de propósito sem WebGL para não disputar a GPU com o modelo
  (~0,7 ms por quadro, 30 fps, pausa com a aba escondida, acelera quando o Nex responde). Dá para desligar em
  Configurações.

## Modos: Conversa e Raciocínio
O botão **✦ Raciocínio** no campo de texto escolhe qual modelo responde a próxima mensagem:
- **Conversa** (padrão): `qwen3:4b-instruct`, rápido e direto (`ollama pull qwen3:4b-instruct`).
- **Raciocínio** (botão ligado): `qwen3:4b`, que pensa antes de responder. O raciocínio aparece separado da resposta.

A conversa é a mesma nos dois modos, e cada resposta mostra qual modelo a gerou. Quem decide o modo é você; o Nex ainda
não escolhe sozinho.

## Configurações (painel no app)
Modelo de conversa, modelo de raciocínio (quaisquer do Ollama), contexto (`num_ctx`) e prompt de sistema. Ficam salvas
no navegador. O app avisa quando o modelo do modo atual não está instalado. A URL do Ollama está em `backend/appsettings.json`.

## Barra de consumo
CPU, RAM, GPU e VRAM da máquina, RAM usada pelo Ollama e quanto do modelo carregado está na GPU
(abaixo de 100% = parte rodando na CPU, mais lento). Cada resposta mostra tokens/s e tempos.

## Observação sobre o `qwen3:4b`
A versão atual do `qwen3:4b` no Ollama é a variante que **sempre raciocina**. Ela responde certo, mas gasta muitos
tokens pensando (uma pergunta simples levou ~1.900 tokens, ~50 s a ~41 tok/s). "Raciocínio: Desligado" não a impede de
pensar. Por isso o app usa um modelo instruct separado para o modo Conversa.
