@echo off
rem Nex V2 (Fase 1): sobe o backend FastAPI na porta 5080 (so local). Feche esta janela para parar.
rem Antes, feche o Nex em C# (a porta 5080 e de um so).
cd /d "%~dp0"
venv\Scripts\python.exe -X utf8 main.py
