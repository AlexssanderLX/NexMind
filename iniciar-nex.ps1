# Inicia tudo do Nex: Ollama (se não estiver rodando), backend e abre o navegador.
# Feche esta janela para parar o Nex. O Ollama continua em segundo plano.
param([switch]$NoBrowser)

$root = $PSScriptRoot
$url = "http://localhost:5080"
$Host.UI.RawUI.WindowTitle = "Nex (feche esta janela para parar)"

function Log($m) { Write-Host ("[{0:HH:mm:ss}] {1}" -f (Get-Date), $m) }

# curl.exe vem com o Windows e é bem mais rápido que Invoke-WebRequest para checar se algo responde
function Test-Url($u) { curl.exe -s -m 2 -o NUL $u; return ($LASTEXITCODE -eq 0) }

function Stop-WithError($msg) {
    Write-Host $msg -ForegroundColor Red
    Read-Host "Enter para fechar"
    exit 1
}

# 1. Ollama: dispara e segue em frente (o backend lida com ele ainda subindo)
if (-not (Test-Url "http://localhost:11434/api/version")) {
    Log "Iniciando o Ollama em segundo plano..."
    # Perfil econômico para GPU pequena (só vale para o Ollama iniciado por aqui):
    $env:OLLAMA_FLASH_ATTENTION = "1"     # atenção otimizada: usa menos VRAM
    $env:OLLAMA_KV_CACHE_TYPE = "q8_0"    # cache de contexto na metade do tamanho
    $env:OLLAMA_MAX_LOADED_MODELS = "1"   # um modelo na VRAM por vez
    $env:OLLAMA_NUM_PARALLEL = "1"        # sem requisições paralelas (cada uma multiplicaria o cache de contexto)
    $ollama = (Get-Command ollama -ErrorAction SilentlyContinue).Source
    if (-not $ollama) { $ollama = "$env:LOCALAPPDATA\Programs\Ollama\ollama.exe" }
    if (-not (Test-Path $ollama)) { Stop-WithError "Ollama não encontrado. Instale em https://ollama.com/download" }
    Start-Process $ollama -ArgumentList "serve" -WindowStyle Hidden
}

# 2. Frontend: recompila quando a tela mudou. O atalho antigo só fazia isso na primeira vez,
# então a janela continuava mostrando a versão anterior.
$index = "$root\backend\wwwroot\index.html"
$newestUi = Get-ChildItem "$root\frontend\src","$root\frontend\index.html" -Recurse -File -ErrorAction SilentlyContinue |
    Sort-Object LastWriteTime -Descending | Select-Object -First 1
if (-not (Test-Path $index) -or ($newestUi -and $newestUi.LastWriteTime -gt (Get-Item $index).LastWriteTime)) {
    Log "Atualizando a tela..."
    Push-Location "$root\frontend"
    if (-not (Test-Path node_modules)) { npm install }
    npm run build
    if ($LASTEXITCODE -ne 0) { Stop-WithError "Falha ao compilar a tela." }
    Pop-Location
}

# 3. Já está rodando? A tela nova já foi gravada; abre o navegador.
if (Test-Url "$url/api/status") {
    Log "O Nex já está rodando em $url. Se a tela não mudou, feche a janela do Nex e abra de novo, depois atualize com Ctrl+F5."
    if (-not $NoBrowser) { Start-Process $url }
    exit 0
}

# 4. Backend: recompila só se o código mudou desde a última compilação (evita o custo do `dotnet run`)
$dll = "$root\backend\bin\Release\net10.0\LocalAi.Api.dll"
$newest = Get-ChildItem "$root\backend" -Recurse -File -Include *.cs, *.csproj, appsettings*.json |
    Where-Object { $_.FullName -notmatch '\\(bin|obj)\\' } |
    Sort-Object LastWriteTime -Descending | Select-Object -First 1
if (-not (Test-Path $dll) -or $newest.LastWriteTime -gt (Get-Item $dll).LastWriteTime) {
    Log "Compilando o backend..."
    dotnet build "$root\backend" -c Release -nologo -v q
    if ($LASTEXITCODE -ne 0) { Stop-WithError "Falha ao compilar o backend. Confira se o .NET SDK 10 está instalado (dotnet --list-sdks)." }
    (Get-Item $dll).LastWriteTime = Get-Date
}

# 5. Abre o navegador assim que o backend responder
if (-not $NoBrowser) {
    Start-Job -ArgumentList $url -ScriptBlock {
        param($u)
        for ($i = 0; $i -lt 150; $i++) {
            curl.exe -s -m 1 -o NUL "$u/api/status"
            if ($LASTEXITCODE -eq 0) { Start-Process $u; break }
            Start-Sleep -Milliseconds 200
        }
    } | Out-Null
}

# 6. Backend em primeiro plano (fechar a janela encerra)
Log "Iniciando o backend em $url — feche esta janela para parar."
Push-Location "$root\backend"
dotnet $dll
Pop-Location
