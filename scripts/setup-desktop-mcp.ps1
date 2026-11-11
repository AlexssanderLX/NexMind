# Provisiona o ambiente Python isolado do servidor MCP "desktop" (Computer Use no Windows).
# Nada é instalado no Python global: tudo vai para backend\data\mcp\desktop\venv (fora do git).
# Uso:  powershell -ExecutionPolicy Bypass -File scripts\setup-desktop-mcp.ps1 [-Python py]
param([string]$Python = "python")
$ErrorActionPreference = "Stop"

$root = Split-Path -Parent $PSScriptRoot
$venv = Join-Path $root "backend\data\mcp\desktop\venv"
$req  = Join-Path $root "backend\Mcp\requirements-desktop.txt"
$py   = Join-Path $venv "Scripts\python.exe"

if (-not (Test-Path $py)) {
    Write-Host "Criando ambiente virtual em $venv"
    New-Item -ItemType Directory -Force (Split-Path -Parent $venv) | Out-Null
    & $Python -m venv $venv
    if ($LASTEXITCODE -ne 0) { throw "Falha ao criar o venv (Python $Python encontrado?)." }
}

Write-Host "Instalando dependências de $req"
& $py -m pip install --disable-pip-version-check -q -r $req
if ($LASTEXITCODE -ne 0) { throw "Falha ao instalar as dependências." }

& $py -c "import mcp, pyautogui, pywinauto, PIL; print('OK: mcp', mcp.__name__, '| pyautogui', pyautogui.__version__)"
if ($LASTEXITCODE -ne 0) { throw "Dependências instaladas, mas a importação falhou." }
Write-Host "Pronto. Servidor: backend\Mcp\Desktop\server.py"
