# feature/nex-core-3d

- **Agente:** Frontend
- **Objetivo:** núcleo neural 3D interativo (esfera de partículas e conexões) como elemento central da interface, com estados, áudio, painéis flutuantes e perfis gráficos.
- **Depende de:** nada. A branch de voz (`feature/voice-integration`) depende desta (importa `core/events.ts`).
- **Base:** `main` em `5b60e71` (tag `stable/2026-11-10-otimizacao`).

## Arquivos

| Arquivo | Ação | Compartilhado? |
|---|---|---|
| `frontend/package.json`, `package-lock.json` | modificado | sim: só adiciona `three` e `@types/three` |
| `frontend/src/core/events.ts` | criado | contrato `nex:state` / `nex:audio-level` |
| `frontend/src/core/profiles.ts` | criado | perfis Máximo / Equilibrado / Leve |
| `frontend/src/core/palettes.ts` | criado | 5 paletas; a cor de destaque do app acompanha |
| `frontend/src/core/audio.ts` | criado | microfone real (Web Audio) e áudio de demonstração |
| `frontend/src/core/shaders.ts`, `scene.ts` | criados | cena Three.js, animação 100% na GPU |
| `frontend/src/core/NeuralCore.tsx` | criado | componente React, ponteiro, clique, toque |
| `frontend/src/hooks/useNexCore.ts` | criado | estado do núcleo, microfone, demo, painéis |
| `frontend/src/components/NexStage.tsx`, `CoreSettings.tsx`, `PerfHud.tsx` | criados | palco, configurações, medidor de FPS |
| `frontend/src/components/panels/FloatingPanel.tsx`, `PanelsLayer.tsx` | criados | painéis reutilizáveis |
| `frontend/src/App.tsx` | modificado | **sim**: liga `useNexCore`/`NexStage`; troca o fundo 2D por plano B; cabeçalho responsivo |
| `frontend/src/components/SettingsPanel.tsx` | modificado | **sim**: prop `core` e `<CoreSettings>` |
| `frontend/src/components/MessageView.tsx` | modificado | `data-no-core` nas mensagens |

## Commits

- `1eb1f18` chore(frontend): adiciona three
- `ada0d18` wip(core): contrato de eventos, perfis, áudio, shaders e cena 3D
- `0ec68f8` feat(frontend): núcleo neural 3D integrado

## Comportamento entregue

- Esfera **centralizada na área de conteúdo** (não conta a sidebar), 150–500 px conforme o espaço; encolhe em telas estreitas.
- **Segue o cursor só dentro da própria área** (perde o movimento sobre sidebar, cabeçalho e campo de texto): inclinação leve e protuberância local do lado voltado ao cursor, limitada para nunca passar da borda. Intensidade ajustável em Configurações.
- **Clique troca a cor** (5 paletas, transição suave, cor do app acompanha, salva no navegador). Clique em botões, campos e mensagens não aciona nada.
- **7 estados**: repouso, ouvindo, pensando, falando, ferramenta, sucesso, erro. Reais hoje: *pensando* (resposta em andamento), *sucesso/erro* (fim da resposta), *ouvindo* (microfone).
- **Microfone por botão próprio** (só visualização, sem transcrição nesta branch); pede permissão só depois do clique.
- **Modo demonstrativo** com selo "DEMONSTRAÇÃO" e áudio sintético, para testar estados sem voz real.
- **Painéis** Atividade, Ferramentas, Execuções (dados reais; ferramentas vazio, com exemplos só no modo demo).
- **Perfis** Máximo (padrão) / Equilibrado / Leve; medidor de FPS opcional. Fundo 2D antigo só entra se o WebGL falhar.

## Testes executados (resultado real, painel do app, RTX 3050 via ANGLE/D3D11, tela de 100 Hz, canvas 1224×505)

| Teste | Resultado |
|---|---|
| `tsc --noEmit` e `vite build` | passam |
| Geometria: centro do canvas = centro da área de conteúdo | ok (668 px = 668 px) |
| Seguir o cursor, hover, cursor "mão", voltar ao repouso | ok (inclinação e protuberância seguem; zeram sobre a sidebar e o cabeçalho) |
| Esfera não muda de tamanho nem de lugar; ponta cabe na borda | ok (raio constante; sobra 18 px no canvas estreito) |
| 7 estados e áudio de demonstração | ok (pico de áudio 0,56 em "Ouvindo"; 0 nos demais) |
| 3 painéis abrem/fecham | ok (animação, `inert`, `aria-hidden`) |
| Clique troca a cor; fora da esfera e em botão não troca; persiste | ok |
| Erro de microfone negado (`getUserMedia` substituído no teste) | ok (aviso e estado "erro") |
| FPS por perfil, canvas fixo | Máximo 58–60 · Equilibrado 45,0 · Leve 30,0 |
| CPU de JavaScript por quadro | Máximo 0,4–0,5 ms · Equilibrado 0,17 ms · Leve 0,17 ms |
| Velocidade do Ollama (qwen3:4b-instruct, 200 tokens, 3 execuções) | com a UI: Máximo 38,8 (repouso) / 38,7 (mouse) · Equilibrado 39,3 · Leve 38,7 tok/s. **Sem interface (painel em branco): 37,7** (36,2–39,4) |

**Leitura:** nenhuma diferença mensurável na velocidade do modelo (as variações ficam dentro do ruído de ±1,5 tok/s entre execuções). Em outra hora, com a máquina em outro estado, essa mesma conta já deu ~42 tok/s: compare sempre na mesma sessão.

## Bugs achados e corrigidos nesta branch

- Limitador de FPS arredondava para múltiplos do intervalo da tela (60 virava 50 a 100 Hz): trocado por acumulador.
- `z-10` no `<main>` isolava o canvas e deixava um retângulo preto (`mix-blend-mode: screen` não funcionava).
- Canvas 2D antigo continuava existindo em tela cheia mesmo desligado.
- Cabeçalho sobrepunha o botão Configurações em telas estreitas; dock de painéis cortado; esfera maior que o canvas em telas estreitas.
- Esticamento da esfera inteira (formato de ovo) trocado por protuberância local.

## Contratos afetados

Cria `nex:state` e `nex:audio-level` (`core/events.ts`). Nenhum contrato existente mudou.

## Não testado / limitações / simulado

- **Chat com o Ollama pela interface final (enviar mensagem, estados pensando→sucesso)**: não reexecutado depois da integração do núcleo. Testado só a rota da API e a versão anterior da interface.
- **Comparação com a interface antiga (Canvas 2D)**: não executada; o baseline é "sem interface".
- **Microfone real, toque (celular/tablet), `prefers-reduced-motion`, queda para o fundo 2D (WebGL indisponível)**: não testados.
- **Aparência em tela larga**: conferida pelo print do usuário e por capturas em 305–481 px; nenhuma captura em desktop largo por mim.
- Uso de GPU da máquina ficou em 28–38% em todos os perfis e não dá para separar do uso de fundo do Windows.
- **Simulado**: modo demonstrativo (estados forçados, áudio sintético) e ferramentas de exemplo (só no modo demo). **Não existe** voz (STT/TTS) nem ferramentas nesta branch.
- Pacote JavaScript cresceu para 1,26 MB (355 KB comprimido) por causa do `three`.

## Atenção para a integração

Durante o trabalho, o agente de voz passou a editar **arquivos desta mesma pasta de trabalho** (`core/audio.ts`, `hooks/useNexCore.ts`, `backend/Program.cs`, `.csproj`, `appsettings.json`), sem commit. Estas alterações **não fazem parte desta branch**. Antes de integrar, separar os dois trabalhos.

## Como desfazer

`git revert -m 1 <merge>` ou voltar à tag `stable/2026-11-10-otimizacao`. A dependência `three` sai junto com o `package.json`/lock.
