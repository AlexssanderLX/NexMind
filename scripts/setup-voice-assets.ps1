# Instala o Piper (voz) e o modelo da voz na pasta comum a todas as pastas de trabalho do Nex: %LOCALAPPDATA%\nex\voice
# O Piper e o modelo pesam ~100 MB e ficam fora do git; o backend os procura nessa pasta quando o caminho do appsettings.json
# não existe (ver backend/voice/VoiceAssets.cs). Sem eles o Nex fala com a voz do Windows.
# A fala e o reconhecimento rodam na CPU: nada disso usa a VRAM do Qwen.
#
# Uso: .\scripts\setup-voice-assets.ps1 [-Source <pasta com bin\piper e models>] [-Force]
param([string]$Source, [switch]$Force)

$dest = Join-Path $env:LOCALAPPDATA "nex\voice"
$root = Split-Path $PSScriptRoot -Parent

function Test-Source($dir) {
    return $dir -and (Test-Path (Join-Path $dir "bin\piper\piper.exe")) -and (@(Get-ChildItem (Join-Path $dir "models") -Filter *.onnx -ErrorAction SilentlyContinue).Count -gt 0)
}

$pronto = (Test-Path (Join-Path $dest "piper\piper.exe")) -and (@(Get-ChildItem (Join-Path $dest "models") -Filter *.onnx -ErrorAction SilentlyContinue).Count -gt 0)
if ($pronto -and -not $Force) {
    Write-Host "Piper e voz já instalados em $dest. Nada a fazer (use -Force para copiar de novo)." -ForegroundColor Green
} else {
    # onde procurar os arquivos: o que o usuário passou, esta pasta, a pasta principal do repositório (git) e a pasta de uso
    $candidatos = @($Source, (Join-Path $root "backend\voice"))
    $comum = (& git -C $root rev-parse --git-common-dir 2>$null)
    if ($comum) { $candidatos += (Join-Path (Split-Path (Resolve-Path (Join-Path $root $comum)).Path -Parent) "backend\voice") }
    $candidatos += (Join-Path (Split-Path $root -Parent) "NexMind\backend\voice")
    $origem = $candidatos | Where-Object { Test-Source $_ } | Select-Object -First 1
    if (-not $origem) {
        Write-Host "Não achei o Piper para copiar. Procurei em:" -ForegroundColor Yellow
        $candidatos | Where-Object { $_ } | ForEach-Object { Write-Host "  $_" }
        Write-Host "Baixe o Piper (windows_amd64) e a voz pt_BR-faber-medium e rode de novo com -Source <pasta com bin\piper e models>." -ForegroundColor Yellow
        Write-Host "Sem o Piper o Nex segue falando com a voz do Windows." -ForegroundColor Yellow
        exit 1
    }
    Write-Host "Copiando de $origem para $dest ..." -ForegroundColor Cyan
    New-Item -ItemType Directory -Force -Path (Join-Path $dest "piper"), (Join-Path $dest "models") | Out-Null
    Copy-Item (Join-Path $origem "bin\piper\*") (Join-Path $dest "piper") -Recurse -Force
    Copy-Item (Join-Path $origem "models\*") (Join-Path $dest "models") -Recurse -Force
    Write-Host "Piper e voz instalados em $dest." -ForegroundColor Green
}

# O reconhecimento de voz (faster-whisper) usa o Python do sistema
$py = & python -c "import faster_whisper; print(faster_whisper.__version__)" 2>$null
if ($py) { Write-Host "faster-whisper $py encontrado." -ForegroundColor Green }
else { Write-Host "faster-whisper não encontrado: rode  pip install -r backend\voice\requirements.txt" -ForegroundColor Yellow }
