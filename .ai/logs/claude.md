# Claude Work Log

> **Agent:** Claude (Builder / Foundation & Architecture)  
> **Repository:** Nex Mind / Local AI Assistant (`ia-local`)  
> **Purpose:** Append-only log tracking commits e entregas autoradas pelo Claude Code.

| Date (UTC) | Task | Commit | Scope / Description | Handoff Manifest |
|---|---|---|---|---|
| 2026-11-11 | TASK-CLEAN-BUILD-INFO | `5c376a3` | Remoção do `tsconfig.tsbuildinfo` gerado e adição às regras do `.gitignore` | N/A |
| 2026-11-11 | TASK-VOICE-RUNTIME-PORT | `a726246` | Voz: Piper e modelo achados em `%LOCALAPPDATA%\nex\voice` (`VoiceAssets`), `scripts/setup-voice-assets.ps1`, plano B para a voz do Windows no `useVoice`; STT/TTS na CPU (0 MiB de GPU medido por processo) | N/A |
| 2026-11-11 | TASK-VOICE-RUNTIME-PORT (correção do hash) | `cfae081` | O commit `a726246` da linha anterior foi refeito por rebase sobre o `develop`; o hash real que está no histórico é `cfae081` | N/A |
| 2026-11-12 | TASK-019 / TASK-020 / TASK-021 / TASK-022 | `42c5090` | Sprint: Micro Apps Geral/Security (Sidebar, atalho `/workbench.html`, `SecurityTaskPanel`), ferramentas desligadas no cold start, contexto adaptativo e ferramentas sob demanda decididos no backend (`IntentRouter`, `ContextPlanner`, bloco de planejamento no thinking), pílula de tarefa action-first (`TaskThinkingPill`) e persona sênior com ciclo de 2 tempos | `.ai/handoffs/TASK-MICRO-APP-SECURITY-UI-019.yaml`, `TASK-ADAPTIVE-CONTEXT-AND-TOOLS-ON-DEMAND-020.yaml`, `TASK-UX-ACTION-FIRST-CONTEXTUAL-THINKING-021.yaml`, `TASK-NEX-PERSONA-TWO-PHASE-EXECUTION-022.yaml` |
| 2026-11-12 | TASK-SECURITY-MICRO-AGENT-MODAL-023 | `e694e6e` | Nex Security V1: prompt de domínio do modo Security (`composeSystem`), barra dos 6 estágios em largura total, botão do robô arrastável e janela de micro-chat dos 5 subagentes (`SecurityAgentsLayer`, `SubagentChat`), micro-RAG sob demanda em `security/*.md` (`SecurityNotes`, `SecurityIntent`: o Nex principal só lê quando perguntado), teste ponta a ponta em memória com o Ollama real (`tests/SecurityE2E`) e correção do ciclo de 2 tempos fora do uso de ferramentas | `.ai/handoffs/TASK-SECURITY-MICRO-AGENT-MODAL-023.yaml` |
