# Sobe o Nex inteiro, do zero e limpo: encerra o que sobrou de execuções anteriores, inicia o Ollama (com o perfil
# econômico de VRAM), espera ele ficar pronto, inicia o Nex e só então abre a tela no navegador.
# Feche esta janela para parar o Nex.
param([switch]$NoBrowser, [switch]$Force, [switch]$DryRun, [int]$Port = 5080)

$root = $PSScriptRoot
$url = "http://localhost:$Port"
$Host.UI.RawUI.WindowTitle = "Nex (feche esta janela para parar)"

function Log($m, $color = "Gray") { Write-Host ("[{0:HH:mm:ss}] {1}" -f (Get-Date), $m) -ForegroundColor $color }

# curl.exe vem com o Windows e é bem mais rápido que Invoke-WebRequest para checar se algo responde
function Test-Url($u) { curl.exe -s -m 2 -o NUL $u; return ($LASTEXITCODE -eq 0) }

function Stop-WithError($msg) {
    Write-Host $msg -ForegroundColor Red
    Read-Host "Enter para fechar"
    exit 1
}

# ---------------------------------------------------------------------------------------------------------------
# Decisão de partida. Este atalho NÃO derruba um Nex que já está de pé e atualizado, e não briga com outro launcher
# que ainda está subindo (dois launchers ao mesmo tempo encerravam os processos um do outro, e a tela abria com
# "o backend não está respondendo").
#   open    -> já existe um Nex saudável e mais novo que o código: só abre a tela
#   wait    -> outro launcher começou há pouco: espera ele terminar em vez de derrubá-lo
#   restart -> caminho de sempre: encerra o que sobrou, sobe o Ollama, compila se precisar e inicia o Nex
# ---------------------------------------------------------------------------------------------------------------
$WaitOtherLauncherSeconds = 240

function Get-LaunchDecision {
    param([bool]$Healthy, $RunningSince, $BuiltAt, $OtherLauncherStarts, [datetime]$Now, [bool]$ForceRestart)
    if ($ForceRestart) { return "restart" }
    if ($Healthy -and $RunningSince -and $BuiltAt -and ($RunningSince -ge $BuiltAt)) { return "open" }
    foreach ($s in @($OtherLauncherStarts)) {
        if ($s -and (($Now - $s).TotalSeconds -lt $WaitOtherLauncherSeconds)) { return "wait" }
    }
    return "restart"
}

# Coleta os fatos que a decisão usa: a API responde? desde quando este build está rodando? quando o código/build mudou
# pela última vez? há outro launcher vivo?
function Get-LaunchInputs {
    $dll = "$root\backend\bin\Release\net10.0\LocalAi.Api.dll"
    $healthy = [bool]((curl.exe -s -m 2 "$url/api/status") -match '"connected":true')
    $proc = Get-CimInstance Win32_Process -Filter "Name='dotnet.exe'" -ErrorAction SilentlyContinue |
        Where-Object { $_.CommandLine -like "*$dll*" -and $_.CommandLine -like "*$url*" } | Select-Object -First 1
    $since = $null
    if ($proc) { $since = $proc.CreationDate }

    $times = @()
    if (Test-Path $dll) { $times += (Get-Item $dll).LastWriteTime }
    $index = "$root\backend\wwwroot\index.html"
    if (Test-Path $index) { $times += (Get-Item $index).LastWriteTime }
    $backendSrc = Get-ChildItem "$root\backend" -Recurse -File -Include *.cs, *.csproj, appsettings*.json -ErrorAction SilentlyContinue |
        Where-Object { $_.FullName -notmatch '\\(bin|obj)\\' } | Sort-Object LastWriteTime -Descending | Select-Object -First 1
    if ($backendSrc) { $times += $backendSrc.LastWriteTime }
    $uiSrc = Get-ChildItem "$root\frontend\src", "$root\frontend\index.html" -Recurse -File -ErrorAction SilentlyContinue |
        Sort-Object LastWriteTime -Descending | Select-Object -First 1
    if ($uiSrc) { $times += $uiSrc.LastWriteTime }
    $builtAt = $null
    if ($times.Count -gt 0) { $builtAt = ($times | Sort-Object -Descending | Select-Object -First 1) }

    $others = @(Get-CimInstance Win32_Process -Filter "Name='powershell.exe'" -ErrorAction SilentlyContinue |
        Where-Object { $_.ProcessId -ne $PID -and $_.CommandLine -match '-File\s+\S*iniciar-nex\.ps1' } |
        ForEach-Object { $_.CreationDate })

    return [pscustomobject]@{ Healthy = $healthy; RunningSince = $since; BuiltAt = $builtAt; Others = $others }
}

function Start-Nex {
    # ---------------------------------------------------------------------------------------------------------------
    # 0. Decide antes de derrubar qualquer coisa
    # ---------------------------------------------------------------------------------------------------------------
    $waited = 0
    while ($true) {
        $in = Get-LaunchInputs
        $decision = Get-LaunchDecision -Healthy $in.Healthy -RunningSince $in.RunningSince -BuiltAt $in.BuiltAt `
            -OtherLauncherStarts $in.Others -Now (Get-Date) -ForceRestart $Force.IsPresent
        if ($DryRun) {
            Log ("Decisão: {0} | saudável={1} | Nex rodando desde={2} | código/build de={3} | outros launchers={4}" -f `
                $decision, $in.Healthy, $in.RunningSince, $in.BuiltAt, @($in.Others).Count) Cyan
            return
        }
        if ($decision -eq "wait" -and $waited -lt ($WaitOtherLauncherSeconds + 60)) {
            if ($waited -eq 0) { Log "Outro launcher está subindo o Nex: espero ele terminar em vez de derrubá-lo..." Yellow }
            Start-Sleep -Seconds 3
            $waited += 3
            continue
        }
        break
    }
    if ($decision -eq "open") {
        Log "O Nex já está rodando e atualizado em $url. Abrindo a tela (use -Force para reiniciar tudo)." Green
        if (-not $NoBrowser) { Start-Process $url }
        Start-Sleep -Seconds 2
        return
    }

    # ---------------------------------------------------------------------------------------------------------------
    # 1. Limpeza: encerra o que ficou de execuções anteriores (backends de qualquer pasta/versão, motor de voz,
    #    janelas antigas do Nex e o Ollama, inclusive o app da bandeja, que sobe um servidor próprio sem o perfil).
    # ---------------------------------------------------------------------------------------------------------------
    Log "Encerrando processos anteriores..." Cyan
    $old = Get-CimInstance Win32_Process | Where-Object {
        $_.ProcessId -ne $PID -and (
            ($_.Name -eq "dotnet.exe" -and $_.CommandLine -like "*LocalAi.Api*") -or
            ($_.Name -match "^python" -and $_.CommandLine -like "*stt.py*") -or
            ($_.Name -eq "powershell.exe" -and $_.CommandLine -match "-File\s+\S*iniciar-nex\.ps1") -or
            ($_.Name -match "^ollama")
        )
    }
    foreach ($p in $old) {
        Log ("  encerrando {0} (pid {1})" -f $p.Name, $p.ProcessId)
        Stop-Process -Id $p.ProcessId -Force -ErrorAction SilentlyContinue
    }
    # espera as portas ficarem livres (até 10 s)
    for ($i = 0; $i -lt 20 -and ((Test-Url "http://localhost:11434/api/version") -or (Test-Url "$url/api/status")); $i++) {
        Start-Sleep -Milliseconds 500
    }
    Log ("Limpeza concluída ({0} processo(s) encerrado(s))." -f @($old).Count) Green

    # ---------------------------------------------------------------------------------------------------------------
    # 2. Ollama, com o perfil econômico para GPU pequena. Espera ficar pronto antes de seguir.
    # ---------------------------------------------------------------------------------------------------------------
    Log "Iniciando o Ollama..." Cyan
    $env:OLLAMA_FLASH_ATTENTION = "1"     # atenção otimizada: usa menos VRAM
    $env:OLLAMA_KV_CACHE_TYPE = "q8_0"    # cache de contexto na metade do tamanho
    $env:OLLAMA_MAX_LOADED_MODELS = "1"   # um modelo na VRAM por vez
    $env:OLLAMA_KEEP_ALIVE = "60m"        # mantém o modelo na VRAM: sem os ~7 s de carregar a cada pausa (o padrão descarrega em 5 min)
    $env:OLLAMA_NUM_PARALLEL = "1"       # sem requisições paralelas (cada uma multiplicaria o cache de contexto)
    $ollama = (Get-Command ollama -ErrorAction SilentlyContinue).Source
    if (-not $ollama) { $ollama = "$env:LOCALAPPDATA\Programs\Ollama\ollama.exe" }
    if (-not (Test-Path $ollama)) { Stop-WithError "Ollama não encontrado. Instale em https://ollama.com/download" }
    Start-Process $ollama -ArgumentList "serve" -WindowStyle Hidden
    for ($i = 0; $i -lt 120 -and -not (Test-Url "http://localhost:11434/api/version"); $i++) { Start-Sleep -Milliseconds 500 }
    if (-not (Test-Url "http://localhost:11434/api/version")) { Stop-WithError "O Ollama não respondeu em 60 s." }
    Log "Ollama pronto." Green

    # ---------------------------------------------------------------------------------------------------------------
    # 3. Tela (frontend): recompila quando mudou
    # ---------------------------------------------------------------------------------------------------------------
    $index = "$root\backend\wwwroot\index.html"
    $newestUi = Get-ChildItem "$root\frontend\src", "$root\frontend\index.html" -Recurse -File -ErrorAction SilentlyContinue |
        Sort-Object LastWriteTime -Descending | Select-Object -First 1
    if (-not (Test-Path $index) -or ($newestUi -and $newestUi.LastWriteTime -gt (Get-Item $index).LastWriteTime)) {
        Log "Atualizando a tela..." Cyan
        Push-Location "$root\frontend"
        if (-not (Test-Path node_modules)) { npm install }
        npm run build
        if ($LASTEXITCODE -ne 0) { Stop-WithError "Falha ao compilar a tela." }
        Pop-Location
    }

    # ---------------------------------------------------------------------------------------------------------------
    # 4. Backend: recompila só se o código mudou desde a última compilação
    # ---------------------------------------------------------------------------------------------------------------
    $dll = "$root\backend\bin\Release\net10.0\LocalAi.Api.dll"
    $newest = Get-ChildItem "$root\backend" -Recurse -File -Include *.cs, *.csproj, appsettings*.json |
        Where-Object { $_.FullName -notmatch '\\(bin|obj)\\' } |
        Sort-Object LastWriteTime -Descending | Select-Object -First 1
    if (-not (Test-Path $dll) -or $newest.LastWriteTime -gt (Get-Item $dll).LastWriteTime) {
        Log "Compilando o backend..." Cyan
        dotnet build "$root\backend" -c Release -nologo -v q
        if ($LASTEXITCODE -ne 0) { Stop-WithError "Falha ao compilar o backend. Confira se o .NET SDK 10 está instalado (dotnet --list-sdks)." }
        (Get-Item $dll).LastWriteTime = Get-Date
    }

    # ---------------------------------------------------------------------------------------------------------------
    # 5. Abre a tela só quando o Nex E o Ollama estiverem de pé (a tela já nasce "conectada")
    # ---------------------------------------------------------------------------------------------------------------
    if (-not $NoBrowser) {
        Start-Job -ArgumentList $url -ScriptBlock {
            param($u)
            for ($i = 0; $i -lt 240; $i++) {
                $r = curl.exe -s -m 2 "$u/api/status"
                if ($r -match '"connected":true') { break }
                Start-Sleep -Milliseconds 500
            }
            Start-Process $u
        } | Out-Null
    }

    # ---------------------------------------------------------------------------------------------------------------
    # 6. Nex em primeiro plano (fechar a janela encerra o backend; o motor de voz acompanha)
    # ---------------------------------------------------------------------------------------------------------------
    Log "Iniciando o Nex em $url (a tela abre sozinha quando tudo estiver pronto)." Cyan
    Push-Location "$root\backend"
    dotnet $dll --urls $url
    Pop-Location
}

# Rodar direto inicia o Nex; carregar com ponto (. .\iniciar-nex.ps1) só define as funções, para os testes.
if ($MyInvocation.InvocationName -ne '.') { Start-Nex }
