# Inicia ou reinicia o Google Chrome com a porta de depuração 9222, restaurando todas as abas e logins.
param([switch]$ForceRestart)

function Test-Port9222 {
    $r = curl.exe -s -m 1 "http://127.0.0.1:9222/json/version" 2>$null
    return ($LASTEXITCODE -eq 0 -and $r)
}

if (-not (Test-Port9222) -or $ForceRestart) {
    $chromePaths = @(
        "$env:ProgramFiles\Google\Chrome\Application\chrome.exe",
        "${env:ProgramFiles(x86)}\Google\Chrome\Application\chrome.exe",
        "$env:LOCALAPPDATA\Google\Chrome\Application\chrome.exe"
    )
    $chromeExe = $chromePaths | Where-Object { Test-Path $_ } | Select-Object -First 1
    if (-not $chromeExe) { Write-Error "Google Chrome não encontrado."; exit 1 }

    $running = Get-Process chrome -ErrorAction SilentlyContinue
    if ($running) {
        Write-Host "Fechando instâncias do Chrome para liberar a porta de depuração..." -ForegroundColor Cyan
        Stop-Process -Name chrome -Force -ErrorAction SilentlyContinue
        Start-Sleep -Seconds 1
    }

    Write-Host "Iniciando seu Chrome na porta 9222 com suas sessões e abas..." -ForegroundColor Green
    Start-Process $chromeExe -ArgumentList "--remote-debugging-port=9222", "--restore-last-session"

    for ($i = 0; $i -lt 15; $i++) {
        Start-Sleep -Milliseconds 500
        if (Test-Port9222) {
            Write-Host "Chrome conectado com sucesso na porta 9222!" -ForegroundColor Green
            exit 0
        }
    }
    Write-Warning "O Chrome abriu, mas a porta 9222 demorou a responder."
} else {
    Write-Host "O Chrome já está rodando perfeitamente na porta 9222 com suas sessões ativas." -ForegroundColor Green
}
