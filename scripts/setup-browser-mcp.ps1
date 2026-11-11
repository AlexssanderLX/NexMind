# Cria o venv do navegador, instala o MCP/Playwright e baixa o Chromium.
# O Python global não é alterado. A pasta do venv fica fora do git.
$ErrorActionPreference = "Stop"
$root = Split-Path $PSScriptRoot -Parent
$venv = Join-Path $root "backend\data\mcp\browser\venv"
$python = Join-Path $venv "Scripts\python.exe"
$req = Join-Path $root "backend\Mcp\requirements-browser.txt"

if (-not (Get-Command python -ErrorAction SilentlyContinue)) {
    Write-Error "Python não encontrado no PATH."
}

if (-not (Test-Path $python)) {
    Write-Host "Criando venv em $venv"
    python -m venv $venv
}

Write-Host "Instalando dependências..."
& $python -m pip install --upgrade pip
& $python -m pip install -r $req
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }

Write-Host "Baixando o Chromium do Playwright..."
& $python -m playwright install chromium
exit $LASTEXITCODE
